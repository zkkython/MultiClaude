import { getState, setState, subscribe } from '../state/store.js';
import { DEFAULTS } from '../../shared/constants.js';
import type { ModelConfig } from '../../shared/types.js';

export type SidebarAction =
  | { type: 'new-terminal'; configId: string }
  | { type: 'system-terminal'; configId: string }
  | { type: 'edit-config'; configId: string }
  | { type: 'duplicate-config'; configId: string }
  | { type: 'delete-config'; configId: string }
  | { type: 'new-config' }
  | { type: 'select-config'; configId: string };

export function createSidebar(onAction: (action: SidebarAction) => void): HTMLElement {
  const sidebar = document.createElement('div');
  sidebar.className = 'sidebar';

  // Titlebar drag region (matches the top padding area for window dragging)
  const titlebarDrag = document.createElement('div');
  titlebarDrag.className = 'sidebar-titlebar-drag';
  sidebar.appendChild(titlebarDrag);

  // Drag handle
  const dragHandle = document.createElement('div');
  dragHandle.className = 'sidebar-drag-handle';
  sidebar.appendChild(dragHandle);

  // Sidebar content
  const content = document.createElement('div');
  content.className = 'sidebar-content';
  sidebar.appendChild(content);

  function render() {
    const state = getState();
    const configs = state.configs;
    const showSearch = configs.length >= DEFAULTS.CONFIG_SEARCH_THRESHOLD;
    const filteredConfigs = state.searchQuery
      ? configs.filter(c => c.name.toLowerCase().includes(state.searchQuery.toLowerCase()))
      : configs;

    content.innerHTML = `
      <div class="sidebar-header">
        <h2>Configs</h2>
        <button class="btn btn-icon sidebar-add-btn" title="New Config">+</button>
      </div>
      ${showSearch ? `
        <div class="sidebar-search">
          <input type="text" placeholder="Search configs..." value="${escapeHtml(state.searchQuery)}" class="sidebar-search-input" />
        </div>
      ` : ''}
      <div class="config-list${state.selectedConfigId ? ' has-selection' : ''}">
        ${filteredConfigs.length === 0 ? `
          <div class="config-list-empty">
            ${state.searchQuery ? 'No matching configs' : 'No configs yet'}
          </div>
        ` : filteredConfigs.map(config => renderConfigItem(config, state.selectedConfigId)).join('')}
      </div>
    `;

    // Bind events
    const addBtn = content.querySelector('.sidebar-add-btn');
    addBtn?.addEventListener('click', () => onAction({ type: 'new-config' }));

    const searchInput = content.querySelector('.sidebar-search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        setState({ searchQuery: (e.target as HTMLInputElement).value });
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          setState({ searchQuery: '' });
        }
      });
    }

    // Config item clicks
    content.querySelectorAll('.config-item').forEach(item => {
      const configId = (item as HTMLElement).dataset.configId!;
      item.addEventListener('click', () => {
        onAction({ type: 'select-config', configId });
      });
      item.addEventListener('dblclick', () => {
        onAction({ type: 'new-terminal', configId });
      });
    });

    // Action buttons
    content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action!;
        const configId = (btn as HTMLElement).dataset.configId!;
        onAction({ type: action as any, configId });
      });
    });
  }

  // Drag resize logic
  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const delta = e.clientX - startX;
    const newWidth = Math.max(DEFAULTS.SIDEBAR_MIN_WIDTH, Math.min(DEFAULTS.SIDEBAR_MAX_WIDTH, startWidth + delta));
    sidebar.style.width = `${newWidth}px`;
    setState({ sidebarWidth: newWidth });
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist sidebar width
      window.multiclaude.app.saveSettings({ sidebarWidth: getState().sidebarWidth });
      // Trigger terminal refit
      window.dispatchEvent(new Event('resize'));
    }
  });

  subscribe(render);
  render();

  // Apply initial width
  const state = getState();
  sidebar.style.width = `${state.sidebarWidth}px`;

  return sidebar;
}

function renderConfigItem(config: ModelConfig, selectedId: string | null): string {
  const isSelected = config.id === selectedId;
  const providerLabel = config.provider === 'codex' ? 'Codex' : 'Claude';
  const modelSummary = config.provider === 'codex'
    ? (config.openaiModel || 'No model set')
    : (config.anthropicModel || 'No model set');
  const providerClass = config.provider === 'codex' ? 'provider-codex' : 'provider-claude';

  return `
    <div class="config-item ${isSelected ? 'selected' : ''}" data-config-id="${config.id}">
      <div class="config-item-header">
        <span class="config-color-dot" style="background: ${config.color}"></span>
        <span class="config-name">${escapeHtml(config.name)}</span>
        <span class="provider-pill ${providerClass}">${providerLabel}</span>
      </div>
      <div class="config-item-detail">${escapeHtml(modelSummary)}</div>
      <div class="config-item-actions">
        <button class="action-btn action-btn-primary" data-action="new-terminal" data-config-id="${config.id}" title="Open embedded terminal">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5a.5.5 0 0 1 .5.3l4 6a.5.5 0 0 1-.4.7H2a.5.5 0 0 1-.4-.8l4-6a.5.5 0 0 1 .4-.2z" transform="rotate(90 8 8)"/></svg>
          Terminal
        </button>
        <button class="action-btn" data-action="system-terminal" data-config-id="${config.id}" title="Open in system terminal">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1.5 1.5l3 2.5-3 2.5V5.5zM8 11h4v1H8v-1z"/></svg>
          System
        </button>
        <button class="action-btn" data-action="edit-config" data-config-id="${config.id}" title="Edit configuration">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M12.1 1.3a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4L5.8 12.8l-3.5.9.9-3.5 8.9-8.9zM11 3.4L4 10.4l-.5 2.1 2.1-.5 7-7L11 3.4z"/></svg>
          Edit
        </button>
        <button class="action-btn" data-action="duplicate-config" data-config-id="${config.id}" title="Duplicate configuration">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 1.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5H4z"/><path d="M6 0h7a3 3 0 0 1 3 3v7a1 1 0 0 1-2 0V3a1 1 0 0 0-1-1H6a1 1 0 0 1 0-2z" opacity="0.5"/></svg>
          Copy
        </button>
        <button class="action-btn action-btn-danger" data-action="delete-config" data-config-id="${config.id}" title="Delete configuration">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5V2h3a.5.5 0 0 1 0 1H2.5a.5.5 0 0 1 0-1h3V1zM3 5v8.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V5H3zm3 1.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 1 0zm3 0v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 1 0zm3 0v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 1 0z"/></svg>
          Delete
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
