import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { BridgeOperation, BridgeResult } from './types';
import { buildScript } from './luaTemplates';

const TEMP_DIR = join(tmpdir(), 'spawnforge-bridge');

/** Parse Aseprite stdout/stderr into a structured result. */
export function parseOutput(stdout: string, stderr: string, exitCode: number): BridgeResult {
  if (exitCode !== 0) {
    return {
      success: false,
      error: stderr || `Aseprite exited with code ${exitCode}`,
      stdout,
      stderr,
      exitCode,
    };
  }

  if (stdout.startsWith('ERROR:')) {
    return {
      success: false,
      error: stdout.slice(6).trim(),
      stdout,
      stderr,
      exitCode,
    };
  }

  return {
    success: true,
    stdout,
    stderr,
    exitCode,
  };
}

/** Execute a bridge operation against Aseprite. Uses execFile (not exec) to prevent shell injection. */
export async function executeOperation(
  binaryPath: string,
  operation: BridgeOperation
): Promise<BridgeResult> {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const scriptContent = buildScript(
    operation.name,
    operation.params as Record<string, string>
  );

  const scriptPath = join(TEMP_DIR, `${operation.name}-${randomUUID()}.lua`);
  writeFileSync(scriptPath, scriptContent, 'utf-8');

  try {
    return await runAseprite(binaryPath, scriptPath);
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore cleanup errors */ }
  }
}

/** Spawn Aseprite in batch mode with a Lua script. */
function runAseprite(binaryPath: string, scriptPath: string): Promise<BridgeResult> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['--batch', '--script', scriptPath],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          const exitCode = (err as NodeJS.ErrnoException & { code?: number }).code ?? 1;
          resolve(parseOutput(stdout, stderr || err.message, typeof exitCode === 'number' ? exitCode : 1));
          return;
        }
        resolve(parseOutput(stdout, stderr, 0));
      }
    );
  });
}
