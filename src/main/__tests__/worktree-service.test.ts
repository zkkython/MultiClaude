import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setGitRunnerForTest,
  buildMergeTemplate,
  createWorktree,
  getMergeReadiness,
  parseWorktreePorcelain,
  removeWorktree,
} from '../worktree-service.js';

test.afterEach(() => {
  __setGitRunnerForTest(null);
});

test('parseWorktreePorcelain parses flags and marks main worktree', () => {
  const parsed = parseWorktreePorcelain([
    'worktree /repo/main',
    'branch refs/heads/main',
    '',
    'worktree /repo/wt-a',
    'branch refs/heads/wt/task-a',
    'locked',
    '',
    'worktree /repo/wt-detached',
    'detached',
    '',
  ].join('\n'));

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].isMain, true);
  assert.equal(parsed[1].branch, 'wt/task-a');
  assert.equal(parsed[1].locked, true);
  assert.equal(parsed[2].detached, true);
  assert.equal(parsed[2].branch, '(detached)');
});

test('buildMergeTemplate returns expected command variants', () => {
  const merge = buildMergeTemplate({ strategy: 'merge', sourceRef: 'feat/a', targetRef: 'main' });
  const rebase = buildMergeTemplate({ strategy: 'rebase', sourceRef: 'feat/a', targetRef: 'main' });
  const squash = buildMergeTemplate({ strategy: 'squash', sourceRef: 'feat/a', targetRef: 'main' });

  assert.match(merge.command, /git merge --no-ff/);
  assert.match(rebase.command, /git rebase 'main'/);
  assert.match(squash.command, /git merge --squash/);
});

test('removeWorktree blocks dirty tree before git worktree remove', async () => {
  const calls: string[] = [];
  __setGitRunnerForTest(async (_cwd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'status') {
      return { code: 0, stdout: ' M src/index.ts\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  });

  await assert.rejects(
    () => removeWorktree('/repo/main', '/repo/wt-a'),
    /dirty_tree/
  );
  assert.deepEqual(calls, ['status --porcelain']);
});

test('createWorktree supports both new and existing branch modes', async () => {
  const calls: string[] = [];
  __setGitRunnerForTest(async (_cwd, args) => {
    calls.push(args.join(' '));
    if (args[0] === 'worktree' && args[1] === 'add') {
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'worktree' && args[1] === 'list') {
      return {
        code: 0,
        stdout: [
          'worktree /repo/main',
          'branch refs/heads/main',
          '',
          'worktree /repo/wt-ui',
          'branch refs/heads/feat/ui-interaction',
          '',
          'worktree /repo/wt-tests',
          'branch refs/heads/feat/unit-test-coverage',
          '',
        ].join('\n'),
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: `unexpected args: ${args.join(' ')}` };
  });

  const createdNew = await createWorktree({
    repoPath: '/repo/main',
    worktreePath: '/repo/wt-ui',
    branchName: 'feat/ui-interaction',
    fromRef: 'main',
  });
  const createdExisting = await createWorktree({
    repoPath: '/repo/main',
    worktreePath: '/repo/wt-tests',
    branchName: 'feat/unit-test-coverage',
    useExistingBranch: true,
  });

  assert.equal(createdNew.branch, 'feat/ui-interaction');
  assert.equal(createdExisting.branch, 'feat/unit-test-coverage');
  assert.match(calls[0], /^worktree add -b feat\/ui-interaction \/repo\/wt-ui main$/);
  assert.match(calls[2], /^worktree add \/repo\/wt-tests feat\/unit-test-coverage$/);
});

test('getMergeReadiness computes ahead/behind and dirty flags', async () => {
  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key === 'symbolic-ref --short HEAD') {
      return { code: 0, stdout: 'feat/worktree\n', stderr: '' };
    }
    if (key === 'rev-list --left-right --count main...feat/worktree') {
      return { code: 0, stdout: '2 5\n', stderr: '' };
    }
    if (key === 'status --porcelain') {
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected args: ${key}` };
  });

  const readiness = await getMergeReadiness('/repo/wt-a', 'main');
  assert.equal(readiness.sourceRef, 'feat/worktree');
  assert.equal(readiness.targetRef, 'main');
  assert.equal(readiness.behind, 2);
  assert.equal(readiness.ahead, 5);
  assert.equal(readiness.dirty, false);
});
