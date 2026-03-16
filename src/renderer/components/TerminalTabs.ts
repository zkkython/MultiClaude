import {
  getState, setActiveTab, removeTab, renameTab, subscribe,
  createGroup, deleteGroup, renameGroup, toggleGroupCollapse,
  moveTabToGroup, removeTabFromGroup, getGroupForTab, moveTabRelative, getTabEffectiveState,
} from '../state/store.js';
import type { TerminalTab, TabGroup } from '../../shared/types.js';

let detachGlobalListeners: (() => void) | null = null;

export function createTerminalTabs(
  onTabSelect: (tabId: string) => void,
  onTabClose: (tabId: string) => void,
  onCloseGroupTabs: (groupId: string) => void,
  onGroupsChanged: () => void,
): HTMLElement {
  const tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';

  // Separate drag zone for the titlebar area only.
  // Must NOT be an ancestor of the scroll container, otherwise
  // -webkit-app-region: drag swallows wheel events in the entire subtree.
  const dragZone = document.createElement('div');
  dragZone.className = 'tab-bar-drag';
  tabBar.appendChild(dragZone);

  // Inner scrollable container for tabs
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'tab-bar-scroll';
  tabBar.appendChild(scrollContainer);

  // Drag-to-scroll: click and drag horizontally to scroll the tab bar.
  // macOS intercepts trackpad horizontal swipe at the OS level so we can't
  // use wheel events. Instead, mousedown+mousemove drives scrollLeft.
  // A small movement threshold distinguishes "click to select" from "drag to scroll".
  let dragScrolling = false;
  let wasDragged = false;
  let dragStartX = 0;
  let dragScrollLeft = 0;
  let draggedTabId: string | null = null;

  if (detachGlobalListeners) {
    detachGlobalListeners();
    detachGlobalListeners = null;
  }

  scrollContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.tab') || target.closest('.tab-group-header')) return;
    dragScrolling = true;
    wasDragged = false;
    dragStartX = e.pageX;
    dragScrollLeft = scrollContainer.scrollLeft;
  });

  const onDocumentMouseMove = (e: MouseEvent) => {
    if (!dragScrolling) return;
    const dx = e.pageX - dragStartX;
    if (Math.abs(dx) > 3) {
      wasDragged = true;
      scrollContainer.style.cursor = 'grabbing';
      e.preventDefault();
    }
    scrollContainer.scrollLeft = dragScrollLeft - dx;
  };

  const onDocumentMouseUp = () => {
    if (dragScrolling) {
      dragScrolling = false;
      scrollContainer.style.cursor = '';
    }
  };

  // If user dragged, suppress the click so it doesn't select a tab
  scrollContainer.addEventListener('click', (e) => {
    if (wasDragged) {
      e.stopPropagation();
      e.preventDefault();
      wasDragged = false;
    }
  }, { capture: true });

  scrollContainer.addEventListener('dragover', (e) => {
    if (!draggedTabId) return;
    if ((e.target as HTMLElement).closest('.tab')) return;
    e.preventDefault();
  });

  scrollContainer.addEventListener('drop', (e) => {
    if (!draggedTabId) return;
    if ((e.target as HTMLElement).closest('.tab')) return;
    e.preventDefault();
    const tabEls = scrollContainer.querySelectorAll('.tab');
    const lastTabEl = tabEls.length > 0 ? tabEls[tabEls.length - 1] as HTMLElement : null;
    const lastTabId = lastTabEl?.dataset.tabId;
    if (lastTabId && lastTabId !== draggedTabId) {
      moveTabRelative(draggedTabId, lastTabId, true);
    }
  });

  let editingTabId: string | null = null;
  let editingGroupId: string | null = null;
  let lastNameClickTime = 0;
  let lastNameClickTabId: string | null = null;
  let lastGroupNameClickTime = 0;
  let lastGroupNameClickId: string | null = null;

  // Close any open context menu
  function closeContextMenu() {
    document.querySelectorAll('.tab-context-menu').forEach(el => el.remove());
  }

  const onDocumentClick = () => closeContextMenu();
  const onDocumentContextMenu = () => closeContextMenu();
  document.addEventListener('mousemove', onDocumentMouseMove);
  document.addEventListener('mouseup', onDocumentMouseUp);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('contextmenu', onDocumentContextMenu);
  detachGlobalListeners = () => {
    document.removeEventListener('mousemove', onDocumentMouseMove);
    document.removeEventListener('mouseup', onDocumentMouseUp);
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('contextmenu', onDocumentContextMenu);
  };

  // Double-click detection on tab names
  scrollContainer.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;

    // Tab name double-click for rename
    if (target.classList.contains('tab-name')) {
      const tabEl = target.closest('.tab') as HTMLElement;
      if (!tabEl) return;
      const tabId = tabEl.dataset.tabId!;

      const now = Date.now();
      if (lastNameClickTabId === tabId && now - lastNameClickTime < 400) {
        e.preventDefault();
        startEditingTab(tabId, tabEl);
        lastNameClickTabId = null;
        lastNameClickTime = 0;
        return;
      }
      lastNameClickTabId = tabId;
      lastNameClickTime = now;
    }

    // Group name double-click for rename
    if (target.classList.contains('tab-group-name')) {
      const headerEl = target.closest('.tab-group-header') as HTMLElement;
      if (!headerEl) return;
      const groupId = headerEl.dataset.groupId!;

      const now = Date.now();
      if (lastGroupNameClickId === groupId && now - lastGroupNameClickTime < 400) {
        e.preventDefault();
        startEditingGroup(groupId, headerEl);
        lastGroupNameClickId = null;
        lastGroupNameClickTime = 0;
        return;
      }
      lastGroupNameClickId = groupId;
      lastGroupNameClickTime = now;
    }
  });

  function render() {
    const state = getState();
    const { tabs, activeTabId, groups } = state;

    if (tabs.length === 0) {
      scrollContainer.innerHTML = '';
      editingTabId = null;
      editingGroupId = null;
      return;
    }

    // Save editing state before innerHTML destroys it
    const wasEditingTabId = editingTabId;
    let savedTabValue = '';
    const wasEditingGroupId = editingGroupId;
    let savedGroupValue = '';

    if (wasEditingTabId) {
      const input = scrollContainer.querySelector('.tab-name-input') as HTMLInputElement | null;
      if (input) savedTabValue = input.value;
      editingTabId = null;
    }
    if (wasEditingGroupId) {
      const input = scrollContainer.querySelector('.tab-group-name-input') as HTMLInputElement | null;
      if (input) savedGroupValue = input.value;
      editingGroupId = null;
    }

    // Build HTML: groups first, then ungrouped tabs
    const grouped = new Set<string>();
    for (const group of groups) {
      for (const tid of group.tabIds) grouped.add(tid);
    }

    let html = '';
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      const waitingCount = group.tabIds.reduce((acc, tid) => {
        const tab = tabs.find(t => t.id === tid);
        if (!tab) return acc;
        return getTabEffectiveState(tab) === 'waiting' ? acc + 1 : acc;
      }, 0);
      // Group separator before every group except the first
      if (gi > 0 || false) {
        html += '<div class="tab-group-separator"></div>';
      }
      html += renderGroupHeader(group, waitingCount);
      if (!group.collapsed) {
        for (const tid of group.tabIds) {
          const tab = tabs.find(t => t.id === tid);
          if (tab) html += renderTab(tab, tab.id === activeTabId);
        }
      }
      // Separator after group
      html += '<div class="tab-group-separator"></div>';
    }
    // Ungrouped tabs
    for (const tab of tabs) {
      if (!grouped.has(tab.id)) {
        html += renderTab(tab, tab.id === activeTabId);
      }
    }

    scrollContainer.innerHTML = html;

    // Bind tab events
    scrollContainer.querySelectorAll('.tab').forEach(tabEl => {
      const tabId = (tabEl as HTMLElement).dataset.tabId!;
      tabEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('tab-close')) return;
        if ((e.target as HTMLElement).classList.contains('tab-name-input')) return;
        if (draggedTabId) return;
        onTabSelect(tabId);
      });
      tabEl.querySelector('.tab-close')?.addEventListener('click', (e) => {
        e.stopPropagation();
        onTabClose(tabId);
      });
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showTabContextMenu(tabId, e as MouseEvent);
      });
      tabEl.addEventListener('dragstart', (e) => {
        const evt = e as DragEvent;
        draggedTabId = tabId;
        (tabEl as HTMLElement).classList.add('dragging');
        if (evt.dataTransfer) {
          evt.dataTransfer.effectAllowed = 'move';
          evt.dataTransfer.setData('text/plain', tabId);
        }
      });
      tabEl.addEventListener('dragover', (e) => {
        if (!draggedTabId || draggedTabId === tabId) return;
        e.preventDefault();
        const rect = (tabEl as HTMLElement).getBoundingClientRect();
        const mouseX = (e as DragEvent).clientX;
        const placeAfter = mouseX > rect.left + rect.width / 2;
        (tabEl as HTMLElement).classList.toggle('drop-before', !placeAfter);
        (tabEl as HTMLElement).classList.toggle('drop-after', placeAfter);
      });
      tabEl.addEventListener('dragleave', () => {
        (tabEl as HTMLElement).classList.remove('drop-before', 'drop-after');
      });
      tabEl.addEventListener('drop', (e) => {
        if (!draggedTabId || draggedTabId === tabId) return;
        e.preventDefault();
        const rect = (tabEl as HTMLElement).getBoundingClientRect();
        const mouseX = (e as DragEvent).clientX;
        const placeAfter = mouseX > rect.left + rect.width / 2;
        moveTabRelative(draggedTabId, tabId, placeAfter);
      });
      tabEl.addEventListener('dragend', () => {
        draggedTabId = null;
        scrollContainer.querySelectorAll('.tab').forEach(el => {
          (el as HTMLElement).classList.remove('dragging', 'drop-before', 'drop-after');
        });
      });
    });

    // Bind group header events
    scrollContainer.querySelectorAll('.tab-group-header').forEach(headerEl => {
      const groupId = (headerEl as HTMLElement).dataset.groupId!;
      // Click toggle area to collapse/expand
      headerEl.querySelector('.tab-group-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleGroupCollapse(groupId);
        onGroupsChanged();
      });
      headerEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGroupContextMenu(groupId, e as MouseEvent);
      });
    });

    // Restore tab editing
    if (wasEditingTabId && tabs.find(t => t.id === wasEditingTabId)) {
      const tabEl = scrollContainer.querySelector(`.tab[data-tab-id="${wasEditingTabId}"]`) as HTMLElement | null;
      if (tabEl) setupTabInput(wasEditingTabId, tabEl, savedTabValue);
    }
    // Restore group editing
    if (wasEditingGroupId && groups.find(g => g.id === wasEditingGroupId)) {
      const headerEl = scrollContainer.querySelector(`.tab-group-header[data-group-id="${wasEditingGroupId}"]`) as HTMLElement | null;
      if (headerEl) setupGroupInput(wasEditingGroupId, headerEl, savedGroupValue);
    }
  }

  // ---- Tab inline editing ----

  function startEditingTab(tabId: string, tabEl: HTMLElement) {
    const tab = getState().tabs.find(t => t.id === tabId);
    if (!tab) return;
    setupTabInput(tabId, tabEl, tab.customName || tab.configName);
  }

  function setupTabInput(tabId: string, tabEl: HTMLElement, value: string) {
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
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => {
      if (editingTabId === tabId) commit();
    });
  }

  // ---- Group inline editing ----

  function startEditingGroup(groupId: string, headerEl: HTMLElement) {
    const group = getState().groups.find(g => g.id === groupId);
    if (!group) return;
    setupGroupInput(groupId, headerEl, group.name);
  }

  function setupGroupInput(groupId: string, headerEl: HTMLElement, value: string) {
    const nameEl = headerEl.querySelector('.tab-group-name') as HTMLElement | null;
    if (!nameEl) return;

    editingGroupId = groupId;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-group-name-input';
    input.value = value;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      editingGroupId = null;
      const newName = input.value.trim();
      if (newName !== '') {
        renameGroup(groupId, newName);
        onGroupsChanged();
      } else {
        render();
      }
    }
    function cancel() {
      if (committed) return;
      committed = true;
      editingGroupId = null;
      render();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => {
      if (editingGroupId === groupId) commit();
    });
  }

  // ---- Context Menus ----

  function showTabContextMenu(tabId: string, e: MouseEvent) {
    closeContextMenu();
    const state = getState();
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const currentGroup = getGroupForTab(tabId);

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // "Move to Group" with submenu
    const moveItem = document.createElement('div');
    moveItem.className = 'tab-context-menu-item has-submenu';
    moveItem.textContent = 'Move to Group';
    const arrow = document.createElement('span');
    arrow.className = 'tab-context-menu-arrow';
    arrow.textContent = '\u25B8';
    moveItem.appendChild(arrow);

    const submenu = document.createElement('div');
    submenu.className = 'tab-context-submenu';

    // List existing groups
    for (const group of state.groups) {
      if (currentGroup && currentGroup.id === group.id) continue;
      const groupItem = document.createElement('div');
      groupItem.className = 'tab-context-menu-item';
      const dot = document.createElement('span');
      dot.className = 'tab-context-menu-color';
      dot.style.background = group.color;
      groupItem.appendChild(dot);
      groupItem.appendChild(document.createTextNode(group.name));
      groupItem.addEventListener('click', (ev) => {
        ev.stopPropagation();
        moveTabToGroup(tabId, group.id);
        onGroupsChanged();
        closeContextMenu();
      });
      submenu.appendChild(groupItem);
    }

    // Separator if there are existing groups
    if (state.groups.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'tab-context-menu-separator';
      submenu.appendChild(sep);
    }

    // "+ New Group..."
    const newGroupItem = document.createElement('div');
    newGroupItem.className = 'tab-context-menu-item';
    newGroupItem.textContent = '+ New Group...';
    newGroupItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const groupId = createGroup(tab.configName, tab.configColor, [tabId], [tab.configId]);
      onGroupsChanged();
      closeContextMenu();
      // Start editing group name
      requestAnimationFrame(() => {
        const headerEl = scrollContainer.querySelector(`.tab-group-header[data-group-id="${groupId}"]`) as HTMLElement | null;
        if (headerEl) startEditingGroup(groupId, headerEl);
      });
    });
    submenu.appendChild(newGroupItem);

    // "Remove from Group" if in a group
    if (currentGroup) {
      const sep = document.createElement('div');
      sep.className = 'tab-context-menu-separator';
      submenu.appendChild(sep);
      const removeItem = document.createElement('div');
      removeItem.className = 'tab-context-menu-item';
      removeItem.textContent = 'Remove from Group';
      removeItem.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeTabFromGroup(tabId);
        onGroupsChanged();
        closeContextMenu();
      });
      submenu.appendChild(removeItem);
    }

    moveItem.appendChild(submenu);
    menu.appendChild(moveItem);

    // "New Group from Tab"
    const newFromTab = document.createElement('div');
    newFromTab.className = 'tab-context-menu-item';
    newFromTab.textContent = 'New Group from Tab';
    newFromTab.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const groupId = createGroup(tab.configName, tab.configColor, [tabId], [tab.configId]);
      onGroupsChanged();
      closeContextMenu();
      requestAnimationFrame(() => {
        const headerEl = scrollContainer.querySelector(`.tab-group-header[data-group-id="${groupId}"]`) as HTMLElement | null;
        if (headerEl) startEditingGroup(groupId, headerEl);
      });
    });
    menu.appendChild(newFromTab);

    document.body.appendChild(menu);

    // Adjust position if overflows
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

  function showGroupContextMenu(groupId: string, e: MouseEvent) {
    closeContextMenu();
    const group = getState().groups.find(g => g.id === groupId);
    if (!group) return;

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // Rename Group
    const renameItem = document.createElement('div');
    renameItem.className = 'tab-context-menu-item';
    renameItem.textContent = 'Rename Group';
    renameItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeContextMenu();
      requestAnimationFrame(() => {
        const headerEl = scrollContainer.querySelector(`.tab-group-header[data-group-id="${groupId}"]`) as HTMLElement | null;
        if (headerEl) startEditingGroup(groupId, headerEl);
      });
    });
    menu.appendChild(renameItem);

    // Close All Tabs
    const closeAllItem = document.createElement('div');
    closeAllItem.className = 'tab-context-menu-item';
    closeAllItem.textContent = 'Close All Tabs';
    closeAllItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeContextMenu();
      onCloseGroupTabs(groupId);
    });
    menu.appendChild(closeAllItem);

    // Delete Group
    const deleteItem = document.createElement('div');
    deleteItem.className = 'tab-context-menu-item tab-context-menu-item-danger';
    deleteItem.textContent = 'Delete Group';
    deleteItem.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeContextMenu();
      deleteGroup(groupId);
      onGroupsChanged();
    });
    menu.appendChild(deleteItem);

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

  subscribe(render);
  render();
  return tabBar;
}

function renderGroupHeader(group: TabGroup, waitingCount: number): string {
  const toggle = group.collapsed ? '\u25B8' : '\u25BE';
  const waitingBadge = waitingCount > 0 ? `<span class="tab-group-waiting">W${waitingCount}</span>` : '';
  return `
    <div class="tab-group-header ${waitingCount > 0 ? 'tab-group-header-waiting' : ''}" data-group-id="${group.id}" style="--group-color: ${group.color}">
      <span class="tab-group-toggle">${toggle}</span>
      <span class="tab-group-name">${escapeHtml(group.name)}</span>
      <span class="tab-group-count">(${group.tabIds.length})</span>
      ${waitingBadge}
    </div>
  `;
}

function renderTab(tab: TerminalTab, isActive: boolean): string {
  const effectiveState = getTabEffectiveState(tab);
  const statusClass = effectiveState === 'exited' ? 'tab-exited' : '';
  const waitingClass = effectiveState === 'waiting' ? 'tab-waiting' : '';
  const displayName = tab.customName || tab.configName;
  const waitingBadge = effectiveState === 'waiting' ? '<span class="tab-waiting-badge">● waiting</span>' : '';
  const exitedBadge = tab.status === 'exited' ? '<span class="tab-status-badge">exited</span>' : '';
  return `
    <div class="tab ${isActive ? 'active' : ''} ${statusClass} ${waitingClass}" data-tab-id="${tab.id}" data-runtime-state="${effectiveState}" draggable="true">
      <span class="tab-color" style="background: ${tab.configColor}"></span>
      <span class="tab-name">${escapeHtml(displayName)}</span>
      ${waitingBadge}
      ${exitedBadge}
      <button class="tab-close" title="Close">\u2715</button>
    </div>
  `;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
