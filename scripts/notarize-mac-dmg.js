const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function run(command, args, options = {}) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAuthConfig() {
  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
  const keychain = process.env.APPLE_KEYCHAIN;
  if (keychainProfile) {
    return {
      mode: 'keychainProfile',
      args: {
        keychainProfile,
        ...(keychain ? { keychain } : {}),
      },
    };
  }

  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;
  if (appleApiKey || appleApiKeyId || appleApiIssuer) {
    const missing = [];
    if (!appleApiKey) missing.push('APPLE_API_KEY');
    if (!appleApiKeyId) missing.push('APPLE_API_KEY_ID');
    if (!appleApiIssuer) missing.push('APPLE_API_ISSUER');
    if (missing.length > 0) {
      throw new Error(`Notarization API key mode missing env: ${missing.join(', ')}`);
    }
    return {
      mode: 'apiKey',
      args: {
        appleApiKey,
        appleApiKeyId,
        appleApiIssuer,
      },
    };
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const missing = [];
  if (!appleId) missing.push('APPLE_ID');
  if (!appleIdPassword) missing.push('APPLE_APP_SPECIFIC_PASSWORD');
  if (!teamId) missing.push('APPLE_TEAM_ID');
  if (missing.length > 0) {
    throw new Error(`Notarization Apple ID mode missing env: ${missing.join(', ')}`);
  }
  return {
    mode: 'appleId',
    args: {
      appleId,
      appleIdPassword,
      teamId,
    },
  };
}

function getNotarytoolAuthArgs(auth) {
  if (auth.mode === 'keychainProfile') {
    return [
      '--keychain-profile',
      auth.args.keychainProfile,
      ...(auth.args.keychain ? ['--keychain', auth.args.keychain] : []),
    ];
  }
  if (auth.mode === 'apiKey') {
    return [
      '--key',
      auth.args.appleApiKey,
      '--key-id',
      auth.args.appleApiKeyId,
      '--issuer',
      auth.args.appleApiIssuer,
    ];
  }
  return [
    '--apple-id',
    auth.args.appleId,
    '--password',
    auth.args.appleIdPassword,
    '--team-id',
    auth.args.teamId,
  ];
}

function parseJsonOrThrow(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${context} returned non-JSON output: ${raw}`);
  }
}

function submitForNotarization(targetPath, auth) {
  const args = [
    'notarytool',
    'submit',
    targetPath,
    '--output-format',
    'json',
    ...getNotarytoolAuthArgs(auth),
  ];
  const result = run('xcrun', args, { capture: true });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`notarytool submit failed:\n${output}`);
  }

  const payload = parseJsonOrThrow(result.stdout || '', 'notarytool submit');
  const submissionId = payload.id;
  if (!submissionId) {
    throw new Error(`notarytool submit output missing submission id: ${result.stdout || ''}`);
  }
  return submissionId;
}

function getSubmissionInfo(submissionId, auth) {
  const args = [
    'notarytool',
    'info',
    submissionId,
    '--output-format',
    'json',
    ...getNotarytoolAuthArgs(auth),
  ];
  const result = run('xcrun', args, { capture: true });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`notarytool info failed:\n${output}`);
  }
  return parseJsonOrThrow(result.stdout || '', 'notarytool info');
}

function getSubmissionLog(submissionId, auth) {
  const args = [
    'notarytool',
    'log',
    submissionId,
    ...getNotarytoolAuthArgs(auth),
  ];
  const result = run('xcrun', args, { capture: true });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    return `Unable to fetch notary log:\n${output}`;
  }
  return (result.stdout || '').trim();
}

async function waitForNotarization(submissionId, auth) {
  const maxChecks = Number(process.env.NOTARIZE_STATUS_MAX_CHECKS || 120); // ~60m @ 30s
  const intervalMs = Number(process.env.NOTARIZE_STATUS_INTERVAL_MS || 30000);

  for (let check = 1; check <= maxChecks; check++) {
    const info = getSubmissionInfo(submissionId, auth);
    const status = String(info.status || '').toLowerCase();
    console.log(
      `Notary status check ${check}/${maxChecks}: ${info.status || 'Unknown'}`
    );

    if (status === 'accepted') {
      return;
    }
    if (status === 'invalid' || status === 'rejected') {
      const log = getSubmissionLog(submissionId, auth);
      throw new Error(`Notary submission ${submissionId} failed with status ${info.status}.\n${log}`);
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for notarization result for submission ${submissionId}.`);
}

function stapleAndVerify(targetPath) {
  console.log('Stapling ticket...');
  const staple = run('xcrun', ['stapler', 'staple', '-v', targetPath], { capture: true });
  if (staple.status !== 0) {
    const output = `${staple.stdout || ''}\n${staple.stderr || ''}`.trim();
    throw new Error(`stapler staple failed:\n${output}`);
  }
  if (staple.stdout) process.stdout.write(staple.stdout);
  if (staple.stderr) process.stderr.write(staple.stderr);

  console.log('Validating stapled ticket...');
  const validate = run('xcrun', ['stapler', 'validate', '-v', targetPath], { capture: true });
  if (validate.status !== 0) {
    const output = `${validate.stdout || ''}\n${validate.stderr || ''}`.trim();
    throw new Error(`stapler validate failed:\n${output}`);
  }
  if (validate.stdout) process.stdout.write(validate.stdout);
  if (validate.stderr) process.stderr.write(validate.stderr);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: npm run notarize:mac -- <path-to-dmg>');
    process.exit(1);
  }

  const targetPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(targetPath)) {
    console.error(`File not found: ${targetPath}`);
    process.exit(1);
  }
  if (path.extname(targetPath).toLowerCase() !== '.dmg') {
    console.error(`Expected a .dmg file, got: ${targetPath}`);
    process.exit(1);
  }

  const auth = getAuthConfig();
  console.log(`Notarization auth mode: ${auth.mode}`);
  console.log(`Submitting: ${targetPath}`);

  const submissionId = submitForNotarization(targetPath, auth);
  console.log(`Submission ID: ${submissionId}`);
  await waitForNotarization(submissionId, auth);
  console.log('Notarization accepted.');

  stapleAndVerify(targetPath);
  console.log('Notarization flow complete.');
}

main().catch((error) => {
  const msg = error && error.message ? error.message : String(error);
  console.error(msg);
  process.exit(1);
});
