import type { ConfigProvider, RuntimeState, RuntimeStateConfidence, RuntimeStateSource, TerminalRuntimeState } from '../shared/types.js';

interface AgentStateSession {
  provider: ConfigProvider;
  detectionMode: WaitingDetectionMode;
  state: RuntimeState;
  confidence: RuntimeStateConfidence;
  reason: string;
  source: RuntimeStateSource;
  lastOutputAt: number;
  lastInputAt: number;
  lastStateAt: number;
  waitingCooldownUntil: number;
  lineBuffer: string[];
}

type WaitingDetectionMode = 'heuristic' | 'strict';

interface RuntimeStatePayload extends TerminalRuntimeState {
  terminalId: string;
}

interface DetectionResult {
  state: RuntimeState;
  confidence: RuntimeStateConfidence;
  reason: string;
  source: RuntimeStateSource;
}

const WAITING_CONFIRM_MS = 900;
const IDLE_THRESHOLD_MS = 15_000;
const STATE_DEBOUNCE_MS = 300;
const WAITING_COOLDOWN_MS = 3_000;
const MAX_LINE_BUFFER = 12;
const MAX_LINE_LENGTH = 240;

const EXPLICIT_MARKER_RE = /__MC_STATE__:(waiting|running|idle|done|exited)/i;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

const HIGH_PATTERNS: RegExp[] = [
  /\bdo\s+you\s+want\s+to\b/i,
  /\bsave\s+file\s+to\s+continue\b/i,
  /\bpress\s+(?:enter|return)\s+to\s+continue\b/i,
  /\bapproval\s+required\b/i,
  /\bauthentication\s+required\b/i,
  /\b(?:allow|approve)\s*\/\s*(?:deny|reject)\b/i,
  /\bcontinue\?\s*\(?\s*y\/n\s*\)?/i,
  /\bconfirm\?\s*\(?\s*y\/n\s*\)?/i,
  /\bselect\s+(?:an?\s+)?option\b/i,
  /\bquestion\s+\d+\/\d+.*\bunanswered\b/i,
];

const MEDIUM_PATTERNS: RegExp[] = [
  /\bconfirm\b/i,
  /\bchoose\b/i,
  /\bselect\b/i,
  /\benter\s+(?:a\s+)?choice\b/i,
  /\brespond\b/i,
];

const LOW_PATTERNS: RegExp[] = [
  /\binput\b/i,
  /\bpress\s+key\b/i,
  /\bprompt\b/i,
];

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

  registerTerminal(terminalId: string, provider: ConfigProvider, detectionMode: WaitingDetectionMode = 'heuristic'): void {
    const now = Date.now();
    this.clearWaitingTimer(terminalId);
    this.sessions.set(terminalId, {
      provider,
      detectionMode,
      state: 'running',
      confidence: 'medium',
      reason: 'terminal spawned',
      source: 'process',
      lastOutputAt: now,
      lastInputAt: now,
      lastStateAt: now,
      waitingCooldownUntil: 0,
      lineBuffer: [],
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
    if (lines.length > 0) {
      session.lineBuffer.push(...lines);
      if (session.lineBuffer.length > MAX_LINE_BUFFER) {
        session.lineBuffer = session.lineBuffer.slice(-MAX_LINE_BUFFER);
      }
    }

    const explicit = this.findExplicitState(lines);
    if (explicit) {
      this.clearWaitingTimer(terminalId);
      this.transitionState(terminalId, explicit);
    } else if (session.detectionMode === 'strict') {
      this.clearWaitingTimer(terminalId);
      this.transitionState(terminalId, {
        state: 'running',
        confidence: 'low',
        reason: 'strict mode: awaiting explicit protocol/marker',
        source: 'timing',
      });
    } else {
      const detection = this.detectWaiting(session);
      if (detection?.confidence === 'high') {
        this.clearWaitingTimer(terminalId);
        this.transitionState(terminalId, detection);
      } else if (detection?.confidence === 'medium') {
        this.scheduleWaitingConfirm(terminalId, detection);
      } else {
        this.clearWaitingTimer(terminalId);
        this.transitionState(terminalId, {
          state: 'running',
          confidence: 'low',
          reason: 'streaming output',
          source: 'timing',
        });
      }
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

  private scheduleWaitingConfirm(terminalId: string, detection: DetectionResult): void {
    this.clearWaitingTimer(terminalId);
    const timer = setTimeout(() => {
      const session = this.sessions.get(terminalId);
      if (!session) return;
      const silentLongEnough = Date.now() - session.lastOutputAt >= WAITING_CONFIRM_MS;
      if (!silentLongEnough) return;
      this.transitionState(terminalId, detection);
    }, WAITING_CONFIRM_MS);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    this.waitingTimers.set(terminalId, timer);
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

  private detectWaiting(session: AgentStateSession): DetectionResult | null {
    const recent = session.lineBuffer;
    if (recent.length === 0) return null;

    if (matchesStructuredQuestion(recent)) {
      return {
        state: 'waiting',
        confidence: 'high',
        reason: 'interactive question/options pattern',
        source: 'pattern',
      };
    }

    const highHit = recent.some(line => HIGH_PATTERNS.some(re => re.test(line)));
    if (highHit) {
      return {
        state: 'waiting',
        confidence: 'high',
        reason: `${session.provider} high-signal waiting prompt`,
        source: 'keyword',
      };
    }

    const mediumHits = recent.reduce((acc, line) => acc + (MEDIUM_PATTERNS.some(re => re.test(line)) ? 1 : 0), 0);
    const lowHits = recent.reduce((acc, line) => acc + (LOW_PATTERNS.some(re => re.test(line)) ? 1 : 0), 0);
    if (mediumHits >= 2 || (mediumHits >= 1 && lowHits >= 1)) {
      return {
        state: 'waiting',
        confidence: 'medium',
        reason: `${session.provider} medium-signal waiting candidate`,
        source: 'keyword',
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
    .filter(Boolean)
    .map(line => line.slice(0, MAX_LINE_LENGTH));
}

function stripExplicitMarkerLines(input: string): string {
  const lines = input.split('\n');
  const filtered = lines.filter(line => !EXPLICIT_MARKER_RE.test(stripAnsi(line)));
  return filtered.join('\n');
}

function hasMeaningfulInput(input: string): boolean {
  return /[\r\n\t -~]/.test(input);
}

function matchesStructuredQuestion(lines: string[]): boolean {
  const hasQuestionHeader = lines.some(line =>
    /\bquestion\s+\d+\/\d+\b/i.test(line)
    || /\bunanswered\b/i.test(line)
    || /\bselect\b/i.test(line)
    || /\bdo\s+you\s+want\s+to\b/i.test(line)
    || /\?$/.test(line)
  );
  const optionCount = lines.filter(line => /^\s*(?:>\s*)?\d+\.\s+\S+/i.test(line)).length;
  const hasCursorPointer = lines.some(line => /^\s*>\s*\d+\./.test(line));
  return hasQuestionHeader && optionCount >= 2 && hasCursorPointer;
}
