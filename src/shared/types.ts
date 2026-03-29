export type ConfigProvider = 'claude' | 'codex';
export type CodexHomeMode = 'isolated' | 'default';
export type CodexWireApi = 'responses' | 'chat_completions';

export interface ModelConfig {
  id: string;
  name: string;
  color: string;
  provider: ConfigProvider;
  anthropicBaseUrl: string;
  anthropicAuthToken: string;
  apiTimeoutMs: number;
  anthropicModel: string;
  anthropicSmallFastModel: string;
  disableNonessentialTraffic: boolean;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  codexHomeMode: CodexHomeMode;
  codexHomeName: string;
  codexModelProvider: string;
  codexApiKeyEnvKey: string;
  codexPersonality: string;
  codexModelReasoningEffort: string;
  codexWireApi: CodexWireApi;
  customEnvVars: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
}

export type ModelConfigCreate = Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'>;
export type ModelConfigUpdate = Partial<ModelConfigCreate> & { id: string };

export interface TerminalTab {
  id: string;
  terminalId?: string;
  configId: string;
  configName: string;
  configColor: string;
  provider: ConfigProvider;
  status: 'running' | 'exited';
  customName?: string;
}

export interface ScreenWorkspace {
  id: string;
  name: string;
  tabs: TerminalTab[];
  activeTabId: string | null;
  groups: TabGroup[];
}

export type RuntimeState = 'running' | 'waiting' | 'idle' | 'exited';
export type RuntimeStateConfidence = 'high' | 'medium' | 'low';
export type RuntimeStateSource = 'explicit' | 'pattern' | 'keyword' | 'timing' | 'process';

export interface TerminalRuntimeState {
  state: RuntimeState;
  confidence: RuntimeStateConfidence;
  reason: string;
  source: RuntimeStateSource;
  updatedAt: number;
}

export interface TerminalSpawnResult {
  terminalId: string;
}

export interface ImportConflict {
  name: string;
  action: 'skip' | 'overwrite' | 'rename';
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
  tabIds: string[];
  associatedConfigIds: string[];
}

export interface TabGroupPersisted {
  id: string;
  name: string;
  color: string;
  associatedConfigIds: string[];
}

export interface AppSettings {
  sidebarWidth: number;
  groups?: TabGroupPersisted[];
  screens?: Array<{
    id: string;
    name: string;
  }>;
  activeScreenId?: string;
  screenGroups?: Record<string, TabGroupPersisted[]>;
  useWebglRenderer?: boolean;
  worktreeRecentRepoPaths?: string[];
  worktreeDefaultTargetRef?: string;
}

export interface TerminalSpawnOptions {
  cwd?: string;
}

export interface SystemTerminalOpenOptions {
  cwd?: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isMain: boolean;
}

export interface WorktreeStatus {
  path: string;
  dirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
}

export interface WorktreeCreateInput {
  repoPath: string;
  worktreePath: string;
  branchName: string;
  fromRef?: string;
  useExistingBranch?: boolean;
}

export interface WorktreeRemoveInput {
  repoPath: string;
  worktreePath: string;
}

export interface WorktreeMergeReadiness {
  worktreePath: string;
  sourceRef: string;
  targetRef: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
  confidence: 'high' | 'low';
}

export interface WorktreeMergeTemplateInput {
  strategy: 'merge' | 'rebase' | 'squash';
  sourceRef: string;
  targetRef: string;
}

export interface WorktreeMergeTemplateResult {
  strategy: 'merge' | 'rebase' | 'squash';
  command: string;
}

export type RunnerEventType =
  | 'session.started'
  | 'output.delta'
  | 'output.completed'
  | 'input.requested'
  | 'status.changed'
  | 'session.completed'
  | 'session.failed';

export interface RunnerEvent {
  id: string;
  ts: number;
  provider: ConfigProvider;
  sessionId: string;
  type: RunnerEventType;
  [key: string]: unknown;
}

export interface RunnerStartResult {
  sessionId: string;
  provider: ConfigProvider;
  linkedTerminalId?: string;
  transportType?: 'pty' | 'http_sse';
}

export type RunnerUserInputType = 'user_response' | 'user_approve' | 'user_reject';

export interface RunnerUserInput {
  sessionId: string;
  requestId: string;
  type: RunnerUserInputType;
  text?: string;
}

export interface RunnerMetricsSnapshot {
  counters: {
    interactionExpectedTotal: number;
    interactionTriggeredTotal: number;
    interactionFalsePositiveTotal: number;
    stateComparisonTotal: number;
    stateMismatchTotal: number;
    fallbackAttemptTotal: number;
    fallbackSuccessTotal: number;
  };
  rates: {
    interactionRecall: number | null;
    falsePositiveRate: number | null;
    stateMismatchRate: number | null;
    fallbackRecoveryRate: number | null;
  };
  goals: {
    interactionRecallGte99: boolean;
    falsePositiveRateLte0_5: boolean;
    stateMismatchRateLte0_5: boolean;
    fallbackRecoveryEq100: boolean;
    allMet: boolean;
  };
}

export interface ProtocolConnectivityCheckInput {
  provider: ConfigProvider;
  anthropicBaseUrl?: string;
  anthropicAuthToken?: string;
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  customEnvVars?: Record<string, string>;
}

export interface ProtocolConnectivityCheckResult {
  ok: boolean;
  transportType: 'pty' | 'http_sse';
  summary: string;
  details: Array<{
    name: string;
    ok: boolean;
    status?: number;
    message: string;
    url?: string;
  }>;
}

export interface ClaudeHooksStatus {
  installed: boolean;
  settingsPath: string;
  hookScriptPath: string;
  command: string;
  missingEvents: string[];
  error?: string;
}

// Preload API exposed to renderer
export interface MultiClaudeAPI {
  config: {
    getAll(): Promise<ModelConfig[]>;
    create(config: ModelConfigCreate): Promise<ModelConfig>;
    update(config: ModelConfigUpdate): Promise<ModelConfig>;
    delete(id: string): Promise<void>;
    duplicate(id: string): Promise<ModelConfig>;
    export(): Promise<boolean>;
    import(): Promise<ImportResult | null>;
    onChanged(callback: () => void): () => void;
  };
  terminal: {
    spawn(configId: string, options?: TerminalSpawnOptions): Promise<TerminalSpawnResult>;
    write(terminalId: string, data: string): void;
    resize(terminalId: string, cols: number, rows: number): void;
    kill(terminalId: string): void;
    onData(callback: (terminalId: string, data: string) => void): () => void;
    onExit(callback: (terminalId: string, code: number) => void): () => void;
    onState(callback: (terminalId: string, state: TerminalRuntimeState) => void): () => void;
    getStateSnapshot(): Promise<Record<string, TerminalRuntimeState>>;
  };
  systemTerminal: {
    open(configId: string, options?: SystemTerminalOpenOptions): Promise<void>;
  };
  contextMenu: {
    show(terminalId: string, hasSelection: boolean): void;
  };
  menu: {
    onAction(callback: (action: string, payload?: any) => void): () => void;
  };
  app: {
    onNotification(callback: (title: string, body: string, terminalId?: string) => void): () => void;
    getSettings(): Promise<AppSettings>;
    saveSettings(settings: Partial<AppSettings>): Promise<void>;
    selectDirectory(defaultPath?: string): Promise<string | null>;
    ensureDirectory(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<string>;
    setIgnoreMenuShortcuts(ignore: boolean): Promise<void>;
  };
  worktree: {
    list(repoPath: string): Promise<WorktreeInfo[]>;
    create(input: WorktreeCreateInput): Promise<WorktreeInfo>;
    remove(input: WorktreeRemoveInput): Promise<void>;
    prune(repoPath: string): Promise<void>;
    status(worktreePath: string): Promise<WorktreeStatus>;
    mergeReadiness(worktreePath: string, targetRef: string): Promise<WorktreeMergeReadiness>;
    buildMergeTemplate(input: WorktreeMergeTemplateInput): Promise<WorktreeMergeTemplateResult>;
  };
  protocol: {
    startSession(configId: string, terminalId?: string): Promise<RunnerStartResult>;
    ingestRawEvent(sessionId: string, rawEvent: unknown): Promise<void>;
    resolveInput(sessionId: string, requestId: string): Promise<boolean>;
    submitInput(input: RunnerUserInput): Promise<boolean>;
    interruptSession(sessionId: string): Promise<boolean>;
    stopSession(sessionId: string): Promise<boolean>;
    endSession(sessionId: string): Promise<void>;
    onEvent(callback: (event: RunnerEvent) => void): () => void;
    getMetrics(): Promise<RunnerMetricsSnapshot>;
    resetMetrics(): Promise<void>;
    testConnectivity(input: ProtocolConnectivityCheckInput): Promise<ProtocolConnectivityCheckResult>;
    getClaudeHooksStatus(): Promise<ClaudeHooksStatus>;
    installClaudeHooks(): Promise<ClaudeHooksStatus>;
  };
}

declare global {
  interface Window {
    multiclaude: MultiClaudeAPI;
  }
}
