import { getRuntimeStateCounts, getState, getTabEffectiveState, subscribe } from '../state/store.js';

export function createStatusBar(onNextWaiting: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'status-bar';

  function render() {
    const state = getState();
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    const counts = getRuntimeStateCounts();
    const metrics = state.protocolMetrics;

    let statusText = '';
    if (activeTab) {
      const effectiveState = getTabEffectiveState(activeTab);
      const statusIcon = effectiveState === 'waiting' ? '◉' : effectiveState === 'running' ? '●' : '○';
      const provider = activeTab.provider === 'codex' ? 'Codex' : 'Claude';
      statusText = `<span class="status-indicator" style="color: ${activeTab.configColor}">${statusIcon}</span> ${activeTab.configName} · <span class="status-state">${effectiveState}</span> <span class="status-provider">(${provider})</span>`;
    }

    bar.innerHTML = `
      <div class="status-left">${statusText}</div>
      <div class="status-right">
        ${metrics ? `<span class="status-metric" title="Protocol Metrics">PR:${formatPct(metrics.rates.interactionRecall)} FP:${formatPct(metrics.rates.falsePositiveRate)} SM:${formatPct(metrics.rates.stateMismatchRate)} FR:${formatPct(metrics.rates.fallbackRecoveryRate)}</span><span class="status-sep">|</span>` : ''}
        <span class="status-waiting ${counts.waiting > 0 ? 'active' : ''}" title="Go to next waiting terminal">W:${counts.waiting}</span>
        <span class="status-sep">|</span>
        <span>R:${counts.running}</span>
        <span class="status-sep">|</span>
        <span>I:${counts.idle}</span>
        <span class="status-sep">|</span>
        <span>X:${counts.exited}</span>
      </div>
    `;

    const waitingEl = bar.querySelector('.status-waiting') as HTMLElement | null;
    if (waitingEl) {
      waitingEl.onclick = () => {
        if (counts.waiting > 0) onNextWaiting();
      };
    }
  }

  subscribe(render);
  render();
  return bar;
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '-';
  if (Number.isInteger(value)) return `${value}%`;
  return `${value.toFixed(1)}%`;
}
