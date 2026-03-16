import 'server-only';
import { execFile } from 'child_process';
import { platform } from 'os';
import type { BridgeResult } from './types';

export const FMOD_TOOL_ID = 'fmod';

/** Binary names to search for on PATH when no absolute path is found. */
export const FMOD_BINARY_NAMES = ['fmodstudio', 'FMOD Studio', 'FMODStudio.exe'] as const;

/** Supported operations for the FMOD Studio bridge. */
export const FMOD_OPERATIONS = ['openProject', 'buildBanks', 'exportMetadata'] as const;
export type FmodOperation = (typeof FMOD_OPERATIONS)[number];

/** Validate that a path is a safe absolute path (no traversal, no null bytes). */
export function isSafePath(p: string): boolean {
  if (!p || p.includes('\0')) return false;
  if (p.split(/[/\\]/).includes('..')) return false;
  return p.startsWith('/') || /^[A-Za-z]:\\/.test(p);
}

/** Default installation paths per platform for FMOD Studio. */
export const FMOD_DEFAULT_PATHS: Record<string, string> = {
  darwin: '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio',
  win32: 'C:\\Program Files (x86)\\FMOD SoundSystem\\FMOD Studio\\fmodstudio.exe',
  linux: '/opt/fmodstudio/fmodstudio',
};

/** Extra search paths per platform checked after the default. */
export const FMOD_EXTRA_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\FMOD SoundSystem\\FMOD Studio\\fmodstudio.exe',
    'C:\\Program Files (x86)\\FMOD Studio\\fmodstudio.exe',
  ],
  linux: [
    '/usr/bin/fmodstudio',
    '/usr/local/bin/fmodstudio',
  ],
};

/** Build the CLI argument array for openProject. */
export function buildOpenProjectCommand(projectPath: string): string[] {
  if (!isSafePath(projectPath)) {
    throw new Error('Invalid project path');
  }
  // FMOD Studio accepts a .fspro file path as a positional argument to open it
  return [projectPath];
}

/** Build the CLI argument array for buildBanks. */
export function buildBuildBanksCommand(
  projectPath: string,
  outputDir: string,
  platform_?: string
): string[] {
  if (!isSafePath(projectPath)) {
    throw new Error('Invalid project path');
  }
  if (!isSafePath(outputDir)) {
    throw new Error('Invalid output directory path');
  }
  // FMOD Studio CLI: -build flag for bank building with output and optional platform target
  const args = ['-build', projectPath, '-outputdir', outputDir];
  if (platform_ !== undefined) {
    // Validate platform is an alphanumeric identifier — no shell metacharacters
    if (!/^[A-Za-z0-9_]+$/.test(platform_)) {
      throw new Error(`Invalid platform identifier: "${platform_}"`);
    }
    args.push('-platform', platform_);
  }
  return args;
}

/** Build the CLI argument array for exportMetadata. */
export function buildExportMetadataCommand(projectPath: string): string[] {
  if (!isSafePath(projectPath)) {
    throw new Error('Invalid project path');
  }
  // FMOD Studio CLI: -exportmetadata flag exports event/bus/snapshot metadata as JSON
  return ['-exportmetadata', projectPath];
}

/** Spawn FMOD Studio with the given arguments and return a BridgeResult. */
function runFmod(binaryPath: string, args: string[]): Promise<BridgeResult> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      args,
      { timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          const code = err.code;
          const exitCode = typeof code === 'number' ? code : 1;
          resolve({
            success: false,
            error: stderr || err.message,
            stdout,
            stderr,
            exitCode,
          });
          return;
        }
        resolve({
          success: true,
          stdout,
          stderr,
          exitCode: 0,
        });
      }
    );
  });
}

/** Detect current platform label for path lookups. */
function currentPlatform(): string {
  return platform();
}

/**
 * Open an FMOD Studio project via the CLI.
 *
 * @param binaryPath  - Absolute path to the FMOD Studio executable.
 * @param projectPath - Absolute path to the .fspro project file.
 */
export async function openProject(binaryPath: string, projectPath: string): Promise<BridgeResult> {
  if (!isSafePath(binaryPath)) {
    return { success: false, error: 'Invalid binary path', exitCode: 1 };
  }
  let args: string[];
  try {
    args = buildOpenProjectCommand(projectPath);
  } catch (err) {
    return { success: false, error: (err as Error).message, exitCode: 1 };
  }
  return runFmod(binaryPath, args);
}

/**
 * Build FMOD Studio banks via the CLI.
 *
 * @param binaryPath  - Absolute path to the FMOD Studio executable.
 * @param projectPath - Absolute path to the .fspro project file.
 * @param outputDir   - Absolute path to the output directory for built banks.
 * @param platform_   - Optional platform target identifier (e.g. "Desktop", "Mobile", "PS5").
 */
export async function buildBanks(
  binaryPath: string,
  projectPath: string,
  outputDir: string,
  platform_?: string
): Promise<BridgeResult> {
  if (!isSafePath(binaryPath)) {
    return { success: false, error: 'Invalid binary path', exitCode: 1 };
  }
  let args: string[];
  try {
    args = buildBuildBanksCommand(projectPath, outputDir, platform_);
  } catch (err) {
    return { success: false, error: (err as Error).message, exitCode: 1 };
  }
  return runFmod(binaryPath, args);
}

/**
 * Export event/bus metadata from an FMOD Studio project as JSON.
 *
 * @param binaryPath  - Absolute path to the FMOD Studio executable.
 * @param projectPath - Absolute path to the .fspro project file.
 */
export async function exportMetadata(
  binaryPath: string,
  projectPath: string
): Promise<BridgeResult> {
  if (!isSafePath(binaryPath)) {
    return { success: false, error: 'Invalid binary path', exitCode: 1 };
  }
  let args: string[];
  try {
    args = buildExportMetadataCommand(projectPath);
  } catch (err) {
    return { success: false, error: (err as Error).message, exitCode: 1 };
  }
  return runFmod(binaryPath, args);
}

/** Get the default binary path for FMOD Studio on the current platform. */
export function getDefaultBinaryPath(): string | null {
  const plat = currentPlatform();
  return FMOD_DEFAULT_PATHS[plat] ?? null;
}
