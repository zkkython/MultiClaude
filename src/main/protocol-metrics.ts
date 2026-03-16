import type { RunnerEvent } from './provider-adapter.js';

export interface RunnerMetricsSnapshot {
  counters: {
    interactionExpectedTotal: number;
    interactionTriggeredTotal: number;
    interactionFalsePositiveTotal: number;
    stateComparisonTotal: number;
    stateMismatchTotal: number;
    fallbackAttemptTotal: number;
    fallbackSuccessTotal: number;
  };
  rates: {
    interactionRecall: number | null;
    falsePositiveRate: number | null;
    stateMismatchRate: number | null;
    fallbackRecoveryRate: number | null;
  };
  goals: {
    interactionRecallGte99: boolean;
    falsePositiveRateLte0_5: boolean;
    stateMismatchRateLte0_5: boolean;
    fallbackRecoveryEq100: boolean;
    allMet: boolean;
  };
}

interface RecordInput {
  expectedInput?: boolean;
  expectedState?: string;
  actualState: string;
  events: RunnerEvent[];
}

const PERCENT = 100;

export class ProtocolMetricsCollector {
  private interactionExpectedTotal = 0;
  private interactionTriggeredTotal = 0;
  private interactionFalsePositiveTotal = 0;

  private stateComparisonTotal = 0;
  private stateMismatchTotal = 0;

  private fallbackAttemptTotal = 0;
  private fallbackSuccessTotal = 0;

  recordIngest(input: RecordInput): void {
    const triggered = input.events.some(event => event.type === 'input.requested');
    if (typeof input.expectedInput === 'boolean') {
      if (input.expectedInput) {
        this.interactionExpectedTotal += 1;
        if (triggered) {
          this.interactionTriggeredTotal += 1;
        }
      } else if (triggered) {
        this.interactionFalsePositiveTotal += 1;
      }
    }

    if (input.expectedState) {
      this.stateComparisonTotal += 1;
      if (normalizeState(input.expectedState) !== normalizeState(input.actualState)) {
        this.stateMismatchTotal += 1;
      }
    }

    const hasRecoverableFailure = input.events.some(
      event => event.type === 'session.failed' && Boolean((event as any).recoverable)
    );
    if (hasRecoverableFailure) {
      this.fallbackAttemptTotal += 1;
      const fallbackSuccess = input.events.some(
        event => event.type === 'status.changed' && String((event as any).to) === 'fallback_pty'
      );
      if (fallbackSuccess) {
        this.fallbackSuccessTotal += 1;
      }
    }
  }

  reset(): void {
    this.interactionExpectedTotal = 0;
    this.interactionTriggeredTotal = 0;
    this.interactionFalsePositiveTotal = 0;
    this.stateComparisonTotal = 0;
    this.stateMismatchTotal = 0;
    this.fallbackAttemptTotal = 0;
    this.fallbackSuccessTotal = 0;
  }

  snapshot(): RunnerMetricsSnapshot {
    const interactionRecall = safeRatio(this.interactionTriggeredTotal, this.interactionExpectedTotal);
    const falsePositiveRate = safeRatio(this.interactionFalsePositiveTotal, this.interactionExpectedTotal);
    const stateMismatchRate = safeRatio(this.stateMismatchTotal, this.stateComparisonTotal);
    const fallbackRecoveryRate = safeRatio(this.fallbackSuccessTotal, this.fallbackAttemptTotal);

    const interactionRecallPct = toPercent(interactionRecall);
    const falsePositiveRatePct = toPercent(falsePositiveRate);
    const stateMismatchRatePct = toPercent(stateMismatchRate);
    const fallbackRecoveryPct = toPercent(fallbackRecoveryRate);

    const goals = {
      interactionRecallGte99: interactionRecallPct !== null ? interactionRecallPct >= 99 : false,
      falsePositiveRateLte0_5: falsePositiveRatePct !== null ? falsePositiveRatePct <= 0.5 : false,
      stateMismatchRateLte0_5: stateMismatchRatePct !== null ? stateMismatchRatePct <= 0.5 : false,
      fallbackRecoveryEq100: fallbackRecoveryPct !== null ? fallbackRecoveryPct === 100 : false,
      allMet: false,
    };
    goals.allMet = goals.interactionRecallGte99
      && goals.falsePositiveRateLte0_5
      && goals.stateMismatchRateLte0_5
      && goals.fallbackRecoveryEq100;

    return {
      counters: {
        interactionExpectedTotal: this.interactionExpectedTotal,
        interactionTriggeredTotal: this.interactionTriggeredTotal,
        interactionFalsePositiveTotal: this.interactionFalsePositiveTotal,
        stateComparisonTotal: this.stateComparisonTotal,
        stateMismatchTotal: this.stateMismatchTotal,
        fallbackAttemptTotal: this.fallbackAttemptTotal,
        fallbackSuccessTotal: this.fallbackSuccessTotal,
      },
      rates: {
        interactionRecall: interactionRecallPct,
        falsePositiveRate: falsePositiveRatePct,
        stateMismatchRate: stateMismatchRatePct,
        fallbackRecoveryRate: fallbackRecoveryPct,
      },
      goals,
    };
  }
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function toPercent(ratio: number | null): number | null {
  if (ratio === null) return null;
  return Number((ratio * PERCENT).toFixed(3));
}

function normalizeState(value: string): string {
  return value.trim().toLowerCase();
}
