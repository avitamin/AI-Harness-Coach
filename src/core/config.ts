import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CODEX_ROOTS = [
  '~/.codex/sessions',
  '~/.codex/archived_sessions',
  '~/.codex/archived-sessions'
];

export interface LoadConfigOptions {
  configPath?: string;
  cacheDir?: string;
  roots?: string[];
}

export interface AppConfig {
  configPath: string;
  cacheDir: string;
  roots: string[];
}

interface FileConfig {
  additionalRoots?: string[];
  cacheDir?: string;
}

export function expandHome(input: string): string;
export function expandHome(input: undefined): undefined;
export function expandHome(input: string | undefined): string | undefined {
  if (!input || typeof input !== 'string') {
    return input;
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function defaultConfigPath(): string {
  return process.env.AHC_CONFIG
    ? expandHome(process.env.AHC_CONFIG)
    : path.join(os.homedir(), '.ai-harness-coach', 'config.json');
}

export function defaultCacheDir(): string {
  return process.env.AHC_CACHE_DIR
    ? expandHome(process.env.AHC_CACHE_DIR)
    : path.join(os.homedir(), '.cache', 'ai-harness-coach');
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
  const configPath = options.configPath ? expandHome(options.configPath) : defaultConfigPath();
  let fileConfig: FileConfig = {};

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    fileConfig = JSON.parse(raw) as FileConfig;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read config ${configPath}: ${message}`);
    }
  }

  const additionalRoots = Array.isArray(fileConfig.additionalRoots)
    ? fileConfig.additionalRoots
    : [];
  const configuredRoots = Array.isArray(options.roots)
    ? options.roots
    : [...DEFAULT_CODEX_ROOTS, ...additionalRoots];

  return {
    configPath,
    cacheDir: path.resolve(expandHome(options.cacheDir ?? fileConfig.cacheDir ?? defaultCacheDir())),
    roots: configuredRoots.map((root) => path.resolve(expandHome(root)))
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
