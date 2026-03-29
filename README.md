# MultiClaude

Run multiple AI coding CLI profiles in parallel, with isolated terminals and workspace management.

MultiClaude is an Electron desktop app for teams or individuals who switch between different providers/models (Claude and Codex-compatible endpoints), different API keys, and different working directories all day.

## What It Solves

Instead of manually changing shell environment variables, MultiClaude lets you save named profiles and launch terminals with the right env injected automatically.

## Current Capabilities

- Config profiles for two providers:
  - `claude` (Anthropic-style env set)
  - `codex` (OpenAI-compatible env + generated `CODEX_HOME/config.toml`)
- Embedded terminal tabs (xterm.js + node-pty)
- Open system terminal with the selected config
- Multi-screen workspace (up to 4 screens)
- Screen-local tab groups (rename/collapse/delete, explicit move to group)
- Worktree launcher (create/list/open/prune worktrees, merge readiness, copy merge commands)
- Batch stress launcher (spawn N terminals in subdirs, run multi-round scripts, export JSON report)
- Preflight checks before launch (missing model/key, invalid URL/JSON, Claude hooks warnings)
- Runtime state detection (`running` / `waiting` / `idle` / `exited`) + jump to next waiting terminal
- Sidebar collapse/expand + persisted sidebar width
- Import/export configs (export intentionally removes secret keys/tokens)

## Multi-Screen Behavior

- Max 4 screens, canonical slots: `screen-a` to `screen-d`
- New screen uses the first unused slot id/name
- Screen ids are deduplicated during load normalization
- Adaptive layout:
  - 1 screen: full area
  - 2 screens: 50/50
  - 3 screens: two quarter panes on the left + one half-height pane on the right
  - 4 screens: 2x2
- `Move To Screen` is a submenu (existing screens + `+ New Screen...`)
- Moving a tab across screens does not auto-add it into any group

## Close Screen Semantics

Click the `x` on a screen pane, then choose:

- `Close (Session Only)`:
  - Closes tabs in that screen for this session
  - Keeps persisted screen/group metadata
- `Close + Clear Saved Data`:
  - Closes tabs
  - Removes persisted screen data

## Environment Injection Model

For each launched terminal, MultiClaude writes an env file under user data and injects provider vars.

- Claude profile uses variables like:
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_MODEL`
- Codex profile uses variables like:
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY` (or custom env key)
  - `OPENAI_MODEL`
  - `CODEX_HOME`

To ensure shell init does not override your config, MultiClaude also writes a per-config `ZDOTDIR` wrapper when using zsh.

## Quick Start

### 1) Install and run

```bash
pnpm install
pnpm run dev
```

### 2) Create a config

In sidebar:

1. Click `+`
2. Choose provider (`Claude` or `Codex`)
3. Fill model/base URL/API key
4. Save

### 3) Launch terminals

- Embedded terminal: click `Terminal`
- System terminal: open action menu (`...`) -> `System`
- Worktree terminal: click `Worktree`

### 4) Organize tabs

- Right click tab -> `Move To Screen`
- Right click tab -> `Move To Group`
- Right click group -> rename / close all / delete

## Keyboard Shortcuts

- `Cmd/Ctrl+T`: New terminal
- `Cmd/Ctrl+Shift+T`: New system terminal
- `Cmd/Ctrl+Alt+T`: New worktree terminal
- `Cmd/Ctrl+W`: Close terminal tab
- `Cmd/Ctrl+Shift+]` / `Cmd/Ctrl+Shift+[` : Next/previous tab
- `Cmd/Ctrl+;` : Jump to next waiting terminal
- `Cmd/Ctrl+K`: Clear terminal
- `Cmd/Ctrl+B`: Toggle sidebar
- `Cmd/Ctrl+1..9`: Go to tab by index
- `Cmd/Ctrl+,`: Preferences

## Storage Paths

Data is stored in Electron `app.getPath('userData')` (platform specific), including:

- `configs.json`
- `settings.json`
- `env-files/`
- `codex-homes/`

## Build / Test

```bash
pnpm run build
pnpm run test
pnpm run test:coverage
pnpm run start
```

Package:

```bash
pnpm run dist:mac
pnpm run dist:win
```

## Project Structure

- `src/main/`: Electron main process (IPC, PTY, config store, env builder, protocol/worktree services)
- `src/preload/`: secure bridge API
- `src/renderer/`: UI, state store, components
- `src/shared/`: shared types/constants

## Repository

- Source: https://github.com/zkkython/MultiClaude
- Issues: https://github.com/zkkython/MultiClaude/issues
