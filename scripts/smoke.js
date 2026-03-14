const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function assertFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing expected build output: ${path.relative(root, file)}`);
  }
}

function run() {
  execSync('node scripts/build.js', {
    cwd: root,
    stdio: 'inherit',
  });

  assertFile(path.join(root, 'dist', 'main', 'index.js'));
  assertFile(path.join(root, 'dist', 'preload', 'index.js'));
  assertFile(path.join(root, 'dist', 'renderer', 'index.js'));
  assertFile(path.join(root, 'dist', 'renderer', 'index.html'));
  assertFile(path.join(root, 'dist', 'renderer', 'styles', 'main.css'));

  console.log('Smoke check passed.');
}

run();
