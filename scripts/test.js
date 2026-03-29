const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiclaude-test-'));
  const testEntries = [
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/agent-state-engine.test.ts'),
      out: path.join(tmpDir, 'agent-state-engine.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/runner-orchestrator.test.ts'),
      out: path.join(tmpDir, 'runner-orchestrator.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/runner-sidechannel-gateway.test.ts'),
      out: path.join(tmpDir, 'runner-sidechannel-gateway.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/runner-sidechannel-gateway-server.test.ts'),
      out: path.join(tmpDir, 'runner-sidechannel-gateway-server.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/codex-auth.test.ts'),
      out: path.join(tmpDir, 'codex-auth.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/path-utils.test.ts'),
      out: path.join(tmpDir, 'path-utils.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/menu.test.ts'),
      out: path.join(tmpDir, 'menu.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/env-builder.test.ts'),
      out: path.join(tmpDir, 'env-builder.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/claude-hooks.test.ts'),
      out: path.join(tmpDir, 'claude-hooks.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/config-store.test.ts'),
      out: path.join(tmpDir, 'config-store.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/config-paths.test.ts'),
      out: path.join(tmpDir, 'config-paths.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/index.test.ts'),
      out: path.join(tmpDir, 'main-index.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/runner-transport-factory.test.ts'),
      out: path.join(tmpDir, 'runner-transport-factory.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/provider-adapter.test.ts'),
      out: path.join(tmpDir, 'provider-adapter.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/system-terminal.test.ts'),
      out: path.join(tmpDir, 'system-terminal.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/terminal-context-menu.test.ts'),
      out: path.join(tmpDir, 'terminal-context-menu.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/protocol-runner-bridge.test.ts'),
      out: path.join(tmpDir, 'protocol-runner-bridge.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/protocol-http-transport.test.ts'),
      out: path.join(tmpDir, 'protocol-http-transport.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/protocol-connectivity.test.ts'),
      out: path.join(tmpDir, 'protocol-connectivity.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/protocol-session-transport.test.ts'),
      out: path.join(tmpDir, 'protocol-session-transport.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/pty-manager.test.ts'),
      out: path.join(tmpDir, 'pty-manager.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/main/__tests__/worktree-service.test.ts'),
      out: path.join(tmpDir, 'worktree-service.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/preload/__tests__/index.test.ts'),
      out: path.join(tmpDir, 'preload-index.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/store.test.ts'),
      out: path.join(tmpDir, 'renderer-store.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/status-bar.test.ts'),
      out: path.join(tmpDir, 'renderer-status-bar.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/modal-a11y.test.ts'),
      out: path.join(tmpDir, 'renderer-modal-a11y.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/dialog-markup.test.ts'),
      out: path.join(tmpDir, 'renderer-dialog-markup.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/preflight.test.ts'),
      out: path.join(tmpDir, 'renderer-preflight.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/worktree-launcher.test.ts'),
      out: path.join(tmpDir, 'renderer-worktree-launcher.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/sidebar-actions.test.ts'),
      out: path.join(tmpDir, 'renderer-sidebar-actions.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/tab-close-plan.test.ts'),
      out: path.join(tmpDir, 'renderer-tab-close-plan.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/screen-workspace-actions.test.ts'),
      out: path.join(tmpDir, 'renderer-screen-workspace-actions.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/terminal-focus-guard.test.ts'),
      out: path.join(tmpDir, 'renderer-terminal-focus-guard.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/screen-workspace-ime-interaction.test.ts'),
      out: path.join(tmpDir, 'renderer-screen-workspace-ime-interaction.test.cjs'),
    },
    {
      entry: path.resolve(__dirname, '../src/renderer/__tests__/screen-workspace-dom-drift.test.ts'),
      out: path.join(tmpDir, 'renderer-screen-workspace-dom-drift.test.cjs'),
    },
  ];

  try {
    for (const testEntry of testEntries) {
      await esbuild.build({
        entryPoints: [testEntry.entry],
        outfile: testEntry.out,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        sourcemap: 'inline',
        tsconfig: path.resolve(__dirname, '../tsconfig.json'),
      });
    }

    const result = spawnSync(process.execPath, ['--test', ...testEntries.map(item => item.out)], {
      stdio: 'inherit',
      env: process.env,
    });

    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
