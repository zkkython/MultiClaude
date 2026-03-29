import {
  createGroup,
  deleteGroup,
  getGroupTabIds,
  getScreens,
  getState,
  getTabEffectiveState,
  moveTabToNewScreen,
  moveTabToScreen,
  moveTabToGroup,
  renameTab,
  renameGroup,
  getTabScreenId,
  removeTabFromGroup,
  setActiveScreen,
  setActiveTab,
  subscribe,
  toggleGroupCollapse,
} from '../state/store.js';
import {
  createRenameImeGuardState,
  getRenameKeyIntent,
  onRenameCompositionEnd,
  onRenameCompositionStart,
} from './screen-workspace-ime-guard.js';

interface ScreenWorkspaceCallbacks {
  onTabClose: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onCloseAllTabsInScreen: (screenId: string) => void;
  onRemoveScreen: (screenId: string) => void;
  onLayoutChanged: () => void;
}

let inlineEditingGuard = false;

export function isScreenWorkspaceInlineEditing(): boolean {
  return inlineEditingGuard;
}

export function moveTabToExistingScreenAction(
  tabId: string,
  targetScreenId: string,
  onLayoutChanged: () => void,
): boolean {
  if (!moveTabToScreen(tabId, targetScreenId)) return false;
  setActiveScreen(targetScreenId);
  setActiveTab(tabId);
  onLayoutChanged();
  return true;
}

export function moveTabToNewScreenAction(
  tabId: string,
  onLayoutChanged: () => void,
): string | null {
  const targetScreenId = moveTabToNewScreen(tabId);
  if (!targetScreenId) return null;
  setActiveScreen(targetScreenId);
  setActiveTab(tabId);
  onLayoutChanged();
  return targetScreenId;
}

export function createGroupFromTabAction(
  screenId: string,
  tabId: string,
  onLayoutChanged: () => void,
  nameOverride?: string,
): string {
  const screen = getState().screens.find(item => item.id === screenId);
  const tab = screen?.tabs.find(item => item.id === tabId);
  setActiveScreen(screenId);
  const groupId = createGroup(
    nameOverride || tab?.configName || 'New Group',
    tab?.configColor || '#89b4fa',
    [tabId],
    tab ? [tab.configId] : undefined,
  );
  onLayoutChanged();
  return groupId;
}

export function renameGroupInlineAction(
  screenId: string,
  groupId: string,
  nextName: string,
  onLayoutChanged: () => void,
): boolean {
  const trimmed = nextName.trim();
  if (!trimmed) return false;
  setActiveScreen(screenId);
  renameGroup(groupId, trimmed);
  onLayoutChanged();
  return true;
}

export function createScreenWorkspace(callbacks: ScreenWorkspaceCallbacks): HTMLElement {
  const root = document.createElement('div');
  root.className = 'screen-workspace';
  let editingTabId: string | null = null;
  let editingGroupId: string | null = null;
  let editingGroupDraft: string | null = null;
  let pendingNewGroupId: string | null = null;
  let pendingFocusTabId: string | null = null;
  let pendingFocusGroupId: string | null = null;
  let preparingInlineEdit = false;
  let lastLayoutRenderKey = '';
  type PaneCacheEntry = {
    pane: HTMLElement;
    tabsStrip: HTMLElement;
    terminalHost: HTMLElement;
    screenId: string;
    tabsRenderKey: string;
  };
  const paneCache = new Map<string, PaneCacheEntry>();

  function refreshInlineEditingGuard(): void {
    inlineEditingGuard = Boolean(editingTabId || editingGroupId || preparingInlineEdit);
    root.dataset.inlineEditing = inlineEditingGuard ? '1' : '0';
  }

  function closeContextMenus(): void {
    document.querySelectorAll('.screen-tab-context-menu').forEach(el => el.remove());
  }

  function showTabContextMenu(tabId: string, screenId: string, x: number, y: number): void {
    closeContextMenus();
    const state = getState();
    const screens = state.screens;
    const resolvedScreenId = getTabScreenId(tabId) || screenId;
    const screen = screens.find(item => item.id === resolvedScreenId);
    const currentGroup = screen?.groups.find(group => group.tabIds.includes(tabId));
    const menu = document.createElement('div');
    menu.className = 'screen-tab-context-menu tab-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const moveExisting = document.createElement('div');
    moveExisting.className = 'tab-context-menu-item has-submenu';
    moveExisting.textContent = 'Move To Screen';
    const moveExistingArrow = document.createElement('span');
    moveExistingArrow.className = 'tab-context-menu-arrow';
    moveExistingArrow.textContent = '▸';
    moveExisting.appendChild(moveExistingArrow);

    const moveExistingSubmenu = document.createElement('div');
    moveExistingSubmenu.className = 'tab-context-submenu';
    for (const screen of screens) {
      if (screen.id === resolvedScreenId) continue;
      const item = document.createElement('div');
      item.className = 'tab-context-menu-item';
      item.textContent = screen.name;
      item.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        moveTabToExistingScreenAction(tabId, screen.id, callbacks.onLayoutChanged);
        closeContextMenus();
      });
      moveExistingSubmenu.appendChild(item);
    }
    if (moveExistingSubmenu.children.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-context-menu-item';
      empty.textContent = 'No other screens';
      moveExistingSubmenu.appendChild(empty);
    }
    const sepNewScreen = document.createElement('div');
    sepNewScreen.className = 'tab-context-menu-separator';
    moveExistingSubmenu.appendChild(sepNewScreen);
    const moveNew = document.createElement('div');
    moveNew.className = 'tab-context-menu-item';
    moveNew.textContent = '+ New Screen...';
    if (screens.length >= 4) {
      moveNew.classList.add('screen-tab-context-disabled');
    } else {
      moveNew.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        moveTabToNewScreenAction(tabId, callbacks.onLayoutChanged);
        closeContextMenus();
      });
    }
    moveExistingSubmenu.appendChild(moveNew);
    moveExisting.appendChild(moveExistingSubmenu);
    menu.appendChild(moveExisting);

    const sep = document.createElement('div');
    sep.className = 'tab-context-menu-separator';
    menu.appendChild(sep);

    const moveGroup = document.createElement('div');
    moveGroup.className = 'tab-context-menu-item has-submenu';
    moveGroup.textContent = 'Move To Group';
    const moveGroupArrow = document.createElement('span');
    moveGroupArrow.className = 'tab-context-menu-arrow';
    moveGroupArrow.textContent = '▸';
    moveGroup.appendChild(moveGroupArrow);
    const moveGroupSubmenu = document.createElement('div');
    moveGroupSubmenu.className = 'tab-context-submenu';
    if (screen) {
      for (const group of screen.groups) {
        if (currentGroup?.id === group.id) continue;
        const item = document.createElement('div');
        item.className = 'tab-context-menu-item';
        item.textContent = group.name;
        item.addEventListener('click', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          setActiveScreen(resolvedScreenId);
          moveTabToGroup(tabId, group.id);
          callbacks.onLayoutChanged();
          closeContextMenus();
        });
        moveGroupSubmenu.appendChild(item);
      }
    }
    if (!screen || screen.groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-context-menu-item';
      empty.textContent = 'No groups';
      moveGroupSubmenu.appendChild(empty);
    }
    const sepGroup = document.createElement('div');
    sepGroup.className = 'tab-context-menu-separator';
    moveGroupSubmenu.appendChild(sepGroup);
    const newGroup = document.createElement('div');
    newGroup.className = 'tab-context-menu-item';
    newGroup.textContent = '+ New Group...';
    newGroup.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl?.closest('.terminal-view') || activeEl?.closest('.xterm')) {
        activeEl.blur();
      }
      preparingInlineEdit = true;
      refreshInlineEditingGuard();
      const groupId = createGroupFromTabAction(resolvedScreenId, tabId, callbacks.onLayoutChanged);
      editingGroupId = groupId;
      preparingInlineEdit = false;
      const createdGroup = getState().screens
        .find(item => item.id === resolvedScreenId)
        ?.groups.find(item => item.id === groupId);
      editingGroupDraft = createdGroup?.name || null;
      pendingNewGroupId = groupId;
      pendingFocusGroupId = groupId;
      refreshInlineEditingGuard();
      render();
      closeContextMenus();
    });
    moveGroupSubmenu.appendChild(newGroup);
    if (currentGroup) {
      const sepRemove = document.createElement('div');
      sepRemove.className = 'tab-context-menu-separator';
      moveGroupSubmenu.appendChild(sepRemove);
      const remove = document.createElement('div');
      remove.className = 'tab-context-menu-item';
      remove.textContent = 'Remove From Group';
      remove.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        setActiveScreen(resolvedScreenId);
        removeTabFromGroup(tabId);
        callbacks.onLayoutChanged();
        closeContextMenus();
      });
      moveGroupSubmenu.appendChild(remove);
    }
    moveGroup.appendChild(moveGroupSubmenu);
    menu.appendChild(moveGroup);

    const sep2 = document.createElement('div');
    sep2.className = 'tab-context-menu-separator';
    menu.appendChild(sep2);

    const closeOthers = document.createElement('div');
    closeOthers.className = 'tab-context-menu-item';
    closeOthers.textContent = 'Close Other Tabs';
    closeOthers.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      callbacks.onCloseOtherTabs(tabId);
      closeContextMenus();
    });
    menu.appendChild(closeOthers);

    const closeAll = document.createElement('div');
    closeAll.className = 'tab-context-menu-item tab-context-menu-item-danger';
    closeAll.textContent = 'Close All Tabs (This Screen)';
    closeAll.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      callbacks.onCloseAllTabsInScreen(resolvedScreenId);
      closeContextMenus();
    });
    menu.appendChild(closeAll);

    document.body.appendChild(menu);

    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 4}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 4}px`;
      }
    });
  }

  function showGroupContextMenu(groupId: string, screenId: string, x: number, y: number): void {
    closeContextMenus();
    const screen = getState().screens.find(item => item.id === screenId);
    const group = screen?.groups.find(item => item.id === groupId);
    if (!group) return;
    const menu = document.createElement('div');
    menu.className = 'screen-tab-context-menu tab-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const rename = document.createElement('div');
    rename.className = 'tab-context-menu-item';
    rename.textContent = 'Rename Group';
    rename.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      setActiveScreen(screenId);
      editingGroupId = groupId;
      editingGroupDraft = group.name;
      pendingFocusGroupId = groupId;
      refreshInlineEditingGuard();
      render();
      closeContextMenus();
    });
    menu.appendChild(rename);

    const closeGroup = document.createElement('div');
    closeGroup.className = 'tab-context-menu-item';
    closeGroup.textContent = 'Close All Tabs';
    closeGroup.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      setActiveScreen(screenId);
      const tabIds = getGroupTabIds(groupId);
      for (const tabId of tabIds) {
        callbacks.onTabClose(tabId);
      }
      callbacks.onLayoutChanged();
      closeContextMenus();
    });
    menu.appendChild(closeGroup);

    const del = document.createElement('div');
    del.className = 'tab-context-menu-item tab-context-menu-item-danger';
    del.textContent = 'Delete Group';
    del.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      setActiveScreen(screenId);
      deleteGroup(groupId);
      callbacks.onLayoutChanged();
      closeContextMenus();
    });
    menu.appendChild(del);

    document.body.appendChild(menu);
  }

  function buildTabsRenderKey(
    screen: ReturnType<typeof getScreens>[number],
    state: ReturnType<typeof getState>,
  ): string {
    const tabKey = screen.tabs.map(tab => [
      tab.id,
      tab.customName || tab.configName,
      tab.configColor,
      getTabEffectiveState(tab),
    ].join(':')).join('|');
    const groupKey = screen.groups.map(group => [
      group.id,
      group.name,
      group.color,
      group.collapsed ? '1' : '0',
      group.tabIds.join(','),
    ].join(':')).join('|');
    const tabEditingKey = editingTabId && screen.tabs.some(tab => tab.id === editingTabId)
      ? `tab-edit:${editingTabId}:${pendingFocusTabId || ''}`
      : '';
    const groupEditingKey = editingGroupId && screen.groups.some(group => group.id === editingGroupId)
      ? `group-edit:${editingGroupId}:${editingGroupDraft || ''}:${pendingFocusGroupId || ''}:${pendingNewGroupId || ''}`
      : '';
    return [
      state.activeScreenId === screen.id ? '1' : '0',
      screen.activeTabId || '',
      tabKey,
      groupKey,
      tabEditingKey,
      groupEditingKey,
      preparingInlineEdit ? 'prep' : '',
    ].join('#');
  }

  function getOrCreatePaneEntry(screenId: string): PaneCacheEntry {
    const cached = paneCache.get(screenId);
    if (cached) return cached;
    const pane = document.createElement('section');
    pane.className = 'screen-pane';
    pane.dataset.screenId = screenId;

    const tabsStrip = document.createElement('div');
    tabsStrip.className = 'screen-pane-tabs';
    pane.appendChild(tabsStrip);

    const terminalHost = document.createElement('div');
    terminalHost.className = 'screen-pane-terminal';
    pane.appendChild(terminalHost);

    const activatePaneTerminal = () => {
      setActiveScreen(screenId);
      const current = getState().screens.find(item => item.id === screenId);
      const nextActiveTab = terminalHost.dataset.tabId || current?.activeTabId || current?.tabs[0]?.id;
      if (nextActiveTab) {
        setActiveTab(nextActiveTab);
      }
    };

    terminalHost.addEventListener('pointerdown', () => {
      activatePaneTerminal();
    }, true);

    pane.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (target.closest('.screen-pane-tabs')) return;
      activatePaneTerminal();
    });

    const entry: PaneCacheEntry = {
      pane,
      tabsStrip,
      terminalHost,
      screenId,
      tabsRenderKey: '',
    };
    paneCache.set(screenId, entry);
    return entry;
  }

  function renderTabsStrip(
    screen: ReturnType<typeof getScreens>[number],
    tabsStrip: HTMLElement,
  ): void {
    tabsStrip.innerHTML = '';
    if (screen.tabs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'screen-pane-empty';
      empty.textContent = 'No tabs in this screen';
      tabsStrip.appendChild(empty);
    } else {
      const appendTab = (tabId: string) => {
        const tab = screen.tabs.find(item => item.id === tabId);
        if (!tab) return;
        const tabEl = document.createElement('div');
        const effectiveState = getTabEffectiveState(tab);
        tabEl.setAttribute('role', 'button');
        tabEl.tabIndex = 0;
        tabEl.className = `screen-pane-tab${screen.activeTabId === tab.id ? ' active' : ''}${effectiveState === 'waiting' ? ' waiting' : ''}`;
        tabEl.dataset.tabId = tab.id;
        const isEditing = editingTabId === tab.id;
        tabEl.innerHTML = isEditing ? `
          <span class="screen-pane-tab-dot" style="background:${tab.configColor}"></span>
          <input class="screen-pane-tab-input" type="text" value="${escapeHtmlAttr(tab.customName || tab.configName)}" />
          <span class="screen-pane-tab-close" aria-label="Close">×</span>
        ` : `
          <span class="screen-pane-tab-dot" style="background:${tab.configColor}"></span>
          <span class="screen-pane-tab-name">${escapeHtml(tab.customName || tab.configName)}</span>
          ${effectiveState === 'waiting' ? '<span class="screen-pane-tab-badge">W</span>' : ''}
          <span class="screen-pane-tab-close" aria-label="Close">×</span>
        `;

        tabEl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const target = ev.target as HTMLElement;
          if (target.closest('.screen-pane-tab-close')) {
            callbacks.onTabClose(tab.id);
            return;
          }
          setActiveScreen(screen.id);
          setActiveTab(tab.id);
        });
        tabEl.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setActiveScreen(screen.id);
          setActiveTab(tab.id);
          showTabContextMenu(tab.id, screen.id, ev.clientX, ev.clientY);
        });
        tabEl.addEventListener('dblclick', (ev) => {
          const target = ev.target as HTMLElement;
          if (target.closest('.screen-pane-tab-close')) return;
          ev.preventDefault();
          ev.stopPropagation();
          editingTabId = tab.id;
          pendingFocusTabId = tab.id;
          refreshInlineEditingGuard();
          render();
        });
        tabEl.addEventListener('keydown', (ev) => {
          if (editingTabId === tab.id) return;
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          setActiveScreen(screen.id);
          setActiveTab(tab.id);
        });
        tabsStrip.appendChild(tabEl);

        if (isEditing) {
          const input = tabEl.querySelector('.screen-pane-tab-input') as HTMLInputElement | null;
          if (input) {
            const imeGuard = createRenameImeGuardState();
            const commit = () => {
              const next = input.value.trim();
              if (!next || next === tab.configName) {
                renameTab(tab.id, undefined);
              } else {
                renameTab(tab.id, next);
              }
              editingTabId = null;
              refreshInlineEditingGuard();
              render();
            };
            const cancel = () => {
              editingTabId = null;
              refreshInlineEditingGuard();
              render();
            };
            input.addEventListener('compositionstart', () => {
              onRenameCompositionStart(imeGuard);
            });
            input.addEventListener('compositionend', () => {
              onRenameCompositionEnd(imeGuard);
            });
            input.addEventListener('keydown', (ev) => {
              const intent = getRenameKeyIntent({
                key: ev.key,
                isComposing: ev.isComposing,
                keyCode: (ev as KeyboardEvent).keyCode,
              }, imeGuard);
              if (intent === 'commit') {
                ev.preventDefault();
                commit();
              } else if (intent === 'cancel') {
                ev.preventDefault();
                cancel();
              }
            });
            input.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
            });
            input.addEventListener('click', (ev) => {
              ev.stopPropagation();
            });
            input.addEventListener('blur', () => {
              cancel();
            });
            if (pendingFocusTabId === tab.id) {
              input.focus();
              input.select();
              requestAnimationFrame(() => {
                if (document.activeElement === input) {
                  pendingFocusTabId = null;
                  return;
                }
                input.focus();
                input.select();
                pendingFocusTabId = null;
              });
            }
          }
        }
      };

      const grouped = new Set<string>();
      for (const group of screen.groups) {
        const waitingCount = group.tabIds.reduce((acc, tabId) => {
          const tab = screen.tabs.find(item => item.id === tabId);
          if (!tab) return acc;
          return getTabEffectiveState(tab) === 'waiting' ? acc + 1 : acc;
        }, 0);
        const groupHeader = document.createElement('div');
        groupHeader.className = 'screen-pane-group';
        const isEditingGroup = editingGroupId === group.id;
        const editingValue = isEditingGroup ? (editingGroupDraft ?? group.name) : group.name;
        groupHeader.innerHTML = isEditingGroup ? `
          <span class="screen-pane-group-toggle" style="color:${group.color}">${group.collapsed ? '▸' : '▾'}</span>
          <input class="screen-pane-group-input" type="text" value="${escapeHtmlAttr(editingValue)}" />
          <span class="screen-pane-group-count">${group.tabIds.length}</span>
        ` : `
          <span class="screen-pane-group-toggle" style="color:${group.color}">${group.collapsed ? '▸' : '▾'}</span>
          <span class="screen-pane-group-name">${escapeHtml(group.name)}</span>
          <span class="screen-pane-group-count">${group.tabIds.length}</span>
          ${waitingCount > 0 ? `<span class="screen-pane-group-waiting">W${waitingCount}</span>` : ''}
        `;
        groupHeader.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if ((ev.target as HTMLElement).closest('.screen-pane-group-input')) return;
          setActiveScreen(screen.id);
          toggleGroupCollapse(group.id);
          callbacks.onLayoutChanged();
        });
        groupHeader.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          showGroupContextMenu(group.id, screen.id, ev.clientX, ev.clientY);
        });
        tabsStrip.appendChild(groupHeader);
        if (isEditingGroup) {
          const input = groupHeader.querySelector('.screen-pane-group-input') as HTMLInputElement | null;
          if (input) {
            const imeGuard = createRenameImeGuardState();
            const commit = () => {
              const next = input.value.trim();
              const committed = renameGroupInlineAction(screen.id, group.id, next, callbacks.onLayoutChanged);
              if (!committed) {
                return false;
              }
              editingGroupId = null;
              editingGroupDraft = null;
              pendingFocusGroupId = null;
              if (pendingNewGroupId === group.id) {
                pendingNewGroupId = null;
              }
              refreshInlineEditingGuard();
              render();
              return true;
            };
            const cancel = () => {
              if (pendingNewGroupId === group.id) {
                setActiveScreen(screen.id);
                deleteGroup(group.id);
                callbacks.onLayoutChanged();
                pendingNewGroupId = null;
              }
              editingGroupId = null;
              editingGroupDraft = null;
              pendingFocusGroupId = null;
              refreshInlineEditingGuard();
              render();
            };
            input.addEventListener('input', () => {
              editingGroupDraft = input.value;
            });
            input.addEventListener('compositionstart', () => {
              onRenameCompositionStart(imeGuard);
            });
            input.addEventListener('compositionend', () => {
              onRenameCompositionEnd(imeGuard);
            });
            input.addEventListener('keydown', (ev) => {
              const intent = getRenameKeyIntent({
                key: ev.key,
                isComposing: ev.isComposing,
                keyCode: (ev as KeyboardEvent).keyCode,
              }, imeGuard);
              if (intent === 'commit') {
                ev.preventDefault();
                ev.stopPropagation();
                void commit();
              } else if (intent === 'cancel') {
                ev.preventDefault();
                ev.stopPropagation();
                cancel();
              }
            });
            input.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
            });
            input.addEventListener('click', (ev) => {
              ev.stopPropagation();
            });
            input.addEventListener('blur', () => {
              if (pendingNewGroupId === group.id) {
                requestAnimationFrame(() => {
                  input.focus();
                  input.select();
                });
                return;
              }
              cancel();
            });
            if (pendingFocusGroupId === group.id) {
              input.focus();
              input.select();
              requestAnimationFrame(() => {
                if (document.activeElement === input) {
                  pendingFocusGroupId = null;
                  return;
                }
                input.focus();
                input.select();
                pendingFocusGroupId = null;
              });
            }
          }
        }
        for (const tid of group.tabIds) grouped.add(tid);
        if (!group.collapsed) {
          for (const tid of group.tabIds) appendTab(tid);
        }
      }
      for (const tab of screen.tabs) {
        if (!grouped.has(tab.id)) appendTab(tab.id);
      }
    }
    const actions = document.createElement('div');
    actions.className = 'screen-pane-actions';
    const screenIdLabel = document.createElement('span');
    screenIdLabel.className = 'screen-pane-screen-id';
    screenIdLabel.textContent = screen.id;
    actions.appendChild(screenIdLabel);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'screen-pane-remove';
    removeBtn.title = `Close screen (${screen.id})`;
    removeBtn.setAttribute('aria-label', `Close screen ${screen.id}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      callbacks.onRemoveScreen(screen.id);
    });
    actions.appendChild(removeBtn);
    tabsStrip.appendChild(actions);
  }

  function render(force = true): void {
    const state = getState();
    const layoutRenderKey = buildLayoutRenderKey(state);
    if (!force && inlineEditingGuard && layoutRenderKey === lastLayoutRenderKey) return;
    if (editingGroupId) {
      const liveInput = root.querySelector('.screen-pane-group-input') as HTMLInputElement | null;
      if (liveInput) {
        editingGroupDraft = liveInput.value;
      }
    }
    lastLayoutRenderKey = layoutRenderKey;
    const screens = getScreens();
    const populatedScreens = screens.filter(screen => screen.tabs.length > 0);
    const visibleScreens = populatedScreens.length > 0
      ? populatedScreens
      : screens.slice(0, 1);

    const paneCount = Math.min(Math.max(visibleScreens.length, 1), 4);
    root.className = `screen-workspace panes-${paneCount}`;

    const visibleScreenIds = visibleScreens.map(screen => screen.id);
    const structureNeedsSync = root.children.length !== visibleScreenIds.length
      || visibleScreenIds.some((id, index) => {
        const child = root.children[index] as HTMLElement | undefined;
        return !child || child.dataset.screenId !== id;
      });
    if (structureNeedsSync) {
      root.innerHTML = '';
      for (const screen of visibleScreens) {
        const entry = getOrCreatePaneEntry(screen.id);
        root.appendChild(entry.pane);
      }
      for (const [screenId] of paneCache.entries()) {
        if (!visibleScreenIds.includes(screenId)) {
          paneCache.delete(screenId);
        }
      }
    }

    for (const screen of visibleScreens) {
      const entry = getOrCreatePaneEntry(screen.id);
      entry.pane.className = `screen-pane${state.activeScreenId === screen.id ? ' active' : ''}`;
      const activeTab = screen.tabs.find(tab => tab.id === screen.activeTabId) || screen.tabs[0] || null;
      if (activeTab) {
        entry.terminalHost.dataset.tabId = activeTab.id;
      } else {
        delete entry.terminalHost.dataset.tabId;
      }

      const tabsRenderKey = buildTabsRenderKey(screen, state);
      if (force || structureNeedsSync || entry.tabsRenderKey !== tabsRenderKey) {
        renderTabsStrip(screen, entry.tabsStrip);
        entry.tabsRenderKey = tabsRenderKey;
      }
    }
  }
  const closeIfOutsideMenu = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.screen-tab-context-menu')) return;
    closeContextMenus();
  };
  document.addEventListener('pointerdown', closeIfOutsideMenu, true);
  document.addEventListener('contextmenu', closeIfOutsideMenu, true);
  window.addEventListener('blur', closeContextMenus);

  subscribe(() => render(false));
  refreshInlineEditingGuard();
  render();

  return root;
}

export function getVisibleTabIdsForScreens(): Set<string> {
  const visible = new Set<string>();
  for (const screen of getScreens()) {
    const activeTabId = screen.activeTabId || screen.tabs[0]?.id;
    if (activeTabId) {
      visible.add(activeTabId);
    }
  }
  return visible;
}

export function getActiveTabIdForScreen(screenId: string): string | null {
  const screen = getScreens().find(item => item.id === screenId);
  if (!screen) return null;
  return screen.activeTabId || screen.tabs[0]?.id || null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;');
}

function buildLayoutRenderKey(state: ReturnType<typeof getState>): string {
  return [
    state.activeScreenId || '',
    ...state.screens.map(screen => [
      screen.id,
      screen.activeTabId || '',
      screen.tabs.map(tab => tab.id).join(','),
      screen.groups.map(group => `${group.id}:${group.collapsed ? '1' : '0'}:${group.tabIds.join(',')}`).join('|'),
    ].join('#')),
  ].join('||');
}

export function hasScreenWorkspaceDomDrift(
  domScreenIds: string[],
  visibleScreenIds: string[],
  cacheScreenIds: string[],
): boolean {
  const domUniqueCount = new Set(domScreenIds).size;
  const cacheConsistent = cacheScreenIds.length === visibleScreenIds.length
    && visibleScreenIds.every(id => cacheScreenIds.includes(id));
  return domScreenIds.length !== visibleScreenIds.length
    || domUniqueCount !== domScreenIds.length
    || domScreenIds.some((id, index) => id !== visibleScreenIds[index])
    || !cacheConsistent;
}


function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}
