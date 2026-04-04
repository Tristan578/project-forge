import 'server-only';
import { execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import type { BridgeToolConfig, BridgeToolStatus, BridgesConfig, PlatformPaths } from './types';
import { BRIDGE_CACHE_TTL_MS } from '@/lib/config/timeouts';

const CONFIG_DIR = join(/* turbopackIgnore: true */ homedir(), '.spawnforge');
const CONFIG_FILE = join(CONFIG_DIR, 'bridges.json');

/** Allowlist of known tool IDs — rejects arbitrary toolId values. */
const ALLOWED_TOOL_IDS = new Set(['aseprite', 'fmod', 'reaper']);

/** Validate that a path is a safe absolute path (no traversal, no special chars). */
function isSafePath(p: string): boolean {
  // Must be absolute, no null bytes, no path traversal
  if (!p || p.includes('\0') || p.includes('..')) return false;
  // Must start with / (Unix) or drive letter (Windows)
  return p.startsWith('/') || /^[A-Za-z]:\\/.test(p);
}

/** Default installation paths per platform for known tools. */
const TOOL_DEFAULTS: Record<string, { name: string; paths: PlatformPaths }> = {
  aseprite: {
    name: 'Aseprite',
    paths: {
      darwin: '/Applications/Aseprite.app/Contents/MacOS/aseprite',
      win32: 'C:\\Program Files\\Aseprite\\aseprite.exe',
      linux: '/usr/bin/aseprite',
    },
  },
  fmod: {
    name: 'FMOD Studio',
    paths: {
      darwin: '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio',
      win32: 'C:\\Program Files (x86)\\FMOD SoundSystem\\FMOD Studio\\fmodstudio.exe',
      linux: '/opt/fmodstudio/fmodstudio',
    },
  },
  reaper: {
    name: 'REAPER',
    paths: {
      darwin: '/Applications/REAPER.app/Contents/MacOS/REAPER',
      win32: 'C:\\Program Files\\REAPER (x64)\\reaper.exe',
      linux: '/opt/REAPER/reaper',
    },
  },
};

/** Additional search paths per platform (checked if default is missing). */
const EXTRA_SEARCH_PATHS: Record<string, Record<string, string[]>> = {
  aseprite: {
    win32: ['C:\\Program Files (x86)\\Aseprite\\aseprite.exe'],
    linux: ['/usr/local/bin/aseprite', join(homedir(), '.local/bin/aseprite')],
  },
  fmod: {
    win32: [
      'C:\\Program Files\\FMOD SoundSystem\\FMOD Studio\\fmodstudio.exe',
      'C:\\Program Files (x86)\\FMOD Studio\\fmodstudio.exe',
    ],
    linux: [
      '/usr/bin/fmodstudio',
      '/usr/local/bin/fmodstudio',
    ],
  },
  reaper: {
    win32: [
      'C:\\Program Files (x86)\\REAPER\\reaper.exe',
      'C:\\Program Files\\REAPER\\reaper.exe',
    ],
    linux: ['/usr/bin/reaper', '/usr/local/bin/reaper'],
  },
};

/** Validate that a toolId is in the allowlist. */
export function isAllowedToolId(toolId: string): boolean {
  return ALLOWED_TOOL_IDS.has(toolId);
}

/** Get default paths for a known tool. */
export function getDefaultPaths(toolId: string): PlatformPaths {
  return TOOL_DEFAULTS[toolId]?.paths ?? {};
}

/** Load persistent bridge config from ~/.spawnforge/bridges.json. */
export function loadBridgesConfig(): BridgesConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as BridgesConfig;
  } catch {
    return {};
  }
}

/** Save bridge config to ~/.spawnforge/bridges.json. */
export function saveBridgesConfig(config: BridgesConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/** Parse Aseprite version from --version output (e.g., "Aseprite 1.3.17-arm64" -> "1.3.17"). */
function parseVersion(stdout: string): string | null {
  const match = stdout.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Find a working binary path for a tool on the current platform.
 * Only searches known default paths and extra search paths — no user-supplied paths.
 */
function findBinaryPath(toolId: string): string | null {
  if (!isAllowedToolId(toolId)) return null;

  const plat = platform() as 'darwin' | 'win32' | 'linux';
  const defaults = TOOL_DEFAULTS[toolId]?.paths ?? {};

  // 1. Default path for current platform
  const defaultPath = defaults[plat];
  if (defaultPath && existsSync(defaultPath)) return defaultPath;

  // 2. Extra search paths (hardcoded, not user-supplied)
  const extras = EXTRA_SEARCH_PATHS[toolId]?.[plat] ?? [];
  for (const p of extras) {
    if (existsSync(p)) return p;
  }

  // 3. Check saved config (only platform paths, not custom)
  const saved = loadBridgesConfig()[toolId];
  const savedPlatPath = saved?.paths?.[plat];
  if (savedPlatPath && isSafePath(savedPlatPath) && existsSync(savedPlatPath)) return savedPlatPath;

  return null;
}

/** Run --version on a binary and return its version string. */
function getVersion(binaryPath: string): Promise<{ version: string | null; error?: string }> {
  if (!isSafePath(binaryPath)) {
    return Promise.resolve({ version: null, error: 'Invalid binary path' });
  }
  return new Promise((resolve) => {
    execFile(binaryPath, ['--version'], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ version: null, error: stderr || err.message });
        return;
      }
      resolve({ version: parseVersion(stdout) });
    });
  });
}

// Cache discovery results to avoid spawning child processes on every API call.
// TTL: 60 seconds — stale discovery is acceptable for a local tool check.
const discoveryCache = new Map<string, { result: BridgeToolConfig; expires: number }>();
const CACHE_TTL_MS = BRIDGE_CACHE_TTL_MS;
const ERROR_CACHE_TTL_MS = 5 * 60_000; // 5-minute TTL for negative results (PF-509) — intentionally 5x BRIDGE_CACHE_TTL_MS

/** Discover a bridge tool: find binary, check version, return config. */
export async function discoverTool(toolId: string): Promise<BridgeToolConfig> {
  const cached = discoveryCache.get(toolId);
  if (cached && Date.now() < cached.expires) return cached.result;
  if (!isAllowedToolId(toolId)) {
    const notFoundResult: BridgeToolConfig = {
      id: toolId,
      name: toolId,
      paths: {},
      activeVersion: null,
      status: 'not_found',
    };
    discoveryCache.set(toolId, { result: notFoundResult, expires: Date.now() + ERROR_CACHE_TTL_MS });
    return notFoundResult;
  }

  const defaults = TOOL_DEFAULTS[toolId];
  const name = defaults?.name ?? toolId;

  const binaryPath = findBinaryPath(toolId);
  if (!binaryPath) {
    const notFoundResult: BridgeToolConfig = {
      id: toolId,
      name,
      paths: defaults?.paths ?? {},
      activeVersion: null,
      status: 'not_found',
    };
    discoveryCache.set(toolId, { result: notFoundResult, expires: Date.now() + ERROR_CACHE_TTL_MS });
    return notFoundResult;
  }

  const { version, error } = await getVersion(binaryPath);
  if (error || !version) {
    const errorResult: BridgeToolConfig = {
      id: toolId,
      name,
      paths: defaults?.paths ?? {},
      activeVersion: null,
      status: 'error',
    };
    discoveryCache.set(toolId, { result: errorResult, expires: Date.now() + ERROR_CACHE_TTL_MS });
    return errorResult;
  }

  // Save discovered config
  const config = loadBridgesConfig();
  const plat = platform() as 'darwin' | 'win32' | 'linux';
  config[toolId] = {
    paths: { ...defaults?.paths, [plat]: binaryPath },
    activeVersion: version,
  };
  saveBridgesConfig(config);

  const result: BridgeToolConfig = {
    id: toolId,
    name,
    paths: { ...defaults?.paths, [plat]: binaryPath },
    activeVersion: version,
    status: 'connected',
  };
  discoveryCache.set(toolId, { result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Health check: verify a binary is accessible and returns a version. */
export async function healthCheck(binaryPath: string): Promise<BridgeToolStatus> {
  if (!isSafePath(binaryPath) || !existsSync(binaryPath)) return 'not_found';
  const { version, error } = await getVersion(binaryPath);
  if (error || !version) return 'error';
  return 'connected';
}
