import { app } from 'electron';
import * as path from 'path';
import type { ModelConfig } from '../shared/types.js';

export function getEnvFilesDir(): string {
  return path.join(app.getPath('userData'), 'env-files');
}

export function getEnvFilePath(configId: string): string {
  return path.join(getEnvFilesDir(), `${configId}.sh`);
}

export function getZdotdirPath(configId: string): string {
  return path.join(getEnvFilesDir(), `zdotdir-${configId}`);
}

export function getCodexHomesDir(): string {
  return path.join(app.getPath('userData'), 'codex-homes');
}

export function getCodexHomePath(config: Pick<ModelConfig, 'id' | 'codexHomeName'>): string {
  const baseName = config.codexHomeName || config.id;
  return path.join(getCodexHomesDir(), sanitizePathSegment(baseName));
}

export function sanitizePathSegment(input: string): string {
  const trimmed = input.trim();
  const normalized = trimmed
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'profile';
}
