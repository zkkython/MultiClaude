import type { RuntimeState, RuntimeStateConfidence, RuntimeStateSource, TerminalRuntimeState } from '../shared/types.js';

interface AgentStateSession {
  state: RuntimeState;
  confidence: RuntimeStateConfidence;
  reason: string;
  source: RuntimeStateSource;
  lastOutputAt: number;
  lastInputAt: number;
  lastStateAt: number;
  waitingCooldownUntil: number;
}

interface RuntimeStatePayload extends TerminalRuntimeState {
  terminalId: string;
}

interface DetectionResult {
  state: RuntimeState;
  confidence: RuntimeStateConfidence;
  reason: string;
  source: RuntimeStateSource;
}

const IDLE_THRESHOLD_MS = 15_000;
const STATE_DEBOUNCE_MS = 300;
const WAITING_COOLDOWN_MS = 3_000;

const EXPLICIT_MARKER_RE = /__MC_STATE__:(waiting|running|idle|done|exited)/i;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export class AgentStateEngine {
  private sessions = new Map<string, AgentStateSession>();

  private waitingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private onStateChange: ((payload: RuntimeStatePayload) => void) | null = null;

  private idleTicker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startIdleTicker();
  }

  setStateListener(listener: (payload: RuntimeStatePayload) => void): void {
    this.onStateChange = listener;
  }

  registerTerminal(terminalId: string): void {
    const now = Date.now();
    this.clearWaitingTimer(terminalId);
    this.sessions.set(terminalId, {
      state: 'running',
      confidence: 'medium',
      reason: 'terminal spawned',
      source: 'process',
      lastOutputAt: now,
      lastInputAt: now,
      lastStateAt: now,
      waitingCooldownUntil: 0,
    });
    this.emitState(terminalId);
  }

  unregisterTerminal(terminalId: string): void {
    this.clearWaitingTimer(terminalId);
    this.sessions.delete(terminalId);
  }

  onInput(terminalId: string, input: string): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    session.lastInputAt = Date.now();
    if (session.state === 'waiting') {
      // Waiting should only be resolved by explicit submit/cancel actions
      // (e.g. Enter/Esc), not by navigation keys or in-progress typing.
      if (!hasSubmitInput(input) && !hasCancelInput(input)) return;
    }
    if (hasMeaningfulInput(input)) {
      this.clearWaitingTimer(terminalId);
      this.transitionState(terminalId, {
        state: 'running',
        confidence: 'medium',
        reason: 'user input received',
        source: 'timing',
      });
    }
  }

  onOutput(terminalId: string, data: string): string {
    const session = this.sessions.get(terminalId);
    if (!session) return data;

    session.lastOutputAt = Date.now();
    const lines = toNormalizedLines(data);

    const explicit = this.findExplicitState(lines);
    if (explicit) {
      this.clearWaitingTimer(terminalId);
      this.transitionState(terminalId, explicit);
    } else if (session.state === 'waiting') {
      // Once waiting is active, plain output/noise must not clear it.
      return stripExplicitMarkerLines(data);
    } else {
      this.clearWaitingTimer(terminalId);
      this.transitionState(terminalId, {
        state: 'running',
        confidence: 'low',
        reason: 'awaiting explicit protocol/marker',
        source: 'timing',
      });
    }

    return stripExplicitMarkerLines(data);
  }

  onExit(terminalId: string): void {
    this.clearWaitingTimer(terminalId);
    this.transitionState(terminalId, {
      state: 'exited',
      confidence: 'high',
      reason: 'pty exited',
      source: 'process',
    }, true);
  }

  applyExplicitState(
    terminalId: string,
    state: RuntimeState,
    reason: string,
    confidence: RuntimeStateConfidence = 'high'
  ): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    const now = Date.now();
    if (state === 'running' || state === 'idle' || state === 'waiting') {
      session.lastOutputAt = now;
    }
    this.clearWaitingTimer(terminalId);
    this.transitionState(terminalId, {
      state,
      confidence,
      reason,
      source: 'explicit',
    }, true);
  }

  getSnapshot(): Record<string, TerminalRuntimeState> {
    const result: Record<string, TerminalRuntimeState> = {};
    for (const [terminalId, session] of this.sessions) {
      result[terminalId] = {
        state: session.state,
        confidence: session.confidence,
        reason: session.reason,
        source: session.source,
        updatedAt: session.lastStateAt,
      };
    }
    return result;
  }

  private startIdleTicker(): void {
    if (this.idleTicker) return;
    this.idleTicker = setInterval(() => {
      const now = Date.now();
      for (const [terminalId, session] of this.sessions) {
        if (session.state === 'exited' || session.state === 'waiting') continue;
        if (now - session.lastOutputAt >= IDLE_THRESHOLD_MS) {
          this.clearWaitingTimer(terminalId);
          this.transitionState(terminalId, {
            state: 'idle',
            confidence: 'medium',
            reason: 'no output for 15s',
            source: 'timing',
          });
        }
      }
    }, 2_000);
    if (typeof (this.idleTicker as any).unref === 'function') {
      (this.idleTicker as any).unref();
    }
  }

  private clearWaitingTimer(terminalId: string): void {
    const timer = this.waitingTimers.get(terminalId);
    if (!timer) return;
    clearTimeout(timer);
    this.waitingTimers.delete(terminalId);
  }

  private findExplicitState(lines: string[]): DetectionResult | null {
    for (const line of lines) {
      const match = line.match(EXPLICIT_MARKER_RE);
      if (!match) continue;
      const raw = match[1].toLowerCase();
      const state: RuntimeState = raw === 'done' ? 'running' : raw as RuntimeState;
      return {
        state,
        confidence: 'high',
        reason: `explicit marker: ${raw}`,
        source: 'explicit',
      };
    }
    return null;
  }

  private transitionState(terminalId: string, next: DetectionResult, force = false): void {
    const session = this.sessions.get(terminalId);
    if (!session) return;
    const now = Date.now();

    if (!force && next.state === 'waiting' && now < session.waitingCooldownUntil) {
      return;
    }

    const stateChanged = session.state !== next.state;
    if (!force && stateChanged && now - session.lastStateAt < STATE_DEBOUNCE_MS) {
      return;
    }

    if (!stateChanged) {
      if (session.reason !== next.reason || session.confidence !== next.confidence || session.source !== next.source) {
        session.reason = next.reason;
        session.confidence = next.confidence;
        session.source = next.source;
        session.lastStateAt = now;
        this.emitState(terminalId);
      }
      return;
    }

    if (session.state === 'waiting' && next.state !== 'waiting') {
      session.waitingCooldownUntil = now + WAITING_COOLDOWN_MS;
    }

    session.state = next.state;
    session.confidence = next.confidence;
    session.reason = next.reason;
    session.source = next.source;
    session.lastStateAt = now;
    this.emitState(terminalId);
  }

  private emitState(terminalId: string): void {
    const session = this.sessions.get(terminalId);
    if (!session || !this.onStateChange) return;
    this.onStateChange({
      terminalId,
      state: session.state,
      confidence: session.confidence,
      reason: session.reason,
      source: session.source,
      updatedAt: session.lastStateAt,
    });
  }
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '');
}

function toNormalizedLines(input: string): string[] {
  return stripAnsi(input)
    .split(/\r?\n/)
    .map(line => line.replace(CONTROL_CHARS_RE, '').trim())
    .filter(Boolean);
}

function stripExplicitMarkerLines(input: string): string {
  const lines = input.split('\n');
  const filtered = lines.filter(line => !EXPLICIT_MARKER_RE.test(stripAnsi(line)));
  return filtered.join('\n');
}

function hasMeaningfulInput(input: string): boolean {
  if (!input) return false;
  // Keep Enter as an explicit user action, but ignore terminal control sequences
  // (focus in/out, arrows, etc.) that should not resolve waiting.
  if (/[\r\n]/.test(input)) return true;
  const stripped = input
    // SS3 sequences (e.g. ESC O A/B/C/D in application cursor mode)
    .replace(/\x1bO./g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-~]/g, '')
    .replace(CONTROL_CHARS_RE, '');
  return /[^\s]/.test(stripped);
}

function hasSubmitInput(input: string): boolean {
  return /[\r\n]/.test(input);
}

function hasCancelInput(input: string): boolean {
  // Esc key in xterm typically emits a single ESC byte.
  return /^\x1b+$/.test(input);
}
