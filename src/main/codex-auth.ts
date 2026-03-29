import { spawn } from 'child_process';
import type { ModelConfig } from '../shared/types.js';

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
  timedOut: boolean;
}

type RunCodexFn = (
  args: string[],
  env: Record<string, string>,
  input?: string,
  timeoutMs?: number,
) => Promise<ExecResult>;

function runCodex(
  args: string[],
  env: Record<string, string>,
  input?: string,
  timeoutMs = 8000,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let notFound = false;
    let timedOut = false;

    const child = spawn('codex', args, { env, stdio: 'pipe' });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        notFound = true;
      } else {
        stderr += err.message;
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, notFound, timedOut });
    });

    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

let runCodexImpl: RunCodexFn = runCodex;

export function __setRunCodexForTest(fn: RunCodexFn | null): void {
  runCodexImpl = fn || runCodex;
}

export async function ensureCodexApiKeyLogin(config: ModelConfig, env: Record<string, string>): Promise<void> {
  if (config.provider !== 'codex') return;
  const providerName = (config.codexModelProvider || 'openai').trim().toLowerCase();
  if (providerName !== 'openai') return;

  const keyEnv = (config.codexApiKeyEnvKey || 'OPENAI_API_KEY').trim();
  const apiKey = (env[keyEnv] || env['OPENAI_API_KEY'] || '').trim();
  if (!apiKey) return;

  const statusResult = await runCodexImpl(['login', 'status'], env, undefined, 5000);
  if (statusResult.notFound) {
    return;
  }
  if (!statusResult.timedOut && statusResult.code === 0 && statusResult.stdout.includes('Logged in')) {
    return;
  }

  const loginResult = await runCodexImpl(['login', '--with-api-key'], env, `${apiKey}\n`, 10000);
  if (loginResult.notFound) {
    return;
  }
  if (loginResult.timedOut) {
    throw new Error('Timed out while initializing Codex API-key login');
  }
  if (loginResult.code !== 0) {
    const stderr = (loginResult.stderr || '').trim();
    const stdout = (loginResult.stdout || '').trim();
    throw new Error(stderr || stdout || 'Failed to initialize Codex API-key login');
  }
}
