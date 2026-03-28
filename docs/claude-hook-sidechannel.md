# Claude Hook -> Runner Waiting State

This enables accurate waiting/running state without terminal text heuristics.

## 1) What multiclaude injects into terminal env

When terminal starts, multiclaude now provides:

- `MC_RUNNER_EVENT_URL`
- `MC_RUNNER_EVENT_TOKEN`
- `MC_RUNNER_TERMINAL_ID`

Hook script uses these to report interaction states to main process side-channel.

## 2) Hook bridge script

Use:

- `scripts/hooks/claude-runner-sidechannel.js`

It reads Claude hook JSON from stdin and maps:

- `PermissionRequest` -> `state=waiting`
- `Notification` -> `state=waiting` only when payload has actionable structured fields (`request_id` / `permission_request_id` / `requires_response` / options-like arrays, etc.)
- `UserPromptSubmit` / `PreToolUse` / `PostToolUse` -> `state=running`

Then POSTs to `MC_RUNNER_EVENT_URL` with `x-mc-runner-token`.

## 3) Claude settings example

Reference example file:

- `.claude/examples/settings.hooks.runner.example.json`

Merge the `hooks` section into your active Claude settings file:

- user-level: `~/.claude/settings.json`
- project-level: `.claude/settings.json`

Adjust absolute command path if repo location differs.

## 4) Verify

Run a Claude session in multiclaude and trigger a permission confirmation.
Expected:

- prompt appears in terminal
- tab runtime state becomes `waiting`
- after user input/continue, state returns to `running`
