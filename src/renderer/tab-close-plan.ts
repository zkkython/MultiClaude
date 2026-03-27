export function getCloseOtherTabIds(tabIds: string[], currentTabId: string): string[] {
  return tabIds.filter((tabId) => tabId !== currentTabId);
}

export function getCloseAllTabIds(tabIds: string[]): string[] {
  return [...tabIds];
}
