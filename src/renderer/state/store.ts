import type { ModelConfig, TerminalTab } from '../../shared/types.js';

type Listener = () => void;

export interface AppState {
  configs: ModelConfig[];
  selectedConfigId: string | null;
  tabs: TerminalTab[];
  activeTabId: string | null;
  sidebarVisible: boolean;
  sidebarWidth: number;
  searchQuery: string;
  fontSize: number;
}

const initialState: AppState = {
  configs: [],
  selectedConfigId: null,
  tabs: [],
  activeTabId: null,
  sidebarVisible: true,
  sidebarWidth: 260,
  searchQuery: '',
  fontSize: 14,
};

let state: AppState = { ...initialState };
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  notify();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

// Helper actions
export function addTab(tab: TerminalTab): void {
  setState({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id,
  });
}

export function removeTab(tabId: string): void {
  const tabs = state.tabs.filter(t => t.id !== tabId);
  let activeTabId = state.activeTabId;
  if (activeTabId === tabId) {
    // Switch to previous or next tab
    const oldIndex = state.tabs.findIndex(t => t.id === tabId);
    if (tabs.length > 0) {
      activeTabId = tabs[Math.min(oldIndex, tabs.length - 1)].id;
    } else {
      activeTabId = null;
    }
  }
  setState({ tabs, activeTabId });
}

export function updateTabStatus(tabId: string, status: TerminalTab['status']): void {
  setState({
    tabs: state.tabs.map(t => t.id === tabId ? { ...t, status } : t),
  });
}

export function setActiveTab(tabId: string): void {
  setState({ activeTabId: tabId });
}

export function nextTab(): void {
  if (state.tabs.length <= 1) return;
  const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
  const nextIndex = (currentIndex + 1) % state.tabs.length;
  setState({ activeTabId: state.tabs[nextIndex].id });
}

export function prevTab(): void {
  if (state.tabs.length <= 1) return;
  const currentIndex = state.tabs.findIndex(t => t.id === state.activeTabId);
  const prevIndex = (currentIndex - 1 + state.tabs.length) % state.tabs.length;
  setState({ activeTabId: state.tabs[prevIndex].id });
}

export function goToTab(index: number): void {
  if (index >= 0 && index < state.tabs.length) {
    setState({ activeTabId: state.tabs[index].id });
  }
}
