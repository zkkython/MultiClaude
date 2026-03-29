import * as path from 'path';
import type { ModelConfig } from '../shared/types.js';
import { sanitizePathSegment } from './path-utils.js';

let userDataPathResolver: () => string = () => {
  const electronMod = require('electron') as typeof import('electron');
  return electronMod.app.getPath('userData');
};

export function __setUserDataPathResolverForTest(resolver: (() => string) | null): void {
  userDataPathResolver = resolver || (() => {
    const electronMod = require('electron') as typeof import('electron');
    return electronMod.app.getPath('userData');
  });
}

export function getEnvFilesDir(): string {
  return path.join(userDataPathResolver(), 'env-files');
}

export function getEnvFilePath(configId: string): string {
  return path.join(getEnvFilesDir(), `${configId}.sh`);
}

export function getZdotdirPath(configId: string): string {
  return path.join(getEnvFilesDir(), `zdotdir-${configId}`);
}

export function getCodexHomesDir(): string {
  return path.join(userDataPathResolver(), 'codex-homes');
}

export function getCodexHomePath(config: Pick<ModelConfig, 'id' | 'codexHomeName'>): string {
  const baseName = config.codexHomeName || config.id;
  return path.join(getCodexHomesDir(), sanitizePathSegment(baseName));
}
