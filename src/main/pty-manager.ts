import * as os from 'os';
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
    nodePty = require('node-pty');
  }
  return nodePty;
}

const ptys = new Map<string, PtyProcess>();

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/zsh';
}

export function spawnPty(
  terminalId: string,
  env: Record<string, string>,
  onData: (data: string) => void,
  onExit: (code: number) => void,
): void {
  const pty = getPty();
  const shell = getDefaultShell();
  const home = os.homedir();

  const ptyProcess: PtyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: home,
    env,
  });

  ptyProcess.onData((data: string) => {
    onData(data);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    ptys.delete(terminalId);
    onExit(exitCode);
  });

  ptys.set(terminalId, ptyProcess);
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
