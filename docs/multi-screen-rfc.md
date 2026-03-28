# RFC: Multi-Screen Workspace Model and Interaction Semantics

Status: Draft  
Author: @zkkython (proposed by assistant)  
Last Updated: 2026-03-28

## 1. Context

Multi-screen support has evolved quickly and recently exposed multiple UX/consistency issues:
- Duplicate/unstable screen targets in context menu.
- Full workspace re-render causing cross-screen visual churn.
- Ambiguous “remove screen” semantics (close view vs delete persisted data).
- Group metadata unexpectedly disappearing after screen/session actions.
- Inconsistent submenu structure between `Move To Screen` and `Move To Group`.

This RFC defines the **current implementation baseline** and expected behavior so future changes can be verified against explicit rules.

## 2. Goals

- Make screen lifecycle predictable and data-safe by default.
- Keep screen identity stable (`screen-a`…`screen-d`) and avoid duplicate ids.
- Reduce unnecessary UI refresh scope (screen-level local refresh).
- Preserve group metadata across session-level screen close.
- Ensure tab movement never auto-groups tabs; grouping remains explicit user action.
- Standardize tab context submenu patterns.

## 3. Non-Goals

- No change to max screen count (still 4).
- No cross-window/multi-process collaboration model.
- No redesign of terminal runtime or PTY ownership.

## 4. Data Model Rules

### 4.1 Screen identity

- Screen ids are canonical slots: `screen-a`, `screen-b`, `screen-c`, `screen-d`.
- New screen creation uses the **first available slot** (not array length).
- State normalization deduplicates screens by id.

### 4.2 Group persistence

- Groups are screen-local metadata with:
  - `id`, `name`, `color`, `associatedConfigIds`, `tabIds`.
- Group metadata can exist with empty `tabIds`.
- Removing a tab from a screen during **cross-screen move** must not delete group metadata if `associatedConfigIds` exists.

### 4.3 Tab movement and grouping

- Moving a tab between screens must only move tab ownership.
- Moving a tab must **not** auto-insert tab into any target group.
- Group membership changes only by explicit user action (`Move To Group`, `New Group`, etc.).

## 5. Rendering Model

### 5.1 Screen workspace rendering

- Pane structure is cached and reused per `screenId`.
- Layout structure updates only when visible screen list/order changes.
- Tabs strip updates per-screen using screen-level render key.
- Terminal host nodes are reused; only active `data-tab-id` changes.

### 5.2 Editing safety

- Existing inline-edit and IME guard behavior is preserved.
- Inline edit state prevents disruptive redraw while composition/editing is active.

## 6. Context Menu Semantics

### 6.1 Move To Screen

- `Move To Screen` submenu includes:
  - existing target screens,
  - separator,
  - `+ New Screen...` (disabled at max screens).
- Top-level `Move To New Screen` item is removed.

### 6.2 Move To Group

- Keeps existing structure and explicit group operations.

## 7. Close Screen Semantics

`x` action now triggers a dialog with two explicit options:

1. **Close (Session Only)**
- Close all tabs in the screen.
- Keep screen entity and group metadata (with empty `tabIds`).
- Do not delete persisted screen metadata.
- Do not force this screen as active; active falls back to another non-empty/available screen.

2. **Close + Clear Saved Data**
- Close all tabs in the screen.
- Remove the screen from state.
- Persist removal to settings.

### 7.1 Why split these two?

Separating “close current runtime content” from “delete saved structure” matches common user expectations and reduces accidental data loss.

## 8. UX Details

- Screen close button area displays a small `screenId` label for disambiguation.
- Danger option remains explicit in dialog wording and button style.

## 9. Acceptance Criteria

- No duplicate `Move To Screen` entries for same `screenId`.
- New terminal does not auto-group.
- Tab move across screens does not auto-group.
- Group metadata survives `Close (Session Only)`.
- `Move To Screen` and `Move To Group` submenu patterns are consistent.
- Removing last screen is allowed (app clears workspace state safely).

## 10. Known Tradeoffs

- Keeping empty screens/groups may retain more metadata than minimal state; acceptable for user continuity.
- Session-only close can make a screen appear “empty but present”; this is intentional to allow later reuse and move targets.

## 11. Future Work

- Add dedicated “Hide Screen” vs “Archive Screen” taxonomy if needed.
- Add telemetry/debug counters for per-screen render updates in dev mode.
- Add e2e tests for close-dialog branches and move-menu behavior.
