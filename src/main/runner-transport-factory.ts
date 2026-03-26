import type { ModelConfig, ProtocolConnectivityCheckInput } from '../shared/types.js';
import { PtyProtocolSessionTransport, type ProtocolSessionTransport } from './protocol-session-transport.js';
import { HttpSseProtocolSessionTransport } from './protocol-http-transport.js';
import { killPty, writePty } from './pty-manager.js';

export interface HttpSseTransportDefaults {
  streamUrl?: string;
  inputUrl: string;
  interruptUrl?: string;
  stopUrl?: string;
  headers: Record<string, string>;
}

export function createSessionTransport(
  config: ModelConfig,
  sessionId: string,
  terminalId: string
): { transport: ProtocolSessionTransport; transportType: 'pty' | 'http_sse' } {
  const transportType = (config.customEnvVars.MC_PROTOCOL_TRANSPORT || '').trim().toLowerCase();
  if (transportType === 'http_sse') {
    const inferred = inferHttpSseDefaults(config);
    const streamUrl = (config.customEnvVars.MC_PROTOCOL_STREAM_URL || '').trim() || inferred.streamUrl;
    const inputUrl = (config.customEnvVars.MC_PROTOCOL_INPUT_URL || '').trim() || inferred.inputUrl;
    const interruptUrl = (config.customEnvVars.MC_PROTOCOL_INTERRUPT_URL || '').trim() || inferred.interruptUrl;
    const stopUrl = (config.customEnvVars.MC_PROTOCOL_STOP_URL || '').trim() || inferred.stopUrl;
    if (inputUrl) {
      const headers: Record<string, string> = { ...inferred.headers };
      const authHeader = (config.customEnvVars.MC_PROTOCOL_AUTH_HEADER || '').trim();
      const authToken = (config.customEnvVars.MC_PROTOCOL_AUTH_TOKEN || '').trim();
      if (authHeader && authToken) {
        headers[authHeader] = authToken;
      }
      const rawHeaderJson = (config.customEnvVars.MC_PROTOCOL_HEADERS_JSON || '').trim();
      if (rawHeaderJson) {
        try {
          const parsed = JSON.parse(rawHeaderJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, value] of Object.entries(parsed)) {
              if (typeof key === 'string' && typeof value === 'string') {
                headers[key] = value;
              }
            }
          }
        } catch {
          // Ignore malformed header JSON and continue with inferred headers.
        }
      }
      return {
        transport: new HttpSseProtocolSessionTransport({
          sessionId,
          streamUrl,
          inputUrl,
          interruptUrl: interruptUrl || undefined,
          stopUrl: stopUrl || undefined,
          headers,
          reconnectMax: parsePositiveInt(config.customEnvVars.MC_PROTOCOL_RECONNECT_MAX),
          reconnectBaseMs: parsePositiveInt(config.customEnvVars.MC_PROTOCOL_RECONNECT_BASE_MS),
        }),
        transportType: 'http_sse',
      };
    }
  }

  return {
    transport: new PtyProtocolSessionTransport({
      write: (data: string) => writePty(terminalId, data),
      kill: () => killPty(terminalId),
    }),
    transportType: 'pty',
  };
}

export function inferHttpSseDefaults(config: ModelConfig): HttpSseTransportDefaults {
  if (config.provider === 'claude') {
    const baseUrl = trimTrailingSlash(config.anthropicBaseUrl || 'https://api.anthropic.com');
    const token = (config.anthropicAuthToken || '').trim();
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
    };
    if (token) {
      headers['x-api-key'] = token;
    }
    return {
      streamUrl: `${baseUrl}/v1/messages/stream`,
      inputUrl: `${baseUrl}/v1/messages/input`,
      interruptUrl: `${baseUrl}/v1/messages/interrupt`,
      stopUrl: `${baseUrl}/v1/messages/stop`,
      headers,
    };
  }

  const baseUrl = trimTrailingSlash(config.openaiBaseUrl || 'https://api.openai.com');
  const token = (config.openaiApiKey || '').trim();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return {
    streamUrl: `${baseUrl}/v1/responses/stream`,
    inputUrl: `${baseUrl}/v1/responses/input`,
    interruptUrl: `${baseUrl}/v1/responses/interrupt`,
    stopUrl: `${baseUrl}/v1/responses/cancel`,
    headers,
  };
}

export function inferHttpSseDefaultsFromInput(input: ProtocolConnectivityCheckInput): HttpSseTransportDefaults {
  if (input.provider === 'claude') {
    const baseUrl = trimTrailingSlash(input.anthropicBaseUrl || 'https://api.anthropic.com');
    const token = (input.anthropicAuthToken || '').trim();
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
    };
    if (token) {
      headers['x-api-key'] = token;
    }
    return {
      streamUrl: `${baseUrl}/v1/messages/stream`,
      inputUrl: `${baseUrl}/v1/messages/input`,
      interruptUrl: `${baseUrl}/v1/messages/interrupt`,
      stopUrl: `${baseUrl}/v1/messages/stop`,
      headers,
    };
  }

  const baseUrl = trimTrailingSlash(input.openaiBaseUrl || 'https://api.openai.com');
  const token = (input.openaiApiKey || '').trim();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return {
    streamUrl: `${baseUrl}/v1/responses/stream`,
    inputUrl: `${baseUrl}/v1/responses/input`,
    interruptUrl: `${baseUrl}/v1/responses/interrupt`,
    stopUrl: `${baseUrl}/v1/responses/cancel`,
    headers,
  };
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}
