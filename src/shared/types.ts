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
  configId: string;
  configName: string;
  configColor: string;
  provider: ConfigProvider;
  status: 'running' | 'exited';
  customName?: string;
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

export interface AppSettings {
  sidebarWidth: number;
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
  };
  terminal: {
    spawn(configId: string): Promise<TerminalSpawnResult>;
    write(terminalId: string, data: string): void;
    resize(terminalId: string, cols: number, rows: number): void;
    kill(terminalId: string): void;
    onData(callback: (terminalId: string, data: string) => void): () => void;
    onExit(callback: (terminalId: string, code: number) => void): () => void;
  };
  systemTerminal: {
    open(configId: string): Promise<void>;
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
  };
}

declare global {
  interface Window {
    multiclaude: MultiClaudeAPI;
  }
}
