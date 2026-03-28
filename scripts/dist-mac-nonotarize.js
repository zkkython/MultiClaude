const { spawnSync } = require('child_process');

const env = { ...process.env };

// p12 import related
delete env.CSC_LINK;
delete env.CSC_KEY_PASSWORD;
delete env.CSC_INSTALLER_LINK;
delete env.CSC_INSTALLER_KEY_PASSWORD;
delete env.WIN_CSC_LINK;
delete env.WIN_CSC_KEY_PASSWORD;

// force-disable auto notarization paths in electron-builder
delete env.APPLE_ID;
delete env.APPLE_APP_SPECIFIC_PASSWORD;
delete env.APPLE_TEAM_ID;
delete env.APPLE_API_KEY;
delete env.APPLE_API_KEY_ID;
delete env.APPLE_API_ISSUER;
delete env.APPLE_KEYCHAIN;
delete env.APPLE_KEYCHAIN_PROFILE;

env.SKIP_NOTARIZE = '1';

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(cmd, ['electron-builder', '--mac', '--config', 'electron-builder.nonotarize.yml'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
