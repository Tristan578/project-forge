import 'server-only';
import { execFile } from 'child_process';
import { platform } from 'os';
import type { BridgeResult } from './types';

export const REAPER_TOOL_ID = 'reaper';

/** Binary names to search for on PATH when no absolute path is found. */
export const REAPER_BINARY_NAMES = ['reaper', 'REAPER', 'reaper.exe'] as const;

/** Supported operations for the Reaper bridge. */
export const REAPER_OPERATIONS = ['openInReaper', 'batchExport', 'normalize'] as const;
export type ReaperOperation = (typeof REAPER_OPERATIONS)[number];

/** Export formats supported by Reaper's batch render. */
export type ExportFormat = 'wav' | 'mp3' | 'ogg';

/** Validate that a path is a safe absolute path (no traversal, no null bytes). */
function isSafePath(p: string): boolean {
  if (!p || p.includes('\0') || p.includes('..')) return false;
  return p.startsWith('/') || /^[A-Za-z]:\\/.test(p);
}

/** Default installation paths per platform for REAPER. */
export const REAPER_DEFAULT_PATHS: Record<string, string> = {
  darwin: '/Applications/REAPER.app/Contents/MacOS/REAPER',
  win32: 'C:\\Program Files\\REAPER (x64)\\reaper.exe',
  linux: '/opt/REAPER/reaper',
};

/** Extra search paths per platform checked after the default. */
export const REAPER_EXTRA_PATHS: Record<string, string[]> = {
  win32: [
    'C:\\Program Files (x86)\\REAPER\\reaper.exe',
    'C:\\Program Files\\REAPER\\reaper.exe',
  ],
  linux: [
    '/usr/bin/reaper',
    '/usr/local/bin/reaper',
  ],
};

/** Build the CLI argument array for openInReaper. */
export function buildOpenCommand(filePath: string): string[] {
  if (!isSafePath(filePath)) {
    throw new Error('Invalid file path');
  }
  // REAPER accepts a file path as a positional argument to open it
  return [filePath];
}

/** Build the CLI argument array for batchExport. */
export function buildBatchExportCommand(
  projectPath: string,
  outputDir: string,
  format: ExportFormat
): string[] {
  if (!isSafePath(projectPath)) {
    throw new Error('Invalid project path');
  }
  if (!isSafePath(outputDir)) {
    throw new Error('Invalid output directory path');
  }
  const allowedFormats: ExportFormat[] = ['wav', 'mp3', 'ogg'];
  if (!allowedFormats.includes(format)) {
    throw new Error(`Invalid format: "${format}". Allowed: wav, mp3, ogg`);
  }
  // REAPER CLI: -batchconvert <project> with output and format flags
  return ['-batchconvert', projectPath, '-outputdir', outputDir, '-format', format];
}

/** Build the CLI argument array for normalize (via ReaScript). */
export function buildNormalizeCommand(filePath: string, scriptPath?: string): string[] {
  if (!isSafePath(filePath)) {
    throw new Error('Invalid file path');
  }
  if (scriptPath !== undefined) {
    if (!isSafePath(scriptPath)) {
      throw new Error('Invalid script path');
    }
    return ['-newinst', '-nolicense', filePath, '-reascript', scriptPath];
  }
  // Run a ReaScript action via -newinst and -runscript flags
  // Uses the built-in REAPER action for normalization (action 40108 = Item properties: Normalize items)
  return ['-newinst', '-nolicense', filePath, '-reascript', 'normalize'];
}

/** Spawn REAPER with the given arguments and return a BridgeResult. */
function runReaper(binaryPath: string, args: string[]): Promise<BridgeResult> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      args,
      { timeout: 60_000 },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException & { code?: number }).code;
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
 * Open an audio file in REAPER via the CLI.
 *
 * @param binaryPath - Absolute path to the REAPER executable.
 * @param filePath   - Absolute path to the audio file to open.
 */
export async function openInReaper(binaryPath: string, filePath: string): Promise<BridgeResult> {
  if (!isSafePath(binaryPath)) {
    return { success: false, error: 'Invalid binary path', exitCode: 1 };
  }
  let args: string[];
  try {
    args = buildOpenCommand(filePath);
  } catch (err) {
    return { success: false, error: (err as Error).message, exitCode: 1 };
  }
  return runReaper(binaryPath, args);
}

/**
 * Run a batch export in REAPER via the CLI.
 *
 * @param binaryPath  - Absolute path to the REAPER executable.
 * @param projectPath - Absolute path to the .rpp project file.
 * @param outputDir   - Absolute path to the output directory.
 * @param format      - Target export format: 'wav' | 'mp3' | 'ogg'.
 */
export async function batchExport(
  binaryPath: string,
  projectPath: string,
  outputDir: string,
  format: ExportFormat
): Promise<BridgeResult> {
  if (!isSafePath(binaryPath)) {
    return { success: false, error: 'Invalid binary path', exitCode: 1 };
  }
  let args: string[];
  try {
    args = buildBatchExportCommand(projectPath, outputDir, format);
  } catch (err) {
    return { success: false, error: (err as Error).message, exitCode: 1 };
  }
  return runReaper(binaryPath, args);
}

/**
 * Apply normalization to an audio file via REAPER ReaScript.
 *
 * @param binaryPath - Absolute path to the REAPER executable.
 * @param filePath   - Absolute path to the audio file to normalize.
 * @param scriptPath - Optional absolute path to a custom ReaScript for normalization.
 */
export async function normalize(binaryPath: string, filePath: string, scriptPath?: string): Promise<BridgeResult> {
  if (!isSafePath(binaryPath)) {
    return { success: false, error: 'Invalid binary path', exitCode: 1 };
  }
  let args: string[];
  try {
    args = buildNormalizeCommand(filePath, scriptPath);
  } catch (err) {
    return { success: false, error: (err as Error).message, exitCode: 1 };
  }
  return runReaper(binaryPath, args);
}

/** Get the default binary path for REAPER on the current platform. */
export function getDefaultBinaryPath(): string | null {
  const plat = currentPlatform();
  return REAPER_DEFAULT_PATHS[plat] ?? null;
}
