import { spawn } from 'child_process';
import type { ModelConfig } from '../shared/types.js';
import { buildEnvForConfig } from './env-builder.js';
import { ensureCodexApiKeyLogin } from './codex-auth.js';

export async function openSystemTerminal(config: ModelConfig): Promise<void> {
  const env = buildEnvForConfig(config);
  await ensureCodexApiKeyLogin(config, env);

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

  await spawnDetached('osascript', ['-e', appleScript], env);
}

async function openWindowsTerminal(config: ModelConfig, env: Record<string, string>): Promise<void> {
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'wt.exe', args: ['new-tab', '--title', config.name] },
    { cmd: 'cmd.exe', args: [] },
    { cmd: 'powershell.exe', args: [] },
  ];
  await openFirstAvailable(candidates, env);
}

async function openLinuxTerminal(config: ModelConfig, env: Record<string, string>): Promise<void> {
  const terminals: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'gnome-terminal', args: [] },
    { cmd: 'konsole', args: [] },
    { cmd: 'xfce4-terminal', args: [] },
    { cmd: 'xterm', args: [] },
  ];
  await openFirstAvailable(terminals, env);
}

async function openFirstAvailable(
  candidates: Array<{ cmd: string; args: string[] }>,
  env: Record<string, string>,
): Promise<void> {
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      await spawnDetached(candidate.cmd, candidate.args, env);
      return;
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError || new Error('No terminal emulator found');
}

async function spawnDetached(command: string, args: string[], env: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: 'ignore',
    });

    let settled = false;
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    child.unref();
  });
}

function escapeShellValue(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
