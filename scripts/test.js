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
