import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import type { ModelConfig } from '../shared/types.js';

export function buildEnvForConfig(config: ModelConfig): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };

  // Collect the config env vars we want to inject
  const configEnv: Record<string, string> = {};

  // Core Anthropic env vars
  if (config.anthropicBaseUrl) {
    configEnv['ANTHROPIC_BASE_URL'] = config.anthropicBaseUrl;
  }
  if (config.anthropicAuthToken) {
    configEnv['ANTHROPIC_AUTH_TOKEN'] = config.anthropicAuthToken;
  }
  if (config.anthropicModel) {
    configEnv['ANTHROPIC_MODEL'] = config.anthropicModel;
  }
  if (config.anthropicSmallFastModel) {
    configEnv['ANTHROPIC_SMALL_FAST_MODEL'] = config.anthropicSmallFastModel;
  }
  if (config.apiTimeoutMs) {
    configEnv['API_TIMEOUT_MS'] = String(config.apiTimeoutMs);
  }
  if (config.disableNonessentialTraffic) {
    configEnv['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1';
  }

  // Custom env vars
  if (config.customEnvVars) {
    for (const [key, value] of Object.entries(config.customEnvVars)) {
      if (key && value !== undefined) {
        configEnv[key] = value;
      }
    }
  }

  // Apply to env
  Object.assign(env, configEnv);

  // Tag the terminal so user can identify it
  env['MULTICLAUDE_CONFIG_NAME'] = config.name;
  env['MULTICLAUDE_CONFIG_ID'] = config.id;

  // Create a CLAUDE_ENV_FILE for Claude Code to source on startup
  const envFileDir = path.join(app.getPath('userData'), 'env-files');
  if (!fs.existsSync(envFileDir)) {
    fs.mkdirSync(envFileDir, { recursive: true });
  }
  const envFilePath = path.join(envFileDir, `${config.id}.sh`);
  const exportLines = Object.entries(configEnv)
    .map(([k, v]) => `export ${k}=${escapeShellValue(v)}`)
    .join('\n');
  fs.writeFileSync(envFilePath, `#!/bin/sh\n# MultiClaude env for: ${config.name}\n${exportLines}\n`, { mode: 0o600 });
  env['CLAUDE_ENV_FILE'] = envFilePath;

  // Use ZDOTDIR trick to ensure our env vars survive ~/.zshrc sourcing.
  // We create a custom ZDOTDIR with a .zshrc that:
  //   1. Restores the real ZDOTDIR and sources the user's original .zshrc
  //   2. Re-exports our config env vars (overriding whatever .zshrc set)
  const shell = process.env.SHELL || '/bin/zsh';
  if (shell.endsWith('zsh')) {
    const zdotdir = path.join(envFileDir, `zdotdir-${config.id}`);
    if (!fs.existsSync(zdotdir)) {
      fs.mkdirSync(zdotdir, { recursive: true });
    }

    const realZdotdir = process.env.ZDOTDIR || os.homedir();
    const wrapperRc = `# MultiClaude wrapper .zshrc for: ${config.name}
# Restore original ZDOTDIR so nested shells work normally
export ZDOTDIR=${escapeShellValue(realZdotdir)}

# Source the user's real .zshrc
if [[ -f ${escapeShellValue(realZdotdir)}/.zshrc ]]; then
  source ${escapeShellValue(realZdotdir)}/.zshrc
fi

# Re-export MultiClaude config env vars (override anything .zshrc set)
${exportLines}
`;
    fs.writeFileSync(path.join(zdotdir, '.zshrc'), wrapperRc, { mode: 0o600 });

    // Also handle .zprofile for login shells
    const wrapperProfile = `# MultiClaude wrapper .zprofile
export ZDOTDIR=${escapeShellValue(realZdotdir)}
if [[ -f ${escapeShellValue(realZdotdir)}/.zprofile ]]; then
  source ${escapeShellValue(realZdotdir)}/.zprofile
fi
${exportLines}
`;
    fs.writeFileSync(path.join(zdotdir, '.zprofile'), wrapperProfile, { mode: 0o600 });

    env['ZDOTDIR'] = zdotdir;
  }

  return env;
}

function escapeShellValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
