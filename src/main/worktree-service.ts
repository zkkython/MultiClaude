import { spawn } from 'child_process';
import * as path from 'path';
import type {
  WorktreeCreateInput,
  WorktreeInfo,
  WorktreeMergeReadiness,
  WorktreeMergeTemplateInput,
  WorktreeMergeTemplateResult,
  WorktreeStatus,
} from '../shared/types.js';

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>;

let gitRunner: GitRunner = runGitProcess;

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const result = await gitRunner(repoPath, ['worktree', 'list', '--porcelain']);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git worktree list failed with code ${result.code}`);
  }
  return parseWorktreePorcelain(result.stdout);
}

export async function createWorktree(input: WorktreeCreateInput): Promise<WorktreeInfo> {
  const branchName = input.branchName.trim();
  const fromRef = (input.fromRef || 'HEAD').trim();
  const args = input.useExistingBranch
    ? ['worktree', 'add', input.worktreePath, branchName]
    : ['worktree', 'add', '-b', branchName, input.worktreePath, fromRef];
  const result = await gitRunner(input.repoPath, args);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git worktree add failed with code ${result.code}`);
  }
  const all = await listWorktrees(input.repoPath);
  const created = all.find(item => path.resolve(item.path) === path.resolve(input.worktreePath));
  if (!created) {
    return {
      path: input.worktreePath,
      branch: branchName,
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
      isMain: false,
    };
  }
  return created;
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
  const status = await getWorktreeStatus(worktreePath);
  if (status.dirty) {
    throw new Error('dirty_tree');
  }
  const result = await gitRunner(repoPath, ['worktree', 'remove', worktreePath]);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git worktree remove failed with code ${result.code}`);
  }
}

export async function pruneWorktrees(repoPath: string): Promise<void> {
  const result = await gitRunner(repoPath, ['worktree', 'prune']);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git worktree prune failed with code ${result.code}`);
  }
}

export async function getWorktreeStatus(worktreePath: string): Promise<WorktreeStatus> {
  const result = await gitRunner(worktreePath, ['status', '--porcelain']);
  if (result.code !== 0) {
    throw new Error(result.stderr || `git status failed with code ${result.code}`);
  }
  return {
    path: worktreePath,
    dirty: result.stdout.trim().length > 0,
  };
}

export async function getMergeReadiness(worktreePath: string, targetRef: string): Promise<WorktreeMergeReadiness> {
  const sourceRef = await getCurrentBranchRef(worktreePath);
  const target = targetRef.trim() || 'main';

  const aheadBehind = await gitRunner(worktreePath, ['rev-list', '--left-right', '--count', `${target}...${sourceRef}`]);
  if (aheadBehind.code !== 0) {
    throw new Error(aheadBehind.stderr || `git rev-list failed with code ${aheadBehind.code}`);
  }
  const parsed = aheadBehind.stdout.trim().split(/\s+/);
  const behind = Number.parseInt(parsed[0] || '0', 10);
  const ahead = Number.parseInt(parsed[1] || '0', 10);
  const status = await getWorktreeStatus(worktreePath);

  return {
    worktreePath,
    sourceRef,
    targetRef: target,
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    dirty: status.dirty,
    confidence: 'high',
  };
}

export function buildMergeTemplate(input: WorktreeMergeTemplateInput): WorktreeMergeTemplateResult {
  const sourceRef = input.sourceRef.trim();
  const targetRef = input.targetRef.trim();
  if (input.strategy === 'rebase') {
    return {
      strategy: 'rebase',
      command: [
        `git fetch --all --prune`,
        `git checkout ${shellEscape(targetRef)}`,
        `git pull --ff-only`,
        `git checkout ${shellEscape(sourceRef)}`,
        `git rebase ${shellEscape(targetRef)}`,
      ].join(' && '),
    };
  }
  if (input.strategy === 'squash') {
    return {
      strategy: 'squash',
      command: [
        `git fetch --all --prune`,
        `git checkout ${shellEscape(targetRef)}`,
        `git pull --ff-only`,
        `git merge --squash ${shellEscape(sourceRef)}`,
        `git commit -m "squash: ${sourceRef} into ${targetRef}"`,
      ].join(' && '),
    };
  }
  return {
    strategy: 'merge',
    command: [
      `git fetch --all --prune`,
      `git checkout ${shellEscape(targetRef)}`,
      `git pull --ff-only`,
      `git merge --no-ff ${shellEscape(sourceRef)}`,
    ].join(' && '),
  };
}

export function parseWorktreePorcelain(stdout: string): WorktreeInfo[] {
  const lines = stdout.split('\n');
  const items: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;

  const pushCurrent = () => {
    if (!current) return;
    items.push(current);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      pushCurrent();
      continue;
    }
    if (line.startsWith('worktree ')) {
      pushCurrent();
      const worktreePath = line.slice('worktree '.length).trim();
      current = {
        path: worktreePath,
        branch: '',
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        isMain: false,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('branch ')) {
      const fullRef = line.slice('branch '.length).trim();
      current.branch = fullRef.replace(/^refs\/heads\//, '');
      continue;
    }
    if (line === 'detached') {
      current.detached = true;
      continue;
    }
    if (line === 'bare') {
      current.bare = true;
      continue;
    }
    if (line.startsWith('locked')) {
      current.locked = true;
      continue;
    }
    if (line.startsWith('prunable')) {
      current.prunable = true;
      continue;
    }
  }
  pushCurrent();

  const mainPath = items[0]?.path ? path.resolve(items[0].path) : '';
  for (const item of items) {
    item.isMain = mainPath ? path.resolve(item.path) === mainPath : false;
    if (!item.branch && item.detached) {
      item.branch = '(detached)';
    }
  }
  return items;
}

async function getCurrentBranchRef(worktreePath: string): Promise<string> {
  const result = await gitRunner(worktreePath, ['symbolic-ref', '--short', 'HEAD']);
  if (result.code === 0) {
    return result.stdout.trim();
  }
  const detached = await gitRunner(worktreePath, ['rev-parse', '--short', 'HEAD']);
  if (detached.code !== 0) {
    throw new Error(detached.stderr || 'failed to resolve HEAD');
  }
  return detached.stdout.trim();
}

function runGitProcess(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export function __setGitRunnerForTest(runner: GitRunner | null): void {
  gitRunner = runner || runGitProcess;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
