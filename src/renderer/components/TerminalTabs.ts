import { getState, setActiveTab, removeTab, renameTab, subscribe } from '../state/store.js';
import type { TerminalTab } from '../../shared/types.js';

export function createTerminalTabs(
  onTabSelect: (tabId: string) => void,
  onTabClose: (tabId: string) => void,
): HTMLElement {
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  let editingTabId: string | null = null;
  let lastNameClickTime = 0;
  let lastNameClickTabId: string | null = null;

  // Double-click detection via mousedown delegation on the persistent tabBar.
  // Native dblclick doesn't work because the first click triggers onTabSelect →
  // setState → render() → innerHTML rebuild, destroying the original DOM element
  // before the second click arrives.
  tabBar.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('tab-name')) return;
    const tabEl = target.closest('.tab') as HTMLElement;
    if (!tabEl) return;
    const tabId = tabEl.dataset.tabId!;

    const now = Date.now();
    if (lastNameClickTabId === tabId && now - lastNameClickTime < 400) {
      e.preventDefault();
      startEditing(tabId, tabEl);
      lastNameClickTabId = null;
      lastNameClickTime = 0;
      return;
    }
    lastNameClickTabId = tabId;
    lastNameClickTime = now;
  });

  function render() {
    const state = getState();
    const { tabs, activeTabId } = state;

    if (tabs.length === 0) {
      tabBar.innerHTML = '';
      editingTabId = null;
      return;
    }

    // Save editing state before innerHTML destroys the input.
    // Clear editingTabId first so the blur event (fired synchronously when the
    // focused input is removed from DOM) won't trigger a commit.
    const wasEditingTabId = editingTabId;
    let savedValue = '';
    if (wasEditingTabId) {
      const input = tabBar.querySelector('.tab-name-input') as HTMLInputElement | null;
      if (input) savedValue = input.value;
      editingTabId = null;
    }

    tabBar.innerHTML = tabs.map(tab => renderTab(tab, tab.id === activeTabId)).join('');

    // Bind click events
    tabBar.querySelectorAll('.tab').forEach(tabEl => {
      const tabId = (tabEl as HTMLElement).dataset.tabId!;
      tabEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tab-close')) return;
        if ((e.target as HTMLElement).classList.contains('tab-name-input')) return;
        onTabSelect(tabId);
      });
      tabEl.querySelector('.tab-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onTabClose(tabId);
      });
    });

    // Restore editing state if we were editing a tab that still exists
    if (wasEditingTabId && tabs.find(t => t.id === wasEditingTabId)) {
      const tabEl = tabBar.querySelector(`.tab[data-tab-id="${wasEditingTabId}"]`) as HTMLElement | null;
      if (tabEl) {
        startEditingWithValue(wasEditingTabId, tabEl, savedValue);
      }
    }
  }

  function startEditing(tabId: string, tabEl: HTMLElement) {
    const tab = getState().tabs.find(t => t.id === tabId);
    if (!tab) return;
    const displayName = tab.customName || tab.configName;
    setupInput(tabId, tabEl, displayName);
  }

  function startEditingWithValue(tabId: string, tabEl: HTMLElement, value: string) {
    setupInput(tabId, tabEl, value);
  }

  function setupInput(tabId: string, tabEl: HTMLElement, value: string) {
    const nameEl = tabEl.querySelector('.tab-name') as HTMLElement | null;
    if (!nameEl) return;

    const tab = getState().tabs.find(t => t.id === tabId);
    if (!tab) return;

    editingTabId = tabId;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-name-input';
    input.value = value;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      editingTabId = null;
      const newName = input.value.trim();
      if (newName === '' || newName === tab!.configName) {
        renameTab(tabId, undefined);
      } else {
        renameTab(tabId, newName);
      }
    }

    function cancel() {
      if (committed) return;
      committed = true;
      editingTabId = null;
      render();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      // Only commit if we're still the active editor. editingTabId is cleared
      // by render() before innerHTML rebuild, so a blur triggered by DOM
      // removal won't cause a spurious commit/re-render loop.
      if (editingTabId === tabId) {
        commit();
      }
    });
  }

  subscribe(render);
  render();
  return tabBar;
}

function renderTab(tab: TerminalTab, isActive: boolean): string {
  const statusClass = tab.status === 'exited' ? 'tab-exited' : '';
  const displayName = tab.customName || tab.configName;
  return `
    <div class="tab ${isActive ? 'active' : ''} ${statusClass}" data-tab-id="${tab.id}">
      <span class="tab-color" style="background: ${tab.configColor}"></span>
      <span class="tab-name">${escapeHtml(displayName)}</span>
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
