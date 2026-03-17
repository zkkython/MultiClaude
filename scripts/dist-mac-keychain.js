const { spawnSync } = require('child_process');

const env = { ...process.env };
// Force local keychain signing and ignore p12 import env vars.
delete env.CSC_LINK;
delete env.CSC_KEY_PASSWORD;
delete env.CSC_INSTALLER_LINK;
delete env.CSC_INSTALLER_KEY_PASSWORD;
delete env.WIN_CSC_LINK;
delete env.WIN_CSC_KEY_PASSWORD;

const extraArgs = process.argv.slice(2);
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(cmd, ['electron-builder', '--mac', ...extraArgs], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
