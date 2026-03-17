const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiclaude-test-'));
  const outFile = path.join(tmpDir, 'agent-state-engine.test.cjs');

  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../src/main/__tests__/agent-state-engine.test.ts')],
      outfile: outFile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      sourcemap: 'inline',
      tsconfig: path.resolve(__dirname, '../tsconfig.json'),
    });

    const result = spawnSync(process.execPath, ['--test', outFile], {
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
