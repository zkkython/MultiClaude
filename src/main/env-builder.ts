import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ModelConfig } from '../shared/types.js';
import { getCodexHomePath, getEnvFilePath, getEnvFilesDir, getZdotdirPath } from './config-paths.js';

function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function buildEnvForConfig(config: ModelConfig): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  const providerEnv = config.provider === 'codex'
    ? buildCodexEnv(config)
    : buildClaudeEnv(config);
  const mergedConfigEnv = mergeWithProviderPriority(config.customEnvVars || {}, providerEnv);

  Object.assign(env, mergedConfigEnv);
  env['MULTICLAUDE_CONFIG_NAME'] = config.name;
  env['MULTICLAUDE_CONFIG_ID'] = config.id;
  env['MULTICLAUDE_PROVIDER'] = config.provider;

  const envFilePath = writeEnvFile(config, mergedConfigEnv);
  env['MULTICLAUDE_ENV_FILE'] = envFilePath;
  if (config.provider === 'claude') {
    env['CLAUDE_ENV_FILE'] = envFilePath;
  }

  const shell = process.env.SHELL || '/bin/zsh';
  if (shell.endsWith('zsh')) {
    env['ZDOTDIR'] = writeZdotdirWrapper(config, mergedConfigEnv);
  }

  return env;
}

function buildClaudeEnv(config: ModelConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.anthropicBaseUrl) env['ANTHROPIC_BASE_URL'] = config.anthropicBaseUrl;
  if (config.anthropicAuthToken) env['ANTHROPIC_AUTH_TOKEN'] = config.anthropicAuthToken;
  if (config.anthropicModel) env['ANTHROPIC_MODEL'] = config.anthropicModel;
  if (config.anthropicSmallFastModel) env['ANTHROPIC_SMALL_FAST_MODEL'] = config.anthropicSmallFastModel;
  if (config.apiTimeoutMs) env['API_TIMEOUT_MS'] = String(config.apiTimeoutMs);
  if (config.disableNonessentialTraffic) env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';

  return env;
}

function buildCodexEnv(config: ModelConfig): Record<string, string> {
  const env: Record<string, string> = {};
  const providerName = normalizeCodexProviderName(config.codexModelProvider);
  const apiKeyEnvKey = normalizeEnvVarName(config.codexApiKeyEnvKey || 'OPENAI_API_KEY');
  const wireApi = normalizeWireApi(config.codexWireApi, config.customEnvVars?.['CODEX_WIRE_API']);

  if (config.openaiBaseUrl) env['OPENAI_BASE_URL'] = config.openaiBaseUrl;
  if (config.openaiApiKey) {
    env[apiKeyEnvKey] = config.openaiApiKey;
    if (apiKeyEnvKey !== 'OPENAI_API_KEY' && providerName === 'openai') {
      env['OPENAI_API_KEY'] = config.openaiApiKey;
    }
  }
  if (config.openaiModel) env['OPENAI_MODEL'] = config.openaiModel;
  if (config.apiTimeoutMs) env['API_TIMEOUT_MS'] = String(config.apiTimeoutMs);

  const codexHomePath = getCodexHomePath(config);
  if (!fs.existsSync(codexHomePath)) {
    fs.mkdirSync(codexHomePath, { recursive: true });
  }
  env['CODEX_HOME'] = codexHomePath;
  writeCodexConfigToml(config, codexHomePath, providerName, apiKeyEnvKey, wireApi);

  return env;
}

function mergeWithProviderPriority(
  customEnvVars: Record<string, string>,
  providerEnv: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(customEnvVars)) {
    if (isValidEnvVarName(key) && value !== undefined) {
      merged[key] = value;
    }
  }
  Object.assign(merged, providerEnv);
  return merged;
}

function writeEnvFile(config: ModelConfig, configEnv: Record<string, string>): string {
  const envFileDir = getEnvFilesDir();
  if (!fs.existsSync(envFileDir)) {
    fs.mkdirSync(envFileDir, { recursive: true });
  }

  const envFilePath = getEnvFilePath(config.id);
  const exportLines = Object.entries(configEnv)
    .map(([k, v]) => `export ${k}=${escapeShellValue(v)}`)
    .join('\n');
  fs.writeFileSync(envFilePath, `#!/bin/sh\n# MultiClaude env for: ${config.name}\n${exportLines}\n`, { mode: 0o600 });
  return envFilePath;
}

function writeZdotdirWrapper(config: ModelConfig, configEnv: Record<string, string>): string {
  const zdotdir = getZdotdirPath(config.id);
  if (!fs.existsSync(zdotdir)) {
    fs.mkdirSync(zdotdir, { recursive: true });
  }

  const realZdotdir = process.env.ZDOTDIR || os.homedir();
  const exportLines = Object.entries(configEnv)
    .map(([k, v]) => `export ${k}=${escapeShellValue(v)}`)
    .join('\n');
  const wrapperRc = `# MultiClaude wrapper .zshrc for: ${config.name}
export ZDOTDIR=${escapeShellValue(realZdotdir)}

if [[ -f ${escapeShellValue(realZdotdir)}/.zshrc ]]; then
  source ${escapeShellValue(realZdotdir)}/.zshrc
fi

${exportLines}
`;
  fs.writeFileSync(path.join(zdotdir, '.zshrc'), wrapperRc, { mode: 0o600 });

  const wrapperProfile = `# MultiClaude wrapper .zprofile
export ZDOTDIR=${escapeShellValue(realZdotdir)}
if [[ -f ${escapeShellValue(realZdotdir)}/.zprofile ]]; then
  source ${escapeShellValue(realZdotdir)}/.zprofile
fi
${exportLines}
`;
  fs.writeFileSync(path.join(zdotdir, '.zprofile'), wrapperProfile, { mode: 0o600 });

  return zdotdir;
}

function escapeShellValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function writeCodexConfigToml(
  config: ModelConfig,
  codexHomePath: string,
  providerName: string,
  apiKeyEnvKey: string,
  wireApi: 'responses' | 'chat_completions'
): void {
  const configPath = path.join(codexHomePath, 'config.toml');
  const lines: string[] = [];

  if (config.codexPersonality.trim()) {
    lines.push(`personality = ${toTomlString(config.codexPersonality.trim())}`);
  }
  lines.push(`model_provider = ${toTomlString(providerName)}`);
  if (config.openaiModel.trim()) {
    lines.push(`model = ${toTomlString(config.openaiModel.trim())}`);
  }
  if (config.codexModelReasoningEffort.trim()) {
    lines.push(`model_reasoning_effort = ${toTomlString(config.codexModelReasoningEffort.trim())}`);
  }

  const providerKey = toTomlBareKey(providerName);
  lines.push(`[model_providers.${providerKey}]`);
  lines.push(`name = ${toTomlString(providerName)}`);
  lines.push(`wire_api = ${toTomlString(wireApi)}`);
  if (config.openaiBaseUrl.trim()) {
    lines.push(`base_url = ${toTomlString(config.openaiBaseUrl.trim())}`);
  }
  lines.push(`env_key = ${toTomlString(apiKeyEnvKey)}`);
  lines.push('');

  fs.writeFileSync(configPath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function toTomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toTomlBareKey(value: string): string {
  const key = value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return key || 'openai';
}

function normalizeCodexProviderName(value: string): string {
  const trimmed = (value || '').trim();
  return trimmed || 'openai';
}

function normalizeEnvVarName(value: string): string {
  const trimmed = (value || '').trim();
  const normalized = trimmed.replace(/[^A-Za-z0-9_]/g, '_');
  return normalized || 'OPENAI_API_KEY';
}

function normalizeWireApi(
  value: string | undefined,
  customValue?: string
): 'responses' | 'chat_completions' {
  if (value === 'responses' || value === 'chat_completions') {
    return value;
  }
  if (customValue === 'responses' || customValue === 'chat_completions') {
    return customValue;
  }
  return 'responses';
}
