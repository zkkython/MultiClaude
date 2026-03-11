import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { ModelConfig, ModelConfigCreate, ModelConfigUpdate, ImportResult } from '../shared/types.js';
import { DEFAULTS } from '../shared/constants.js';

// Dynamic import for nanoid (ESM-only)
let nanoid: (size?: number) => string;

async function ensureNanoid() {
  if (!nanoid) {
    const mod = await import('nanoid');
    nanoid = mod.nanoid;
  }
}

function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'configs.json');
}

function getSettingsPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'settings.json');
}

function readConfigs(): ModelConfig[] {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to read configs:', err);
  }
  return [];
}

function writeConfigs(configs: ModelConfig[]): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), { mode: 0o600 });
}

export function getAllConfigs(): ModelConfig[] {
  return readConfigs();
}

export async function createConfig(data: ModelConfigCreate): Promise<ModelConfig> {
  await ensureNanoid();
  const configs = readConfigs();
  const now = new Date().toISOString();
  const config: ModelConfig = {
    ...data,
    id: nanoid(12),
    createdAt: now,
    updatedAt: now,
    sortOrder: data.sortOrder ?? configs.length,
  };
  configs.push(config);
  writeConfigs(configs);
  return config;
}

export function updateConfig(data: ModelConfigUpdate): ModelConfig {
  const configs = readConfigs();
  const index = configs.findIndex(c => c.id === data.id);
  if (index === -1) {
    throw new Error(`Config not found: ${data.id}`);
  }
  const updated: ModelConfig = {
    ...configs[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  configs[index] = updated;
  writeConfigs(configs);
  return updated;
}

export function deleteConfig(id: string): void {
  const configs = readConfigs();
  const filtered = configs.filter(c => c.id !== id);
  if (filtered.length === configs.length) {
    throw new Error(`Config not found: ${id}`);
  }
  writeConfigs(filtered);
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
  writeConfigs(configs);
  return duplicate;
}

export function getConfigById(id: string): ModelConfig | undefined {
  const configs = readConfigs();
  return configs.find(c => c.id === id);
}

export async function exportConfigs(filePath: string): Promise<boolean> {
  try {
    const configs = readConfigs();
    // Strip internal fields for export
    const exportData = configs.map(({ id, createdAt, updatedAt, ...rest }) => rest);
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
    const imported = JSON.parse(data);

    if (!Array.isArray(imported)) {
      result.errors.push('Invalid file format: expected an array of configs');
      return result;
    }

    const existing = readConfigs();
    const existingNames = new Set(existing.map(c => c.name));

    for (const item of imported) {
      if (!item.name || !item.anthropicModel) {
        result.errors.push(`Skipped invalid config (missing name or model)`);
        result.skipped++;
        continue;
      }

      const now = new Date().toISOString();
      let name = item.name;

      // If name already exists, append a number
      if (existingNames.has(name)) {
        let counter = 2;
        while (existingNames.has(`${item.name} (${counter})`)) {
          counter++;
        }
        name = `${item.name} (${counter})`;
      }

      const config: ModelConfig = {
        id: nanoid(12),
        name,
        color: item.color || '#4A90D9',
        anthropicBaseUrl: item.anthropicBaseUrl || '',
        anthropicAuthToken: item.anthropicAuthToken || '',
        apiTimeoutMs: item.apiTimeoutMs ?? DEFAULTS.API_TIMEOUT_MS,
        anthropicModel: item.anthropicModel,
        anthropicSmallFastModel: item.anthropicSmallFastModel || '',
        disableNonessentialTraffic: item.disableNonessentialTraffic ?? false,
        customEnvVars: item.customEnvVars || {},
        createdAt: now,
        updatedAt: now,
        sortOrder: existing.length + result.imported,
      };

      existing.push(config);
      existingNames.add(name);
      result.imported++;
    }

    writeConfigs(existing);
  } catch (err) {
    result.errors.push(`Failed to import: ${(err as Error).message}`);
  }

  return result;
}

// Settings management
export function getSettings(): { sidebarWidth: number } {
  const settingsPath = getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return { sidebarWidth: DEFAULTS.SIDEBAR_WIDTH, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to read settings:', err);
  }
  return { sidebarWidth: DEFAULTS.SIDEBAR_WIDTH };
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
