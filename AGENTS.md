# Repository Guidelines

## Project Structure & Module Organization
Core code lives in `src/` and is split by Electron process boundaries:
- `src/main/`: app lifecycle, IPC handlers, PTY management, menu, config storage.
- `src/preload/`: secure `contextBridge` API exposed to renderer.
- `src/renderer/`: UI (`components/`), state (`state/store.ts`), and styles (`styles/main.css`).
- `src/shared/`: shared constants and TypeScript types.

Build output is generated into `dist/` (`main`, `preload`, `renderer`). Packaging artifacts go to `out/`. Static branding assets live in `assets/`.

## Build, Test, and Development Commands
- `pnpm install`: install dependencies (Node.js >= 18).
- `pnpm run dev`: watch/build via esbuild and launch Electron in development mode.
- `pnpm run build`: one-time production build into `dist/`.
- `pnpm run start`: run Electron from existing `dist/` output.
- `pnpm run dist:mac` / `pnpm run dist:win`: package distributables with `electron-builder`.

Example local loop:
```bash
pnpm install
pnpm run dev
```

## Coding Style & Naming Conventions
Use TypeScript with `strict` mode expectations (`tsconfig.json`). Follow existing style:
- 2-space indentation, semicolons, single quotes.
- ESM-style imports with explicit `.js` extension in TS source where already used.
- File names use kebab-case (e.g., `ipc-handlers.ts`); classes/components use PascalCase (`TerminalView.ts`); variables/functions use camelCase.

No ESLint/Prettier config is currently committed; keep diffs minimal and match surrounding style exactly.

## Testing Guidelines
There is no automated test suite yet. Before opening a PR:
- Run `pnpm run build` and ensure it succeeds.
- Smoke-test core flows in app: create/edit config, open embedded terminal, open system terminal, tab switching.
- Verify no regressions in `dist/renderer/index.html` load and PTY startup.

If you add test infrastructure, place tests under `src/**/__tests__/` or alongside modules as `*.test.ts`.

## Commit & Pull Request Guidelines
Current history uses short, imperative commit messages (e.g., `fix key value append in add variable`, `add apple certification and fix terminal env`).
- Prefer one focused change per commit.
- Use present-tense imperative subject lines; keep them concise.
- In PRs, include: purpose, user-visible changes, platforms tested (macOS/Windows), and screenshots/GIFs for UI changes.
- Link related issues/discussions when applicable.
