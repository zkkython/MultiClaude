import { spawn } from 'child_process';
import type { ModelConfig } from '../shared/types.js';
import { buildEnvForConfig } from './env-builder.js';
import { ensureCodexApiKeyLogin } from './codex-auth.js';

export async function openSystemTerminal(config: ModelConfig): Promise<void> {
  const env = buildEnvForConfig(config);
  ensureCodexApiKeyLogin(config, env);

  if (process.platform === 'darwin') {
    await openMacTerminal(config, env);
  } else if (process.platform === 'win32') {
    await openWindowsTerminal(config, env);
  } else {
    await openLinuxTerminal(config, env);
  }
}

async function openMacTerminal(config: ModelConfig, env: Record<string, string>): Promise<void> {
  // Strategy: Terminal.app opens a new window with user's login shell, which
  // sources ~/.zshrc (setting the user's default env vars). Then we use
  // osascript `do script` to source our env file in that window, overriding
  // the variables that ~/.zshrc set. Simple and reliable.
  const envFilePath = env['MULTICLAUDE_ENV_FILE'];
  if (!envFilePath) return;

  // The `do script` command: source the env file, then show a brief confirmation
  const cmd = `source ${escapeShellValue(envFilePath)} && echo "[MultiClaude] ${config.provider} config loaded: ${config.name.replace(/"/g, '')}"`;

  // Escape for AppleScript double-quoted string
  const escapedCmd = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const appleScript = `
tell application "Terminal"
  activate
  do script "${escapedCmd}"
end tell
  `.trim();

  spawn('osascript', ['-e', appleScript], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

async function openWindowsTerminal(config: ModelConfig, env: Record<string, string>): Promise<void> {
  try {
    spawn('wt.exe', ['new-tab', '--title', config.name], {
      env,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch {
    spawn('cmd.exe', [], {
      env,
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}

async function openLinuxTerminal(config: ModelConfig, env: Record<string, string>): Promise<void> {
  const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
  for (const term of terminals) {
    try {
      spawn(term, [], {
        env,
        detached: true,
        stdio: 'ignore',
      }).unref();
      return;
    } catch {
      continue;
    }
  }
  throw new Error('No terminal emulator found');
}

function escapeShellValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
