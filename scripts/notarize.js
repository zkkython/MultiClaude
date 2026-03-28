const { notarize } = require("@electron/notarize");
const { spawnSync } = require("child_process");

function isRetryableNotaryError(error) {
  const msg = String(error && error.message ? error.message : error);
  return (
    msg.includes("statusCode: 500") ||
    msg.includes("UNEXPECTED_ERROR") ||
    msg.includes("internalError(") ||
    msg.includes("Please try again at a later time")
  );
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
  // notarytool submission id is UUID. Apple server error payload may include
  // another opaque id (e.g. JJGX...), which cannot be used with notarytool info.
  const uuidMatch = msg.match(
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/
  );
  return uuidMatch ? uuidMatch[0] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNotarytoolAuthArgs(auth) {
  if (auth.mode === "keychainProfile") {
    return [
      "--keychain-profile",
      auth.args.keychainProfile,
      ...(auth.args.keychain ? ["--keychain", auth.args.keychain] : []),
    ];
  }
  if (auth.mode === "apiKey") {
    return [
      "--key",
      auth.args.appleApiKey,
      "--key-id",
      auth.args.appleApiKeyId,
      "--issuer",
      auth.args.appleApiIssuer,
    ];
  }
  return [
    "--apple-id",
    auth.args.appleId,
    "--password",
    auth.args.appleIdPassword,
    "--team-id",
    auth.args.teamId,
  ];
}

function readNotaryRequestStatus(requestId, auth) {
  const args = [
    "notarytool",
    "info",
    requestId,
    "--output-format",
    "json",
    ...getNotarytoolAuthArgs(auth),
  ];
  const result = spawnSync("xcrun", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (result.status !== 0) {
    const output = `${stdout}\n${stderr}`;
    if (isRetryableNotaryError(output)) {
      return { state: "unknown" };
    }
    return {
      state: "error",
      detail: output.trim() || `notarytool info exited with code ${result.status}`,
    };
  }

  try {
    const parsed = JSON.parse(stdout);
    const status = String(parsed.status || "").toLowerCase();
    if (status === "accepted") return { state: "accepted" };
    if (status === "in progress") return { state: "in-progress" };
    if (status === "rejected" || status === "invalid")
      return { state: "failed", detail: status };
    return { state: "unknown", detail: status || "empty status" };
  } catch (e) {
    return { state: "unknown", detail: "non-json notarytool info output" };
  }
}

async function waitForRequestResolution(requestId, auth) {
  const maxChecks = Number(process.env.NOTARIZE_STATUS_MAX_CHECKS || 18); // ~9m @ 30s interval
  const intervalMs = Number(process.env.NOTARIZE_STATUS_INTERVAL_MS || 30000);

  for (let check = 1; check <= maxChecks; check++) {
    const status = readNotaryRequestStatus(requestId, auth);
    if (status.state === "accepted") {
      console.log(`Notary request ${requestId} accepted.`);
      return { ok: true };
    }
    if (status.state === "failed" || status.state === "error") {
      return { ok: false, detail: status.detail || status.state };
    }

    console.warn(
      `Notary request ${requestId} check ${check}/${maxChecks}: ${
        status.state
      }. Waiting ${Math.round(intervalMs / 1000)}s...`
    );
    await sleep(intervalMs);
  }

  return { ok: false, detail: "timed out waiting for request resolution" };
}

function getBackoffMs(attempt) {
  const baseMs = Number(process.env.NOTARIZE_BACKOFF_BASE_MS || 10000);
  const capMs = Number(process.env.NOTARIZE_BACKOFF_CAP_MS || 120000);
  const jitterMs = Math.floor(Math.random() * 3000);
  const raw = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, capMs) + jitterMs;
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

  const maxAttempts = Number(process.env.NOTARIZE_MAX_ATTEMPTS || 8);

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
        // Apple may return 500 while the request is still processing.
        // Poll request status before deciding to resubmit.
        const resolution = await waitForRequestResolution(requestId, auth);
        if (resolution.ok) {
          console.log("Notarization complete (resolved via request polling).");
          return;
        }
        console.warn(
          `Notary request ${requestId} did not resolve successfully: ${resolution.detail}`
        );
      } else {
        console.warn(
          "No valid notary submission UUID found in error payload; skipping status polling for this attempt."
        );
      }

      if (!retryable || !hasNext) {
        throw error;
      }

      const waitMs = getBackoffMs(attempt);
      console.warn(
        `Notarization attempt ${attempt}/${maxAttempts} failed with Apple service 500. Retrying in ${Math.round(
          waitMs / 1000
        )}s...`
      );
      await sleep(waitMs);
    }
  }
};
