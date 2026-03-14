import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ConfigProvider,
  ModelConfig,
  ModelConfigCreate,
  ModelConfigUpdate,
  ImportResult,
} from '../shared/types.js';
import { DEFAULTS } from '../shared/constants.js';
import { getCodexHomePath, getEnvFilePath, getZdotdirPath } from './config-paths.js';

const CONFIG_SCHEMA_VERSION = 2;

interface ConfigFileV2 {
  schemaVersion: number;
  configs: unknown[];
}

let nanoid: (size?: number) => string;

async function ensureNanoid() {
  if (!nanoid) {
    const mod = await import('nanoid');
    nanoid = mod.nanoid;
  }
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'configs.json');
}

function getConfigBackupPath(): string {
  return path.join(app.getPath('userData'), 'configs.v1.backup.json');
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function isProvider(value: unknown): value is ConfigProvider {
  return value === 'claude' || value === 'codex';
}

function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function normalizeConfig(raw: any, sortOrderFallback: number): ModelConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  const provider: ConfigProvider = isProvider(raw.provider) ? raw.provider : 'claude';
  const codexProviderName = typeof raw.codexModelProvider === 'string' && raw.codexModelProvider.trim()
    ? raw.codexModelProvider.trim().toLowerCase()
    : 'openai';
  const now = new Date().toISOString();
  const config: ModelConfig = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    color: typeof raw.color === 'string' && raw.color ? raw.color : '#4A90D9',
    provider,
    anthropicBaseUrl: typeof raw.anthropicBaseUrl === 'string' ? raw.anthropicBaseUrl : '',
    anthropicAuthToken: typeof raw.anthropicAuthToken === 'string' ? raw.anthropicAuthToken : '',
    apiTimeoutMs: typeof raw.apiTimeoutMs === 'number' && raw.apiTimeoutMs > 0 ? raw.apiTimeoutMs : DEFAULTS.API_TIMEOUT_MS,
    anthropicModel: typeof raw.anthropicModel === 'string' ? raw.anthropicModel : '',
    anthropicSmallFastModel: typeof raw.anthropicSmallFastModel === 'string' ? raw.anthropicSmallFastModel : '',
    disableNonessentialTraffic: Boolean(raw.disableNonessentialTraffic),
    openaiBaseUrl: typeof raw.openaiBaseUrl === 'string' ? raw.openaiBaseUrl : '',
    openaiApiKey: typeof raw.openaiApiKey === 'string' ? raw.openaiApiKey : '',
    openaiModel: typeof raw.openaiModel === 'string' ? raw.openaiModel : '',
    codexHomeMode: 'isolated',
    codexHomeName: typeof raw.codexHomeName === 'string' ? raw.codexHomeName : '',
    codexModelProvider: typeof raw.codexModelProvider === 'string' && raw.codexModelProvider.trim() ? raw.codexModelProvider : 'openai',
    codexApiKeyEnvKey: typeof raw.codexApiKeyEnvKey === 'string' && raw.codexApiKeyEnvKey.trim() ? raw.codexApiKeyEnvKey : 'OPENAI_API_KEY',
    codexPersonality: typeof raw.codexPersonality === 'string' ? raw.codexPersonality : 'pragmatic',
    codexModelReasoningEffort: typeof raw.codexModelReasoningEffort === 'string' ? raw.codexModelReasoningEffort : 'medium',
    codexWireApi: raw.codexWireApi === 'chat_completions'
      ? 'chat_completions'
      : 'responses',
    customEnvVars: normalizeCustomEnv(raw.customEnvVars),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : sortOrderFallback,
  };

  if (!config.name.trim()) return null;
  if (!config.id.trim()) return null;
  return config;
}

function normalizeCustomEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidEnvVarName(key)) continue;
    if (value === undefined || value === null) {
      out[key] = '';
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

function hasRequiredFields(config: ModelConfig): boolean {
  if (!config.name.trim()) return false;
  if (config.provider === 'codex') {
    return Boolean(config.openaiModel.trim());
  }
  return Boolean(config.anthropicModel.trim());
}

function readConfigsRaw(): { configs: ModelConfig[]; migrated: boolean; rawText: string | null } {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { configs: [], migrated: false, rawText: null };
  }

  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      const configs = parsed
        .map((item, i) => normalizeConfig(item, i))
        .filter((cfg): cfg is ModelConfig => cfg !== null);
      return { configs, migrated: true, rawText: text };
    }

    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as ConfigFileV2).configs)) {
      const v2 = parsed as ConfigFileV2;
      const configs = v2.configs
        .map((item, i) => normalizeConfig(item, i))
        .filter((cfg): cfg is ModelConfig => cfg !== null);
      const migrated = v2.schemaVersion !== CONFIG_SCHEMA_VERSION || configs.some(c => !c.provider);
      return { configs, migrated, rawText: text };
    }
  } catch (err) {
    console.error('Failed to read configs:', err);
  }

  return { configs: [], migrated: false, rawText: null };
}

function writeConfigFile(configs: ModelConfig[]): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    configs,
  };
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function backupV1IfNeeded(rawText: string | null): void {
  if (!rawText) return;
  const backupPath = getConfigBackupPath();
  if (fs.existsSync(backupPath)) return;
  fs.writeFileSync(backupPath, rawText, { mode: 0o600 });
}

function readConfigs(): ModelConfig[] {
  const { configs, migrated, rawText } = readConfigsRaw();
  if (migrated) {
    backupV1IfNeeded(rawText);
    writeConfigFile(configs);
  }
  return configs;
}

function withoutSecrets(config: ModelConfig): Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'> {
  const { id, createdAt, updatedAt, anthropicAuthToken, openaiApiKey, ...rest } = config;
  return {
    ...rest,
    anthropicAuthToken: '',
    openaiApiKey: '',
  };
}

function cleanupConfigArtifacts(config: ModelConfig): void {
  const envFilePath = getEnvFilePath(config.id);
  const zdotdirPath = getZdotdirPath(config.id);

  fs.rmSync(envFilePath, { force: true });
  fs.rmSync(zdotdirPath, { recursive: true, force: true });

  if (config.provider === 'codex') {
    const codexHomePath = getCodexHomePath(config);
    fs.rmSync(codexHomePath, { recursive: true, force: true });
  }
}

export function getAllConfigs(): ModelConfig[] {
  return readConfigs();
}

export async function createConfig(data: ModelConfigCreate): Promise<ModelConfig> {
  await ensureNanoid();
  const configs = readConfigs();
  const now = new Date().toISOString();

  const normalized = normalizeConfig(
    {
      ...data,
      id: nanoid(12),
      createdAt: now,
      updatedAt: now,
      sortOrder: data.sortOrder ?? configs.length,
    },
    configs.length
  );
  if (!normalized || !hasRequiredFields(normalized)) {
    throw new Error('Invalid config payload');
  }

  configs.push(normalized);
  writeConfigFile(configs);
  return normalized;
}

export function updateConfig(data: ModelConfigUpdate): ModelConfig {
  const configs = readConfigs();
  const index = configs.findIndex(c => c.id === data.id);
  if (index === -1) {
    throw new Error(`Config not found: ${data.id}`);
  }

  const normalized = normalizeConfig(
    {
      ...configs[index],
      ...data,
      updatedAt: new Date().toISOString(),
    },
    configs[index].sortOrder
  );
  if (!normalized || !hasRequiredFields(normalized)) {
    throw new Error('Invalid config payload');
  }

  configs[index] = normalized;
  writeConfigFile(configs);
  return normalized;
}

export function deleteConfig(id: string): void {
  const configs = readConfigs();
  const target = configs.find(c => c.id === id);
  if (!target) {
    throw new Error(`Config not found: ${id}`);
  }

  cleanupConfigArtifacts(target);
  const filtered = configs.filter(c => c.id !== id);
  writeConfigFile(filtered);
}

export async function duplicateConfig(id: string): Promise<ModelConfig> {
  await ensureNanoid();
  const configs = readConfigs();
  const source = configs.find(c => c.id === id);
  if (!source) {
    throw new Error(`Config not found: ${id}`);
  }

  const now = new Date().toISOString();
  const duplicate: ModelConfig = {
    ...source,
    id: nanoid(12),
    name: `${source.name} (Copy)`,
    createdAt: now,
    updatedAt: now,
    sortOrder: configs.length,
  };
  configs.push(duplicate);
  writeConfigFile(configs);
  return duplicate;
}

export function getConfigById(id: string): ModelConfig | undefined {
  return readConfigs().find(c => c.id === id);
}

export async function exportConfigs(filePath: string): Promise<boolean> {
  try {
    const configs = readConfigs();
    const exportData = {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      configs: configs.map(withoutSecrets),
    };
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to export configs:', err);
    return false;
  }
}

export async function importConfigs(filePath: string): Promise<ImportResult> {
  await ensureNanoid();
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    const imported = Array.isArray(parsed) ? parsed : parsed?.configs;

    if (!Array.isArray(imported)) {
      result.errors.push('Invalid file format: expected configs array');
      return result;
    }

    const existing = readConfigs();
    const existingNames = new Set(existing.map(c => c.name));

    for (const item of imported) {
      const candidate = normalizeConfig(
        {
          ...item,
          id: nanoid(12),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sortOrder: existing.length + result.imported,
        },
        existing.length + result.imported
      );
      if (!candidate || !hasRequiredFields(candidate)) {
        result.errors.push('Skipped invalid config (missing name or provider model)');
        result.skipped++;
        continue;
      }

      const rawCustom = (item && typeof item === 'object' && (item as any).customEnvVars && typeof (item as any).customEnvVars === 'object')
        ? (item as any).customEnvVars as Record<string, unknown>
        : {};
      const rawCustomCount = Object.keys(rawCustom).length;
      const normalizedCustomCount = Object.keys(candidate.customEnvVars).length;
      if (normalizedCustomCount < rawCustomCount) {
        result.errors.push(`Config "${candidate.name}" contained invalid environment variable names; those entries were skipped.`);
      }

      let name = candidate.name;
      if (existingNames.has(name)) {
        let counter = 2;
        while (existingNames.has(`${candidate.name} (${counter})`)) {
          counter++;
        }
        name = `${candidate.name} (${counter})`;
      }
      candidate.name = name;

      existing.push(candidate);
      existingNames.add(name);
      result.imported++;
    }

    writeConfigFile(existing);
  } catch (err) {
    result.errors.push(`Failed to import: ${(err as Error).message}`);
  }

  return result;
}

export function getSettings(): { sidebarWidth: number; groups: any[] } {
  const settingsPath = getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { sidebarWidth: DEFAULTS.SIDEBAR_WIDTH, groups: [], ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to read settings:', err);
  }
  return { sidebarWidth: DEFAULTS.SIDEBAR_WIDTH, groups: [] };
}

export function saveSettings(settings: Record<string, any>): void {
  const settingsPath = getSettingsPath();
  const current = getSettings();
  const merged = { ...current, ...settings };
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
}
