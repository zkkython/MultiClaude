// IPC Channel Names
export const IPC = {
  CONFIG_GET_ALL: 'config:get-all',
  CONFIG_CREATE: 'config:create',
  CONFIG_UPDATE: 'config:update',
  CONFIG_DELETE: 'config:delete',
  CONFIG_DUPLICATE: 'config:duplicate',
  CONFIG_CHANGED: 'config:changed',
  CONFIG_EXPORT: 'config:export',
  CONFIG_IMPORT: 'config:import',

  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_STATE: 'terminal:state',
  TERMINAL_STATE_SNAPSHOT_GET: 'terminal:state-snapshot:get',
  RUNNER_SESSION_START: 'runner:session:start',
  RUNNER_EVENT_INGEST: 'runner:event:ingest',
  RUNNER_INPUT_RESOLVE: 'runner:input:resolve',
  RUNNER_INPUT_SUBMIT: 'runner:input:submit',
  RUNNER_SESSION_INTERRUPT: 'runner:session:interrupt',
  RUNNER_SESSION_STOP: 'runner:session:stop',
  RUNNER_SESSION_END: 'runner:session:end',
  RUNNER_EVENT: 'runner:event',
  RUNNER_METRICS_GET: 'runner:metrics:get',
  RUNNER_METRICS_RESET: 'runner:metrics:reset',
  RUNNER_CONNECTIVITY_TEST: 'runner:connectivity:test',

  SYSTEM_TERMINAL_OPEN: 'system-terminal:open',

  CONTEXT_MENU_SHOW: 'context-menu:show',
  MENU_ACTION: 'menu:action',

  APP_NOTIFICATION: 'app:notification',
  APP_GET_SETTINGS: 'app:get-settings',
  APP_SAVE_SETTINGS: 'app:save-settings',
} as const;

// Default values
export const DEFAULTS = {
  API_TIMEOUT_MS: 600000,
  SIDEBAR_WIDTH: 260,
  SIDEBAR_MIN_WIDTH: 180,
  SIDEBAR_MAX_WIDTH: 400,
  CONFIG_SEARCH_THRESHOLD: 5,
  WINDOW_WIDTH: 1200,
  WINDOW_HEIGHT: 800,
  WINDOW_MIN_WIDTH: 800,
  WINDOW_MIN_HEIGHT: 600,
} as const;

// Default config colors
export const CONFIG_COLORS = [
  '#4A90D9', // Blue
  '#7B68EE', // Purple
  '#E74C3C', // Red
  '#2ECC71', // Green
  '#F39C12', // Orange
  '#1ABC9C', // Teal
  '#E91E63', // Pink
  '#9B59B6', // Deep Purple
] as const;
