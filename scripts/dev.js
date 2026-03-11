const { spawn } = require('child_process');
const path = require('path');

// First build, then start electron with watch mode
async function dev() {
  // Run build in watch mode
  const buildProcess = spawn('node', [path.resolve(__dirname, 'build.js'), '--watch'], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });

  // Wait a bit for initial build to complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start electron
  const electronPath = require('electron');
  const electronProcess = spawn(String(electronPath), [path.resolve(__dirname, '../dist/main/index.js')], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'development' },
  });

  electronProcess.on('close', (code) => {
    buildProcess.kill();
    process.exit(code || 0);
  });

  process.on('SIGINT', () => {
    electronProcess.kill();
    buildProcess.kill();
    process.exit();
  });
}

dev().catch(err => {
  console.error(err);
  process.exit(1);
});
