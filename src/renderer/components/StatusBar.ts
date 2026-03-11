import { getState, subscribe } from '../state/store.js';

export function createStatusBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'status-bar';

  function render() {
    const state = getState();
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    const runningCount = state.tabs.filter(t => t.status === 'running').length;

    let statusText = '';
    if (activeTab) {
      const statusIcon = activeTab.status === 'running' ? '●' : '○';
      statusText = `<span class="status-indicator" style="color: ${activeTab.configColor}">${statusIcon}</span> ${activeTab.configName}`;
    }

    bar.innerHTML = `
      <div class="status-left">${statusText}</div>
      <div class="status-right">
        <span>${state.configs.length} config${state.configs.length !== 1 ? 's' : ''}</span>
        <span class="status-sep">|</span>
        <span>${runningCount} terminal${runningCount !== 1 ? 's' : ''} running</span>
      </div>
    `;
  }

  subscribe(render);
  render();
  return bar;
}
