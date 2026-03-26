import { getState, setState, subscribe } from '../state/store.js';
import { DEFAULTS } from '../../shared/constants.js';
import type { ModelConfig } from '../../shared/types.js';
import { collectPreflightIssues } from '../preflight.js';

export type SidebarAction =
  | { type: 'new-terminal'; configId: string }
  | { type: 'worktree-terminal'; configId: string }
  | { type: 'system-terminal'; configId: string }
  | { type: 'edit-config'; configId: string }
  | { type: 'duplicate-config'; configId: string }
  | { type: 'delete-config'; configId: string }
  | { type: 'new-config' }
  | { type: 'select-config'; configId: string };

export function buildConfigActionsMarkup(configId: string): string {
  return `
    <button class="action-btn action-btn-primary" data-action="new-terminal" data-config-id="${configId}" title="Open embedded terminal">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3.5a.5.5 0 0 1 .5.3l4 6a.5.5 0 0 1-.4.7H2a.5.5 0 0 1-.4-.8l4-6a.5.5 0 0 1 .4-.2z" transform="rotate(90 8 8)"/></svg>
      Terminal
    </button>
    <button class="action-btn" data-action="worktree-terminal" data-config-id="${configId}" title="Create/open git worktree terminal">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h5v2H4v3H2V2zm12 0v5h-2V4h-3V2h5zM2 14v-5h2v3h3v2H2zm12-5v5h-5v-2h3V9h2zM6 6h4v4H6V6z"/></svg>
      Worktree
    </button>
    <div class="config-action-more" data-more-root>
      <button class="action-btn action-btn-more" data-more-toggle title="More actions (System, Edit, Copy, Delete)" aria-label="More actions: System, Edit, Copy, Delete" aria-haspopup="menu" aria-expanded="false">⋯</button>
      <div class="config-action-menu" data-more-menu>
        <button class="action-btn" data-action="system-terminal" data-config-id="${configId}" title="Open in system terminal">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1.5 1.5l3 2.5-3 2.5V5.5zM8 11h4v1H8v-1z"/></svg>
          System
        </button>
        <button class="action-btn" data-action="edit-config" data-config-id="${configId}" title="Edit configuration">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M12.1 1.3a1 1 0 0 1 1.4 0l1.2 1.2a1 1 0 0 1 0 1.4L5.8 12.8l-3.5.9.9-3.5 8.9-8.9zM11 3.4L4 10.4l-.5 2.1 2.1-.5 7-7L11 3.4z"/></svg>
          Edit
        </button>
        <button class="action-btn" data-action="duplicate-config" data-config-id="${configId}" title="Duplicate configuration">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 1.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5H4z"/><path d="M6 0h7a3 3 0 0 1 3 3v7a1 1 0 0 1-2 0V3a1 1 0 0 0-1-1H6a1 1 0 0 1 0-2z" opacity="0.5"/></svg>
          Copy
        </button>
        <button class="action-btn action-btn-danger" data-delete-arm data-config-id="${configId}" title="Delete configuration">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 1a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5V2h3a.5.5 0 0 1 0 1H2.5a.5.5 0 0 1 0-1h3V1zM3 5v8.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V5H3zm3 1.5v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 1 0zm3 0v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 1 0zm3 0v6a.5.5 0 0 1-1 0v-6a.5.5 0 0 1 1 0z"/></svg>
          Delete…
        </button>
        <div class="delete-confirm-block" data-delete-confirm>
          <div class="delete-confirm-title">Delete config permanently?</div>
          <div class="delete-confirm-actions">
            <button class="action-btn" data-delete-cancel>Cancel</button>
            <button class="action-btn action-btn-danger" data-action="delete-config" data-config-id="${configId}">Delete</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

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
  let prevConfigsRef: ModelConfig[] | null = null;
  let prevSelectedConfigId: string | null = null;
  let prevSearchQuery = '';
  let prevSidebarWidth = -1;
  let preflightRefreshSeq = 0;
  let showMoreCoachmark = readMoreCoachmarkFlag();
  const preflightByConfigId = new Map<string, { level: 'ok' | 'warning' | 'blocker'; title: string }>();

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
        ` : filteredConfigs.map(config => renderConfigItem(config, state.selectedConfigId, preflightByConfigId.get(config.id), showMoreCoachmark)).join('')}
      </div>
    `;
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

  content.addEventListener('input', (e) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.classList.contains('sidebar-search-input')) return;
    setState({ searchQuery: target.value });
  });

  content.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.classList.contains('sidebar-search-input') && e.key === 'Escape') {
      setState({ searchQuery: '' });
      return;
    }

    const configItem = target.closest('.config-item') as HTMLElement | null;
    if (!configItem) return;
    if (target.closest('[data-action]') || target.closest('[data-more-root]')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const configId = configItem.dataset.configId;
    if (!configId) return;
    onAction({ type: 'select-config', configId });
  });

  content.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-action]') || target.closest('[data-more-root]')) return;
    const configItem = target.closest('.config-item') as HTMLElement | null;
    if (!configItem?.dataset.configId) return;
    onAction({ type: 'new-terminal', configId: configItem.dataset.configId });
  });

  content.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('.sidebar-add-btn')) {
      onAction({ type: 'new-config' });
      return;
    }

    const actionButton = target.closest('[data-action]') as HTMLElement | null;
    if (actionButton?.dataset.action && actionButton.dataset.configId) {
      closeAllMoreMenus();
      onAction({ type: actionButton.dataset.action as any, configId: actionButton.dataset.configId });
      return;
    }

    const moreToggle = target.closest('[data-more-toggle]') as HTMLElement | null;
    if (moreToggle) {
      const root = moreToggle.closest('[data-more-root]') as HTMLElement | null;
      if (!root) return;
      const configItem = root.closest('.config-item') as HTMLElement | null;
      const willOpen = !root.classList.contains('is-open');
      closeAllMoreMenus();
      if (willOpen) {
        if (showMoreCoachmark) {
          showMoreCoachmark = false;
          writeMoreCoachmarkFlag();
          render();
        }
        root.classList.add('is-open');
        configItem?.classList.add('menu-open');
        moreToggle.setAttribute('aria-expanded', 'true');
      } else {
        moreToggle.setAttribute('aria-expanded', 'false');
      }
      return;
    }

    const armDelete = target.closest('[data-delete-arm]') as HTMLElement | null;
    if (armDelete) {
      const root = armDelete.closest('[data-more-root]') as HTMLElement | null;
      if (!root) return;
      root.classList.add('delete-armed');
      return;
    }

    const cancelDelete = target.closest('[data-delete-cancel]') as HTMLElement | null;
    if (cancelDelete) {
      const root = cancelDelete.closest('[data-more-root]') as HTMLElement | null;
      if (!root) return;
      root.classList.remove('delete-armed');
      return;
    }

    if (target.closest('[data-more-root]')) {
      return;
    }

    const configItem = target.closest('.config-item') as HTMLElement | null;
    if (!configItem?.dataset.configId) return;
    onAction({ type: 'select-config', configId: configItem.dataset.configId });
  });

  const closeMoreMenusByEvent = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-more-root]')) return;
    closeAllMoreMenus();
  };
  document.addEventListener('pointerdown', closeMoreMenusByEvent, true);
  document.addEventListener('mousedown', closeMoreMenusByEvent, true);
  document.addEventListener('click', closeMoreMenusByEvent, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllMoreMenus();
  });
  window.addEventListener('blur', () => {
    closeAllMoreMenus();
  });

  subscribe(() => {
    const state = getState();
    const shouldRender = prevConfigsRef !== state.configs
      || prevSelectedConfigId !== state.selectedConfigId
      || prevSearchQuery !== state.searchQuery;
    if (prevSidebarWidth !== state.sidebarWidth) {
      sidebar.style.width = `${state.sidebarWidth}px`;
      prevSidebarWidth = state.sidebarWidth;
    }
    if (!shouldRender) return;
    const configChanged = prevConfigsRef !== state.configs;
    prevConfigsRef = state.configs;
    prevSelectedConfigId = state.selectedConfigId;
    prevSearchQuery = state.searchQuery;
    render();
    if (configChanged) {
      void refreshPreflightBadges(state.configs);
    }
  });
  render();

  // Apply initial width
  const state = getState();
  sidebar.style.width = `${state.sidebarWidth}px`;
  prevConfigsRef = state.configs;
  prevSelectedConfigId = state.selectedConfigId;
  prevSearchQuery = state.searchQuery;
  prevSidebarWidth = state.sidebarWidth;
  void refreshPreflightBadges(state.configs);

  return sidebar;

  async function refreshPreflightBadges(configs: ModelConfig[]): Promise<void> {
    const seq = ++preflightRefreshSeq;
    const next = new Map<string, { level: 'ok' | 'warning' | 'blocker'; title: string }>();
    let claudeHooksStatus: Awaited<ReturnType<typeof window.multiclaude.protocol.getClaudeHooksStatus>> | null = null;
    let claudeHooksError: string | null = null;

    if (configs.some(config => config.provider === 'claude')) {
      try {
        claudeHooksStatus = await window.multiclaude.protocol.getClaudeHooksStatus();
      } catch (err) {
        claudeHooksError = formatError(err);
      }
    }

    for (const config of configs) {
      const result = collectPreflightIssues(
        config,
        config.provider === 'claude'
          ? { claudeHooksStatus, claudeHooksError }
          : undefined
      );
      const topIssue = result.issues[0];
      if (topIssue?.severity === 'blocker') {
        next.set(config.id, { level: 'blocker', title: topIssue.message });
        continue;
      }
      if (result.warnings.length > 0) {
        next.set(config.id, { level: 'warning', title: result.warnings[0] });
        continue;
      }
      next.set(config.id, { level: 'ok', title: 'Preflight check passed' });
    }

    if (seq !== preflightRefreshSeq) return;
    const changed = configs.some(config => {
      const prev = preflightByConfigId.get(config.id);
      const curr = next.get(config.id);
      return !prev || !curr || prev.level !== curr.level || prev.title !== curr.title;
    }) || preflightByConfigId.size !== next.size;
    if (!changed) return;
    preflightByConfigId.clear();
    for (const [key, value] of next.entries()) {
      preflightByConfigId.set(key, value);
    }
    render();
  }

  function closeAllMoreMenus(): void {
    content.querySelectorAll('.config-action-more.is-open').forEach((root) => {
      root.classList.remove('is-open');
      root.classList.remove('delete-armed');
      const configItem = (root as HTMLElement).closest('.config-item') as HTMLElement | null;
      configItem?.classList.remove('menu-open');
      const toggle = (root as HTMLElement).querySelector('[data-more-toggle]') as HTMLElement | null;
      toggle?.setAttribute('aria-expanded', 'false');
    });
  }
}

function renderConfigItem(
  config: ModelConfig,
  selectedId: string | null,
  preflight?: { level: 'ok' | 'warning' | 'blocker'; title: string },
  showMoreCoachmark?: boolean,
): string {
  const isSelected = config.id === selectedId;
  const providerLabel = config.provider === 'codex' ? 'Codex' : 'Claude';
  const modelSummary = config.provider === 'codex'
    ? (config.openaiModel || 'No model set')
    : (config.anthropicModel || 'No model set');
  const providerClass = config.provider === 'codex' ? 'provider-codex' : 'provider-claude';
  const preflightClass = preflight ? `preflight-${preflight.level}` : 'preflight-pending';
  const preflightLabel = preflight?.level === 'blocker'
    ? 'BLOCK'
    : preflight?.level === 'warning'
      ? 'WARN'
      : preflight?.level === 'ok'
        ? 'OK'
        : '...';
  const preflightTitle = preflight?.title || 'Checking preflight...';

  return `
    <div
      class="config-item ${isSelected ? 'selected' : ''}"
      data-config-id="${config.id}"
      role="button"
      tabindex="0"
      aria-label="Select config ${escapeHtml(config.name)}"
      aria-pressed="${isSelected ? 'true' : 'false'}"
    >
      <div class="config-item-header">
        <span class="config-color-dot" style="background: ${config.color}"></span>
        <span class="config-name">${escapeHtml(config.name)}</span>
        <span class="preflight-pill ${preflightClass}" title="${escapeHtml(preflightTitle)}">${preflightLabel}</span>
        <span class="provider-pill ${providerClass}">${providerLabel}</span>
      </div>
      <div class="config-item-detail">${escapeHtml(modelSummary)}</div>
      <div class="config-item-actions">
        ${buildConfigActionsMarkup(config.id)}
      </div>
      <div class="config-actions-hint${showMoreCoachmark ? ' is-coachmark' : ''}">${showMoreCoachmark ? 'Tip: click … once to reveal System/Edit/Copy/Delete.' : 'More menu: System, Edit, Copy, Delete'}</div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function readMoreCoachmarkFlag(): boolean {
  try {
    return localStorage.getItem('multiclaude.moreMenuCoachmarkSeen') !== '1';
  } catch {
    return true;
  }
}

function writeMoreCoachmarkFlag(): void {
  try {
    localStorage.setItem('multiclaude.moreMenuCoachmarkSeen', '1');
  } catch {
    // Ignore storage write failures.
  }
}
