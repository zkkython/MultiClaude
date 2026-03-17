import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

interface PtyProcess {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitData: { exitCode: number; signal?: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
  pid: number;
}

// node-pty must be required at runtime (native module)
let nodePty: any;

function getPty() {
  if (!nodePty) {
    ensureNodePtySpawnHelperExecutable();
    nodePty = require('node-pty');
  }
  return nodePty;
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === 'win32') return;
  let packageRoot = '';
  try {
    const pkgJson = require.resolve('node-pty/package.json');
    packageRoot = path.dirname(pkgJson);
  } catch {
    return;
  }
  if (!packageRoot) return;

  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push(path.join(packageRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper'));
  }
  candidates.push(path.join(packageRoot, 'build', 'Release', 'spawn-helper'));

  for (const helperPath of candidates) {
    try {
      const stat = fs.statSync(helperPath);
      const mode = stat.mode & 0o777;
      if ((mode & 0o111) === 0) {
        fs.chmodSync(helperPath, 0o755);
      }
    } catch {
      // Best effort only.
    }
  }
}

const ptys = new Map<string, PtyProcess>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

function getShellCandidates(): string[] {
  if (process.platform === 'win32') {
    return [getDefaultShell(), 'cmd.exe', 'powershell.exe'];
  }
  const candidates = [
    getDefaultShell(),
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ];
  const unique: string[] = [];
  for (const item of candidates) {
    if (!item) continue;
    if (unique.includes(item)) continue;
    if (item.startsWith('/')) {
      if (!fs.existsSync(item)) continue;
    }
    unique.push(item);
  }
  return unique;
}

function getShellArgs(shell: string): string[] {
  if (process.platform === 'win32') {
    return [];
  }
  const base = shell.split('/').pop() || shell;
  if (base === 'bash' || base === 'zsh') {
    return ['-l'];
  }
  return [];
}

export function spawnPty(
  terminalId: string,
  env: Record<string, string>,
  onData: (data: string) => void,
  onExit: (code: number) => void,
): void {
  const pty = getPty();
  const sanitizedEnv = sanitizeEnv(env);
  const home = os.homedir();
  const shells = getShellCandidates();
  if (shells.length === 0) {
    throw new Error('No available shell candidates for PTY spawn');
  }

  let ptyProcess: PtyProcess | null = null;
  let lastErr: unknown = null;
  for (const shell of shells) {
    const shellArgs = getShellArgs(shell);
    try {
      ptyProcess = pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: home,
        env: sanitizedEnv,
      });
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!ptyProcess) {
    const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`PTY spawn failed for all shell candidates: ${reason}`);
  }

  ptyProcess.onData((data: string) => {
    onData(data);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    ptys.delete(terminalId);
    onExit(exitCode);
  });

  ptys.set(terminalId, ptyProcess);
}

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(env || {})) {
    if (!rawKey || rawKey.includes('=')) continue;
    const key = String(rawKey);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = String(rawVal ?? '').replace(/\u0000/g, '');
    next[key] = value;
  }
  return next;
}

export function writePty(terminalId: string, data: string): void {
  const ptyProcess = ptys.get(terminalId);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

export function resizePty(terminalId: string, cols: number, rows: number): void {
  const ptyProcess = ptys.get(terminalId);
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
}

export function killPty(terminalId: string): void {
  const ptyProcess = ptys.get(terminalId);
  if (ptyProcess) {
    ptyProcess.kill();
    ptys.delete(terminalId);
  }
}

export function killAllPtys(): void {
  for (const [id, ptyProcess] of ptys) {
    try {
      ptyProcess.kill();
    } catch (err) {
      // Ignore errors during cleanup
    }
  }
  ptys.clear();
}
