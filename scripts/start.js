const { spawn } = require('child_process');
const path = require('path');

function buildElectronEnv() {
  const env = { ...process.env };
  // Some shells/tools export this, which forces Electron into Node mode.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function start() {
  const electronPath = require('electron');
  const entry = path.resolve(__dirname, '../dist/main/index.js');
  const child = spawn(String(electronPath), [entry], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: buildElectronEnv(),
  });

  child.on('close', (code) => {
    process.exit(code || 0);
  });
}

start();
