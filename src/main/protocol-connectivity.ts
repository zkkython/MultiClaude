import type { ProtocolConnectivityCheckInput, ProtocolConnectivityCheckResult } from '../shared/types.js';
import { inferHttpSseDefaultsFromInput } from './runner-transport-factory.js';

export async function runProtocolConnectivityTest(input: ProtocolConnectivityCheckInput): Promise<ProtocolConnectivityCheckResult> {
  const customEnv = input.customEnvVars ?? {};
  const transportType = ((customEnv['MC_PROTOCOL_TRANSPORT'] || '').trim().toLowerCase() === 'http_sse')
    ? 'http_sse'
    : 'pty';
  if (transportType === 'pty') {
    return {
      ok: true,
      transportType,
      summary: 'Transport is PTY. Protocol connectivity test skipped.',
      details: [
        {
          name: 'transport',
          ok: true,
          message: 'PTY mode does not require remote protocol endpoints.',
        },
      ],
    };
  }

  const defaults = inferHttpSseDefaultsFromInput(input);
  const streamUrl = (customEnv['MC_PROTOCOL_STREAM_URL'] || '').trim() || defaults.streamUrl;
  const inputUrl = (customEnv['MC_PROTOCOL_INPUT_URL'] || '').trim() || defaults.inputUrl;
  const interruptUrl = (customEnv['MC_PROTOCOL_INTERRUPT_URL'] || '').trim() || defaults.interruptUrl;
  const stopUrl = (customEnv['MC_PROTOCOL_STOP_URL'] || '').trim() || defaults.stopUrl;
  const headers: Record<string, string> = { ...defaults.headers };

  const authHeader = (customEnv['MC_PROTOCOL_AUTH_HEADER'] || '').trim();
  const authToken = (customEnv['MC_PROTOCOL_AUTH_TOKEN'] || '').trim();
  if (authHeader && authToken) {
    headers[authHeader] = authToken;
  }

  const checks: ProtocolConnectivityCheckResult['details'] = [];
  checks.push(await checkEndpoint('stream', streamUrl, 'GET', headers));
  checks.push(await checkEndpoint('input', inputUrl, 'POST', headers, {
    sessionId: 'connectivity-test',
    requestId: 'connectivity-test',
    type: 'user_response',
    text: 'ping',
  }));
  if (interruptUrl) {
    checks.push(await checkEndpoint('interrupt', interruptUrl, 'POST', headers, {
      sessionId: 'connectivity-test',
    }));
  }
  if (stopUrl) {
    checks.push(await checkEndpoint('stop', stopUrl, 'POST', headers, {
      sessionId: 'connectivity-test',
    }));
  }

  const ok = checks.every(item => item.ok);
  return {
    ok,
    transportType,
    summary: ok ? 'All protocol endpoint checks passed.' : 'One or more protocol endpoint checks failed.',
    details: checks,
  };
}

export async function checkEndpoint(
  name: string,
  url: string | undefined,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: Record<string, unknown>
): Promise<{ name: string; ok: boolean; status?: number; message: string; url?: string }> {
  if (!url) {
    return {
      name,
      ok: false,
      message: 'Missing URL',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  if (typeof (timeout as any).unref === 'function') {
    (timeout as any).unref();
  }

  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      message: response.ok ? 'ok' : `HTTP ${response.status}`,
      url,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}
