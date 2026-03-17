const { notarize } = require("@electron/notarize");

function isRetryableNotaryError(error) {
  const msg = String(error && error.message ? error.message : error);
  return msg.includes("statusCode: 500") || msg.includes("UNEXPECTED_ERROR");
}

function getAuthConfig() {
  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
  const keychain = process.env.APPLE_KEYCHAIN;
  if (keychainProfile) {
    return {
      mode: "keychainProfile",
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
    if (!appleApiKey) missing.push("APPLE_API_KEY");
    if (!appleApiKeyId) missing.push("APPLE_API_KEY_ID");
    if (!appleApiIssuer) missing.push("APPLE_API_ISSUER");
    if (missing.length > 0) {
      throw new Error(
        `Notarization API key mode missing env: ${missing.join(", ")}`
      );
    }
    return {
      mode: "apiKey",
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
  if (!appleId) missing.push("APPLE_ID");
  if (!appleIdPassword) missing.push("APPLE_APP_SPECIFIC_PASSWORD");
  if (!teamId) missing.push("APPLE_TEAM_ID");
  if (missing.length > 0) {
    throw new Error(
      `Notarization Apple ID mode missing env: ${missing.join(", ")}`
    );
  }
  return {
    mode: "appleId",
    args: {
      appleId,
      appleIdPassword,
      teamId,
    },
  };
}

function getRequestId(error) {
  const msg = String(error && error.message ? error.message : error);
  const match = msg.match(/id\s*=\s*([A-Z0-9]+)/);
  return match ? match[1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  if (process.env.SKIP_NOTARIZE === "1" || process.env.SKIP_NOTARIZE === "true") {
    console.log("SKIP_NOTARIZE is set. Skipping notarization.");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const auth = getAuthConfig();

  console.log(`Notarizing ${appPath}...`);
  console.log(`Notarization auth mode: ${auth.mode}`);

  const maxAttempts = 4;
  const backoffMs = [5000, 15000, 30000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await notarize({
        appPath,
        ...auth.args,
      });
      console.log("Notarization complete.");
      return;
    } catch (error) {
      const retryable = isRetryableNotaryError(error);
      const hasNext = attempt < maxAttempts;
      const requestId = getRequestId(error);
      if (requestId) {
        console.warn(`Apple notary request id: ${requestId}`);
      }

      if (!retryable || !hasNext) {
        throw error;
      }

      const waitMs = backoffMs[attempt - 1] ?? 30000;
      console.warn(
        `Notarization attempt ${attempt}/${maxAttempts} failed with Apple service 500. Retrying in ${Math.round(
          waitMs / 1000
        )}s...`
      );
      await sleep(waitMs);
    }
  }
};
