# MultiClaude



Run multiple Claude Code (or any LLM CLI) configurations in parallel terminals. Define model configs with different API endpoints, tokens, and models, then launch terminals — embedded or system — with the correct environment variables automatically injected.

## Why MultiClaude?

Claude Code CLI reads its configuration from environment variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, etc.). If you work with multiple models (Opus 4.6, Kimi K2.5, GLM-5, etc.) via a mix of direct API access and API proxies, you need different env vars in different terminal windows. Managing this manually with shell aliases or dotfiles is error-prone.

MultiClaude solves this by letting you:

- **Define named configs** — each one stores a complete set of env vars for a model
- **Open embedded terminals** — xterm.js-powered terminals right inside the app, each with its own config
- **Open system terminals** — launch macOS Terminal.app with the correct env vars pre-loaded
- **Run configs in parallel** — different tabs/windows can use different models simultaneously

## Features

- **Config Management** — Create, edit, duplicate, delete, import/export model configurations
- **Embedded Terminal** — Full xterm.js terminal with WebGL rendering, clickable links, and right-click context menu
- **System Terminal** — One-click to open macOS Terminal.app with env vars injected
- **Multi-Tab** — Run multiple terminals simultaneously with different configs
- **Env Override** — Correctly overrides env vars even when `~/.zshrc` sets them (ZDOTDIR + CLAUDE_ENV_FILE dual mechanism)
- **Config Search** — Filter configs by name when you have 5+
- **Resizable Sidebar** — Drag to resize, width persisted across restarts
- **Dark Theme** — Catppuccin Mocha-inspired design
- **Keyboard Shortcuts** — Full menu bar with standard shortcuts
- **Import/Export** — Share configs across machines via JSON files

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
│                                                         │
│  ┌──────────────┐    IPC     ┌────────────────────────┐ │
│  │ Main Process │◄──────────►│   Renderer Process     │ │
│  │              │            │                        │ │
│  │ config-store │            │  Sidebar  │ Terminal   │ │
│  │ pty-manager  │  node-pty  │  Config   │ Tabs       │ │
│  │ env-builder  │◄──────────►│  Editor   │ xterm.js   │ │
│  │ system-term  │            │  Status   │ Views      │ │
│  │ menu         │            │  Bar      │            │ │
│  └──────────────┘            └────────────────────────┘ │
│         │                                               │
│         ▼                                               │
│  ~/.multiclaude/configs.json                            │
│  ~/Library/Application Support/multiclaude/env-files/   │
└─────────────────────────────────────────────────────────┘
```

### Project Structure

```
src/
├── main/                          # Electron main process
│   ├── index.ts                   # App lifecycle, window creation
│   ├── ipc-handlers.ts            # All IPC handler registrations
│   ├── pty-manager.ts             # node-pty spawn/write/resize/kill
│   ├── config-store.ts            # Config CRUD, JSON file I/O
│   ├── system-terminal.ts         # Launch macOS Terminal.app with env vars
│   ├── env-builder.ts             # Build env vars + ZDOTDIR wrapper
│   └── menu.ts                    # Application menu bar
├── preload/
│   └── index.ts                   # contextBridge API
├── renderer/
│   ├── index.html                 # Entry HTML
│   ├── index.ts                   # App init, event wiring
│   ├── styles/
│   │   └── main.css               # All styles (Catppuccin Mocha theme)
│   ├── components/
│   │   ├── Sidebar.ts             # Config list, search, action buttons
│   │   ├── ConfigEditor.ts        # Create/edit config modal
│   │   ├── TerminalTabs.ts        # Tab bar management
│   │   ├── TerminalView.ts        # xterm.js wrapper + context menu
│   │   ├── WelcomeScreen.ts       # First-launch empty state
│   │   └── StatusBar.ts           # Bottom info bar
│   └── state/
│       └── store.ts               # Simple pub/sub reactive state
└── shared/
    ├── types.ts                   # TypeScript interfaces
    └── constants.ts               # IPC channel names, defaults
```

### How Env Override Works

The core challenge: PTY terminals start a login shell (zsh) that sources `~/.zshrc`, which may overwrite the env vars we inject. MultiClaude uses a dual mechanism:

1. **ZDOTDIR wrapper** (for embedded terminals) — Points zsh to a custom `.zshrc` that sources the real `~/.zshrc` first, then re-exports MultiClaude's config vars on top.
2. **CLAUDE_ENV_FILE** (for Claude Code) — Creates a shell script with all config vars. Claude Code sources this file on startup, overriding anything the shell set.
3. **`osascript do script`** (for system terminals) — After Terminal.app opens and completes shell init, sources the env file to override variables.

### Data Model

Each config stores:

| Field                        | Env Var                                    | Description                       |
| ---------------------------- | ------------------------------------------ | --------------------------------- |
| `anthropicBaseUrl`           | `ANTHROPIC_BASE_URL`                       | API endpoint URL                  |
| `anthropicAuthToken`         | `ANTHROPIC_AUTH_TOKEN`                     | Auth token                        |
| `anthropicModel`             | `ANTHROPIC_MODEL`                          | Primary model name                |
| `anthropicSmallFastModel`    | `ANTHROPIC_SMALL_FAST_MODEL`               | Fast model for lightweight tasks  |
| `apiTimeoutMs`               | `API_TIMEOUT_MS`                           | Request timeout (default: 600000) |
| `disableNonessentialTraffic` | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable telemetry                 |
| `customEnvVars`              | *(any)*                                    | Arbitrary key-value env vars      |

Configs are persisted in `~/Library/Application Support/multiclaude/configs.json` with file permissions restricted to owner (0600).

## Installation

### From DMG (Recommended)

1. Download the latest `.dmg` from [Releases](https://github.com/anthropics/multiclaude/releases)
2. Open the DMG and drag **MultiClaude** to Applications
3. Launch from Applications or Spotlight

> **macOS Gatekeeper Notice**: This app is not code-signed with an Apple Developer certificate. On first launch, macOS may show **"MultiClaude.app is damaged and can't be opened"** or **"Apple cannot check it for malicious software"**. To fix this, run the following command in Terminal:
>
> ```bash
> xattr -cr /Applications/MultiClaude.app
> ```
>
> Then reopen the app. This removes the macOS quarantine flag applied to apps downloaded from the internet.

### From Source

Requirements: Node.js >= 18, pnpm

```bash
git clone https://github.com/anthropics/multiclaude.git
cd multiclaude
pnpm install
node scripts/build.js
npx electron .
```

### Build DMG

#### Dev Build (No Signing)

For local testing, no Apple Developer account required:

```bash
pnpm run dist:mac:dev
```

> The dev DMG is unsigned. On first launch, macOS may block it — run `xattr -cr /Applications/MultiClaude.app` to bypass.

#### Production Build (Signed + Notarized)

For official releases. Requires Apple Developer credentials:

```bash
export APPLE_ID="your@apple.id"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"

pnpm run dist:mac:prod
```

| Env Variable                    | Description                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| `APPLE_ID`                      | Your Apple ID email                                                      |
| `APPLE_APP_SPECIFIC_PASSWORD`   | App-specific password (generate at [appleid.apple.com](https://appleid.apple.com)) |
| `APPLE_TEAM_ID`                 | Apple Developer Team ID                                                  |

The production build automatically code-signs and notarizes the app, so users won't see Gatekeeper warnings.

Output: `out/MultiClaude-1.0.0-arm64.dmg` (and/or x64)

## Usage Guide

### 1. Create a Config

Launch MultiClaude. On first launch you'll see the welcome screen.

Click **Create Your First Config** and fill in:

- **Name** — A descriptive name (e.g. "Opus 4.6 Direct", "Kimi K2.5 via Proxy")
- **Color** — Pick a color to visually distinguish this config
- **Model** — The model identifier (e.g. `claude-opus-4-6`, `kimi-k2.5`)
- **Base URL** — API endpoint (e.g. `https://api.anthropic.com`, `https://api.kimi.com/coding/`)
- **Auth Token** — Your API key or auth token
- **Custom Env Vars** — Any additional env vars needed (click "+ Add Variable")

Click **Create**.

### 2. Open an Embedded Terminal

Select a config in the sidebar (single click to select). Then:

- Click the **Terminal** button on the config, or
- Press `Cmd+T`

A new terminal tab opens with all config env vars injected. Run `claude` and it will use the configured model.

Verify with:

```bash
env | grep ANTHROPIC
```

### 3. Open a System Terminal

Click the **System** button on a config. macOS Terminal.app opens a new window with the env vars loaded. You'll see a confirmation:

```
[MultiClaude] Config loaded: Kimi K2.5
```

### 4. Manage Multiple Terminals

- **Switch tabs**: Click tabs or use `Cmd+Shift+]` / `Cmd+Shift+[`
- **Go to tab N**: `Cmd+1` through `Cmd+9`
- **Close tab**: Click the X on the tab or `Cmd+W`
- **Clear terminal**: `Cmd+K`

### 5. Import / Export Configs

- **Export**: Menu > Config > Export Configs — saves all configs to a JSON file
- **Import**: Menu > Config > Import Configs — loads configs from a JSON file, auto-renames duplicates

**Note**: Exported files contain auth tokens in plaintext. Handle with care.

### Keyboard Shortcuts

| Shortcut          | Action                                    |
| ----------------- | ----------------------------------------- |
| `Cmd+T`           | New embedded terminal for selected config |
| `Cmd+Shift+T`     | New system terminal for selected config   |
| `Cmd+W`           | Close active terminal tab                 |
| `Cmd+N`           | New config                                |
| `Cmd+E`           | Edit selected config                      |
| `Cmd+D`           | Duplicate selected config                 |
| `Cmd+K`           | Clear terminal                            |
| `Cmd+B`           | Toggle sidebar                            |
| `Cmd+Shift+]`     | Next tab                                  |
| `Cmd+Shift+[`     | Previous tab                              |
| `Cmd+1`..`Cmd+9`  | Go to tab N                               |
| `Cmd+=` / `Cmd+-` | Zoom in / out                             |
| `Cmd+0`           | Reset zoom                                |

### Right-Click Context Menu

Right-click in a terminal for:

- Copy / Paste / Select All
- Clear Terminal
- Open System Terminal (with same config)

## Tech Stack

| Component | Technology                                        |
| --------- | ------------------------------------------------- |
| Framework | Electron 34                                       |
| Language  | TypeScript 5.7                                    |
| Terminal  | @xterm/xterm 5.5 + addons (fit, webgl, web-links) |
| PTY       | node-pty                                          |
| Bundler   | esbuild                                           |
| Packaging | electron-builder                                  |
| UI        | Vanilla TypeScript (no framework)                 |

## Development

```bash
# Install dependencies
pnpm install

# Build once
node scripts/build.js

# Run in dev mode
npx electron .

# Build dev DMG (unsigned)
pnpm run dist:mac:dev

# Build production DMG (signed + notarized, requires APPLE_ID env vars)
pnpm run dist:mac:prod
```

## Contributing

Contributions are welcome! If you find a bug, have a feature request, or want to improve MultiClaude:

- **Report Issues** — Open an [Issue](https://github.com/zkkython/MultiClaude/issues) to report bugs or suggest features
- **Submit PRs** — Fork the repo, make your changes, and open a Pull Request
- **Share Ideas** — Start a [Discussion](https://github.com/zkkython/MultiClaude/discussions) for questions or ideas

All contributions, big or small, are appreciated.

## License

Apache 2.0
