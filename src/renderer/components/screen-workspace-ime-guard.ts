export interface RenameImeGuardState {
  isComposing: boolean;
  imeEnterLockUntil: number;
}

export type RenameKeyIntent = 'commit' | 'cancel' | null;

export type RenameKeyEventLike = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
};

export function createRenameImeGuardState(): RenameImeGuardState {
  return {
    isComposing: false,
    imeEnterLockUntil: 0,
  };
}

export function onRenameCompositionStart(state: RenameImeGuardState): void {
  state.isComposing = true;
}

export function onRenameCompositionEnd(
  state: RenameImeGuardState,
  now = Date.now(),
): void {
  state.isComposing = false;
  state.imeEnterLockUntil = now + 120;
}

export function getRenameKeyIntent(
  event: RenameKeyEventLike,
  state: RenameImeGuardState,
  now = Date.now(),
): RenameKeyIntent {
  if (event.key === 'Enter') {
    if (
      state.isComposing
      || Boolean(event.isComposing)
      || event.keyCode === 229
      || now < state.imeEnterLockUntil
    ) {
      return null;
    }
    return 'commit';
  }
  if (event.key === 'Escape') {
    if (state.isComposing || Boolean(event.isComposing)) return null;
    return 'cancel';
  }
  return null;
}
