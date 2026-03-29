import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __setGitRunnerForTest,
  buildMergeTemplate,
  createWorktree,
  getMergeReadiness,
  getWorktreeStatus,
  listWorktrees,
  parseWorktreePorcelain,
  pruneWorktrees,
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
  assert.equal(readiness.modifiedCount, 0);
  assert.equal(readiness.untrackedCount, 0);
});

test('listWorktrees parses porcelain and surfaces git list failures', async () => {
  __setGitRunnerForTest(async (_cwd, args) => {
    if (args.join(' ') === 'worktree list --porcelain') {
      return {
        code: 0,
        stdout: [
          'worktree /repo/main',
          'branch refs/heads/main',
          '',
          'worktree /repo/wt-b',
          'branch refs/heads/feat/b',
          'prunable gitdir file points to non-existent location',
          'bare',
          '',
        ].join('\n'),
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: 'bad args' };
  });

  const items = await listWorktrees('/repo/main');
  assert.equal(items.length, 2);
  assert.equal(items[1].branch, 'feat/b');
  assert.equal(items[1].prunable, true);
  assert.equal(items[1].bare, true);
  assert.equal(items[0].isMain, true);

  __setGitRunnerForTest(async () => ({ code: 1, stdout: '', stderr: 'boom list' }));
  await assert.rejects(() => listWorktrees('/repo/main'), /boom list/);
});

test('createWorktree returns listed worktree when found, otherwise falls back to input', async () => {
  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key.startsWith('worktree add')) {
      return { code: 0, stdout: '', stderr: '' };
    }
    if (key === 'worktree list --porcelain') {
      return {
        code: 0,
        stdout: [
          'worktree /repo/main',
          'branch refs/heads/main',
          '',
          'worktree /repo/wt-c',
          'branch refs/heads/feat/c',
          '',
        ].join('\n'),
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${key}` };
  });

  const created = await createWorktree({
    repoPath: '/repo/main',
    worktreePath: '/repo/wt-c',
    branchName: ' feat/c ',
    fromRef: ' main ',
  });
  assert.equal(created.path, '/repo/wt-c');
  assert.equal(created.branch, 'feat/c');

  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key.startsWith('worktree add')) return { code: 0, stdout: '', stderr: '' };
    if (key === 'worktree list --porcelain') return { code: 0, stdout: 'worktree /repo/main\nbranch refs/heads/main\n', stderr: '' };
    return { code: 1, stdout: '', stderr: 'bad' };
  });
  const fallback = await createWorktree({
    repoPath: '/repo/main',
    worktreePath: '/repo/wt-not-listed',
    branchName: 'feat/x',
    fromRef: '',
  });
  assert.equal(fallback.path, '/repo/wt-not-listed');
  assert.equal(fallback.branch, 'feat/x');
  assert.equal(fallback.isMain, false);

  __setGitRunnerForTest(async () => ({ code: 2, stdout: '', stderr: 'add failed' }));
  await assert.rejects(
    () => createWorktree({
      repoPath: '/repo/main',
      worktreePath: '/repo/wt-fail',
      branchName: 'feat/fail',
      fromRef: 'HEAD',
    }),
    /add failed/
  );
});

test('status and prune helpers propagate success and failures', async () => {
  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key === 'status --porcelain') return { code: 0, stdout: '?? new-file\n', stderr: '' };
    if (key === 'worktree prune') return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: 'bad' };
  });

  const status = await getWorktreeStatus('/repo/wt-a');
  assert.equal(status.path, '/repo/wt-a');
  assert.equal(status.dirty, true);
  assert.equal(status.modifiedCount, 0);
  assert.equal(status.untrackedCount, 1);
  await pruneWorktrees('/repo/main');

  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key === 'status --porcelain') return { code: 9, stdout: '', stderr: 'status failed' };
    if (key === 'worktree prune') return { code: 8, stdout: '', stderr: 'prune failed' };
    return { code: 1, stdout: '', stderr: 'bad' };
  });
  await assert.rejects(() => getWorktreeStatus('/repo/wt-a'), /status failed/);
  await assert.rejects(() => pruneWorktrees('/repo/main'), /prune failed/);
});

test('removeWorktree executes git remove for clean worktree and surfaces failures', async () => {
  const calls: string[] = [];
  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    calls.push(key);
    if (key === 'status --porcelain') return { code: 0, stdout: '', stderr: '' };
    if (key === 'worktree remove /repo/wt-ok') return { code: 0, stdout: '', stderr: '' };
    if (key === 'worktree remove /repo/wt-fail') return { code: 5, stdout: '', stderr: 'remove failed' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  });

  await removeWorktree('/repo/main', '/repo/wt-ok');
  assert.equal(calls.includes('worktree remove /repo/wt-ok'), true);

  await assert.rejects(() => removeWorktree('/repo/main', '/repo/wt-fail'), /remove failed/);
});

test('getMergeReadiness falls back to detached HEAD and normalizes invalid counts to zero', async () => {
  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key === 'symbolic-ref --short HEAD') {
      return { code: 1, stdout: '', stderr: 'not on a branch' };
    }
    if (key === 'rev-parse --short HEAD') {
      return { code: 0, stdout: 'abc123\n', stderr: '' };
    }
    if (key === 'rev-list --left-right --count main...abc123') {
      return { code: 0, stdout: 'x y\n', stderr: '' };
    }
    if (key === 'status --porcelain') {
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${key}` };
  });

  const readiness = await getMergeReadiness('/repo/wt-detached', '  ');
  assert.equal(readiness.sourceRef, 'abc123');
  assert.equal(readiness.targetRef, 'main');
  assert.equal(readiness.behind, 0);
  assert.equal(readiness.ahead, 0);
  assert.equal(readiness.modifiedCount, 0);
  assert.equal(readiness.untrackedCount, 0);

  __setGitRunnerForTest(async (_cwd, args) => {
    const key = args.join(' ');
    if (key === 'symbolic-ref --short HEAD') return { code: 1, stdout: '', stderr: 'detached' };
    if (key === 'rev-parse --short HEAD') return { code: 2, stdout: '', stderr: 'no head' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  });
  await assert.rejects(() => getMergeReadiness('/repo/wt-detached', 'main'), /no head|failed to resolve HEAD/);
});
