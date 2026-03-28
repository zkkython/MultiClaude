#!/usr/bin/env node

/*
 * Claude Code hook bridge -> multiclaude runner side-channel.
 *
 * Reads hook event JSON from stdin and POSTs normalized state to
 * MC_RUNNER_EVENT_URL with MC_RUNNER_EVENT_TOKEN authentication.
 */

const RUNNER_URL = process.env.MC_RUNNER_EVENT_URL || '';
const RUNNER_TOKEN = process.env.MC_RUNNER_EVENT_TOKEN || '';
const TERMINAL_ID = process.env.MC_RUNNER_TERMINAL_ID || '';

if (!RUNNER_URL || !RUNNER_TOKEN || !TERMINAL_ID) {
  process.exit(0);
}

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
process.stdin.on('end', async () => {
  let payload;
  try {
    const text = Buffer.concat(chunks).toString('utf8').trim();
    payload = text ? JSON.parse(text) : {};
  } catch {
    process.exit(0);
    return;
  }

  const eventName = str(payload.hook_event_name) || str(payload.event) || '';
  if (!eventName) {
    process.exit(0);
    return;
  }

  const mapped = mapHookToRunnerState(eventName, payload);
  if (!mapped) {
    process.exit(0);
    return;
  }

  const body = {
    terminalId: TERMINAL_ID,
    state: mapped.state,
    inputKind: mapped.inputKind,
    prompt: mapped.prompt,
    requestId: mapped.requestId,
    source: 'claude-hook',
    rawHookEvent: {
      hook_event_name: eventName,
      session_id: str(payload.session_id) || null,
      transcript_path: str(payload.transcript_path) || null,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  if (typeof timeout.unref === 'function') timeout.unref();

  try {
    await fetch(RUNNER_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mc-runner-token': RUNNER_TOKEN,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Ignore hook forwarding failures; never block Claude.
  } finally {
    clearTimeout(timeout);
  }

  process.exit(0);
});

function mapHookToRunnerState(eventName, payload) {
  if (eventName === 'PermissionRequest') {
    const requestId =
      str(payload.request_id)
      || str(payload.permission_request_id)
      || `claude-hook-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const prompt =
      str(payload.message)
      || str(payload.notification)
      || str(payload.permission_prompt)
      || 'Claude requires user interaction';

    return {
      state: 'waiting',
      inputKind: 'approval',
      requestId,
      prompt,
    };
  }

  if (eventName === 'Notification') {
    // Notification is broad; only treat as waiting when payload carries
    // actionable/request-like structured signals.
    if (!isActionableNotification(payload)) {
      return null;
    }
    const requestId =
      str(payload.request_id)
      || str(payload.permission_request_id)
      || `claude-hook-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const prompt =
      str(payload.permission_prompt)
      || str(payload.prompt)
      || str(payload.message)
      || str(payload.notification)
      || 'Claude requires user interaction';
    return {
      state: 'waiting',
      inputKind: 'approval',
      requestId,
      prompt,
    };
  }

  if (eventName === 'Stop' || eventName === 'SubagentStop') {
    return {
      state: 'idle',
      inputKind: 'approval',
      requestId: '',
      prompt: '',
    };
  }

  if (eventName === 'UserPromptSubmit' || eventName === 'PreToolUse' || eventName === 'PostToolUse' || eventName === 'SessionStart') {
    return {
      state: 'running',
      inputKind: 'approval',
      requestId: '',
      prompt: '',
    };
  }

  return null;
}

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

function bool(v) {
  return v === true;
}

function hasNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function isActionableNotification(payload) {
  if (str(payload.request_id) || str(payload.permission_request_id) || str(payload.permission_prompt)) {
    return true;
  }
  if (bool(payload.requires_response) || bool(payload.requires_user_input) || bool(payload.blocking)) {
    return true;
  }
  if (hasNonEmptyArray(payload.options) || hasNonEmptyArray(payload.choices) || hasNonEmptyArray(payload.actions)) {
    return true;
  }
  return false;
}
