import { spawnSync } from 'child_process';
import type { ModelConfig } from '../shared/types.js';

export function ensureCodexApiKeyLogin(config: ModelConfig, env: Record<string, string>): void {
  if (config.provider !== 'codex') return;
  const providerName = (config.codexModelProvider || 'openai').trim().toLowerCase();
  if (providerName !== 'openai') return;

  const keyEnv = (config.codexApiKeyEnvKey || 'OPENAI_API_KEY').trim();
  const apiKey = (env[keyEnv] || env['OPENAI_API_KEY'] || '').trim();
  if (!apiKey) return;

  const statusResult = spawnSync('codex', ['login', 'status'], {
    env,
    encoding: 'utf-8',
  });
  if (statusResult.error && (statusResult.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return;
  }
  if (statusResult.status === 0 && statusResult.stdout.includes('Logged in')) {
    return;
  }

  const loginResult = spawnSync('codex', ['login', '--with-api-key'], {
    env,
    input: `${apiKey}\n`,
    encoding: 'utf-8',
  });
  if (loginResult.error && (loginResult.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return;
  }
  if (loginResult.status !== 0) {
    const stderr = (loginResult.stderr || '').trim();
    const stdout = (loginResult.stdout || '').trim();
    throw new Error(stderr || stdout || 'Failed to initialize Codex API-key login');
  }
}
