import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ClaudeHooksStatus } from '../shared/types.js';

const CLAUDE_HOOK_EVENTS = [
  'Stop',
  'SubagentStop',
  'Notification',
  'PermissionRequest',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
] as const;

interface ClaudeHooksDeps {
  homedir: () => string;
  cwd: () => string;
  resourcesPath: () => string;
}

const defaultDeps: ClaudeHooksDeps = {
  homedir: () => os.homedir(),
  cwd: () => process.cwd(),
  resourcesPath: () => process.resourcesPath,
};

let deps: ClaudeHooksDeps = defaultDeps;

export async function getClaudeHooksStatus(): Promise<ClaudeHooksStatus> {
  const info = await resolveClaudeHookIntegrationInfo();
  if (!info.scriptExists) {
    return {
      installed: false,
      settingsPath: info.settingsPath,
      hookScriptPath: info.hookScriptPath,
      command: info.command,
      missingEvents: [...CLAUDE_HOOK_EVENTS],
      error: 'hook script not found',
    };
  }
  try {
    const settings = await readClaudeSettingsObject(info.settingsPath);
    const hooks = ensureRecord(settings, 'hooks');
    const missingEvents = CLAUDE_HOOK_EVENTS.filter((eventName) => !hasHookEntry(hooks, eventName, info.command));
    return {
      installed: missingEvents.length === 0,
      settingsPath: info.settingsPath,
      hookScriptPath: info.hookScriptPath,
      command: info.command,
      missingEvents,
    };
  } catch (err) {
    return {
      installed: false,
      settingsPath: info.settingsPath,
      hookScriptPath: info.hookScriptPath,
      command: info.command,
      missingEvents: [...CLAUDE_HOOK_EVENTS],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function installClaudeHooksConfig(): Promise<void> {
  const info = await resolveClaudeHookIntegrationInfo();
  if (!info.scriptExists) {
    throw new Error(`hook script not found: ${info.hookScriptPath}`);
  }
  const settings = await readClaudeSettingsObject(info.settingsPath);
  const hooks = ensureRecord(settings, 'hooks');
  for (const eventName of CLAUDE_HOOK_EVENTS) {
    ensureHookEntry(hooks, eventName, info.command);
  }
  await fs.mkdir(path.dirname(info.settingsPath), { recursive: true });
  await fs.writeFile(info.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function resolveClaudeHookIntegrationInfo(): Promise<{
  hookScriptPath: string;
  settingsPath: string;
  command: string;
  scriptExists: boolean;
}> {
  const settingsPath = path.resolve(deps.homedir(), '.claude/settings.json');
  const packagedUnpackedHookPath = path.resolve(deps.resourcesPath(), 'app.asar.unpacked/dist/hooks/claude-runner-sidechannel.js');
  const packagedAsarHookPath = path.resolve(deps.resourcesPath(), 'app.asar/dist/hooks/claude-runner-sidechannel.js');
  const candidates = [
    packagedUnpackedHookPath,
    packagedAsarHookPath,
    path.resolve(deps.cwd(), 'scripts/hooks/claude-runner-sidechannel.js'),
    path.resolve(__dirname, '../../scripts/hooks/claude-runner-sidechannel.js'),
    path.resolve(__dirname, '../hooks/claude-runner-sidechannel.js'),
  ];
  let hookScriptPath = candidates[0];
  let scriptExists = false;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      hookScriptPath = candidate;
      scriptExists = true;
      break;
    } catch {
      // continue
    }
  }
  return {
    hookScriptPath,
    settingsPath,
    command: `node ${quoteShellArg(hookScriptPath)}`,
    scriptExists,
  };
}

export function quoteShellArg(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

export async function readClaudeSettingsObject(settingsPath: string): Promise<Record<string, unknown>> {
  let raw = '';
  try {
    raw = await fs.readFile(settingsPath, 'utf8');
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid settings root (must be JSON object)');
  }
  return parsed as Record<string, unknown>;
}

export function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

export function ensureHookEntry(hooks: Record<string, unknown>, eventName: string, command: string): void {
  let eventList: Array<Record<string, unknown>> = [];
  const current = hooks[eventName];
  if (Array.isArray(current)) {
    eventList = current.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  }

  const hasCommand = eventList.some((entry) => {
    const hookItems = entry.hooks;
    if (!Array.isArray(hookItems)) return false;
    return hookItems.some((hookItem) => {
      if (!hookItem || typeof hookItem !== 'object' || Array.isArray(hookItem)) return false;
      const record = hookItem as Record<string, unknown>;
      return record.type === 'command' && record.command === command;
    });
  });

  if (hasCommand) {
    hooks[eventName] = eventList;
    return;
  }

  const commandHook = {
    type: 'command',
    command,
  };
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse') {
    eventList.push({
      matcher: '*',
      hooks: [commandHook],
    });
  } else {
    eventList.push({
      hooks: [commandHook],
    });
  }
  hooks[eventName] = eventList;
}

export function hasHookEntry(hooks: Record<string, unknown>, eventName: string, command: string): boolean {
  const current = hooks[eventName];
  if (!Array.isArray(current)) return false;
  for (const entry of current) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const hookItems = (entry as Record<string, unknown>).hooks;
    if (!Array.isArray(hookItems)) continue;
    for (const hookItem of hookItems) {
      if (!hookItem || typeof hookItem !== 'object' || Array.isArray(hookItem)) continue;
      const record = hookItem as Record<string, unknown>;
      if (record.type === 'command' && record.command === command) {
        return true;
      }
    }
  }
  return false;
}

export function __setClaudeHooksDepsForTest(overrides: Partial<ClaudeHooksDeps> | null): void {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
}
