import type { ClaudeHooksStatus, ModelConfig } from '../shared/types.js';

export type PreflightIssueSeverity = 'blocker' | 'warning';
export type PreflightFixAction = 'install-claude-hooks' | 'set-transport-pty' | 'clear-headers-json' | 'edit-config';

export interface PreflightIssue {
  severity: PreflightIssueSeverity;
  code: string;
  message: string;
  fixAction?: PreflightFixAction;
}

export interface PreflightCheckResult {
  blockers: string[];
  warnings: string[];
  issues: PreflightIssue[];
}

export function collectPreflightIssues(
  config: ModelConfig,
  options: {
    claudeHooksStatus?: ClaudeHooksStatus | null;
    claudeHooksError?: string | null;
  } = {},
): PreflightCheckResult {
  const issues: PreflightIssue[] = [];
  const addIssue = (
    severity: PreflightIssueSeverity,
    code: string,
    message: string,
    fixAction?: PreflightFixAction,
  ) => {
    issues.push({ severity, code, message, fixAction });
  };

  const codexApiEnvKey = (config.codexApiKeyEnvKey || 'OPENAI_API_KEY').trim();
  const customModel = config.provider === 'codex'
    ? (config.customEnvVars['OPENAI_MODEL'] || '').trim()
    : (config.customEnvVars['ANTHROPIC_MODEL'] || '').trim();
  const customKey = config.provider === 'codex'
    ? ((config.customEnvVars[codexApiEnvKey] || config.customEnvVars['OPENAI_API_KEY'] || '').trim())
    : (config.customEnvVars['ANTHROPIC_AUTH_TOKEN'] || '').trim();

  if (config.provider === 'codex') {
    if (!config.openaiModel.trim() && !customModel) {
      addIssue('blocker', 'missing_openai_model', 'Missing OPENAI model.', 'edit-config');
    }
    if (!config.openaiApiKey.trim() && !customKey) {
      addIssue('blocker', 'missing_openai_key', `Missing API key (${codexApiEnvKey || 'OPENAI_API_KEY'}).`, 'edit-config');
    }
    if (config.openaiBaseUrl.trim() && !isHttpUrl(config.openaiBaseUrl.trim())) {
      addIssue('blocker', 'invalid_openai_base_url', `Invalid OPENAI_BASE_URL: ${config.openaiBaseUrl.trim()}`, 'edit-config');
    }
  } else {
    if (!config.anthropicModel.trim() && !customModel) {
      addIssue('blocker', 'missing_claude_model', 'Missing Claude model.', 'edit-config');
    }
    if (!config.anthropicAuthToken.trim() && !customKey) {
      addIssue('blocker', 'missing_claude_token', 'Missing Claude auth token.', 'edit-config');
    }
    if (config.anthropicBaseUrl.trim() && !isHttpUrl(config.anthropicBaseUrl.trim())) {
      addIssue('blocker', 'invalid_anthropic_base_url', `Invalid ANTHROPIC_BASE_URL: ${config.anthropicBaseUrl.trim()}`, 'edit-config');
    }

    if (options.claudeHooksStatus && !options.claudeHooksStatus.installed) {
      const missing = options.claudeHooksStatus.missingEvents.length > 0
        ? ` missing: ${options.claudeHooksStatus.missingEvents.join(', ')}`
        : '';
      addIssue(
        'warning',
        'claude_hooks_missing',
        `Claude hooks are not fully installed; waiting detection may degrade.${missing}`,
        'install-claude-hooks',
      );
    }
    if (options.claudeHooksError) {
      addIssue('warning', 'claude_hooks_check_failed', `Could not verify Claude hooks status: ${options.claudeHooksError}`, 'install-claude-hooks');
    }
  }

  const transport = (config.customEnvVars['MC_PROTOCOL_TRANSPORT'] || '').trim().toLowerCase();
  if (transport && transport !== 'pty' && transport !== 'http_sse') {
    addIssue(
      'warning',
      'unknown_protocol_transport',
      `Unknown MC_PROTOCOL_TRANSPORT "${transport}". It will fall back to PTY.`,
      'set-transport-pty',
    );
  }
  if (transport === 'http_sse') {
    const explicitStreamUrl = (config.customEnvVars['MC_PROTOCOL_STREAM_URL'] || '').trim();
    const explicitInputUrl = (config.customEnvVars['MC_PROTOCOL_INPUT_URL'] || '').trim();
    const explicitInterruptUrl = (config.customEnvVars['MC_PROTOCOL_INTERRUPT_URL'] || '').trim();
    const explicitStopUrl = (config.customEnvVars['MC_PROTOCOL_STOP_URL'] || '').trim();
    const invalidUrl = [explicitStreamUrl, explicitInputUrl, explicitInterruptUrl, explicitStopUrl]
      .find(url => url && !isHttpUrl(url));
    if (invalidUrl) {
      addIssue('blocker', 'invalid_protocol_url', `Invalid protocol URL: ${invalidUrl}`, 'edit-config');
    }
    const headersJson = (config.customEnvVars['MC_PROTOCOL_HEADERS_JSON'] || '').trim();
    if (headersJson) {
      try {
        const parsed = JSON.parse(headersJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          addIssue(
            'blocker',
            'invalid_protocol_headers_shape',
            'MC_PROTOCOL_HEADERS_JSON must be a JSON object.',
            'clear-headers-json',
          );
        }
      } catch {
        addIssue(
          'blocker',
          'invalid_protocol_headers_json',
          'MC_PROTOCOL_HEADERS_JSON is not valid JSON.',
          'clear-headers-json',
        );
      }
    }
  }

  return {
    blockers: issues.filter(item => item.severity === 'blocker').map(item => item.message),
    warnings: issues.filter(item => item.severity === 'warning').map(item => item.message),
    issues,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
