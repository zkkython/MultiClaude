import { getState, setActiveTab, removeTab, subscribe } from '../state/store.js';
import type { TerminalTab } from '../../shared/types.js';

export function createTerminalTabs(
  onTabSelect: (tabId: string) => void,
  onTabClose: (tabId: string) => void,
): HTMLElement {
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  function render() {
    const state = getState();
    const { tabs, activeTabId } = state;

    if (tabs.length === 0) {
      tabBar.innerHTML = '';
      tabBar.style.display = 'none';
      return;
    }

    tabBar.style.display = 'flex';
    tabBar.innerHTML = tabs.map(tab => renderTab(tab, tab.id === activeTabId)).join('');

    // Bind events
    tabBar.querySelectorAll('.tab').forEach(tabEl => {
      const tabId = (tabEl as HTMLElement).dataset.tabId!;
      tabEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tab-close')) return;
        onTabSelect(tabId);
      });
      tabEl.querySelector('.tab-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onTabClose(tabId);
      });
    });
  }

  subscribe(render);
  render();
  return tabBar;
}

function renderTab(tab: TerminalTab, isActive: boolean): string {
  const statusClass = tab.status === 'exited' ? 'tab-exited' : '';
  return `
    <div class="tab ${isActive ? 'active' : ''} ${statusClass}" data-tab-id="${tab.id}">
      <span class="tab-color" style="background: ${tab.configColor}"></span>
      <span class="tab-name">${escapeHtml(tab.configName)}</span>
      ${tab.status === 'exited' ? '<span class="tab-status-badge">exited</span>' : ''}
      <button class="tab-close" title="Close">✕</button>
    </div>
  `;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
