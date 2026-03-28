const fs = require('fs');
const path = require('path');
const os = require('os');
const esbuild = require('esbuild');

async function run() {
  const root = path.resolve(__dirname, '..');
  const tempOut = path.join(os.tmpdir(), `mc-protocol-runner-bridge-${Date.now()}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(root, 'src', 'main', 'protocol-runner-bridge.ts')],
    outfile: tempOut,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    logLevel: 'silent',
  });

  const { ProtocolRunnerBridge } = require(tempOut);
  const fixturePath = path.join(__dirname, 'protocol-eval-fixtures.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const cases = Array.isArray(fixture.cases) ? fixture.cases : [];

  const bridge = new ProtocolRunnerBridge();
  bridge.resetMetrics();

  for (let i = 0; i < cases.length; i += 1) {
    const entry = cases[i];
    const provider = entry.provider === 'claude' ? 'claude' : 'codex';
    const sessionId = `eval-${provider}-${i + 1}`;
    bridge.startSession(sessionId, provider);
    for (const rawEvent of (entry.events || [])) {
      bridge.ingestRawEvent(sessionId, rawEvent, Date.now());
    }
    bridge.endSession(sessionId);
  }

  const snapshot = bridge.getMetricsSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
  if (!snapshot.goals.allMet) {
    process.exitCode = 1;
  }

  try {
    fs.unlinkSync(tempOut);
  } catch {
    // Ignore cleanup errors for temp file.
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
