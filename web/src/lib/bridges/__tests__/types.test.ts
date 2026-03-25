import { describe, it, expect } from 'vitest';
import type {
  BridgeToolConfig,
  BridgeToolStatus,
  BridgeOperation,
  BridgeResult,
  PlatformPaths,
} from '../types';

describe('Bridge types', () => {
  it('BridgeToolConfig has required fields', () => {
    const config: BridgeToolConfig = {
      id: 'aseprite',
      name: 'Aseprite',
      paths: { darwin: '/Applications/Aseprite.app/Contents/MacOS/aseprite' },
      activeVersion: '1.3.17',
      status: 'connected',
    };
    expect(config.id).toBe('aseprite');
    expect(config.status).toBe('connected');
  });

  it('BridgeResult represents success', () => {
    const result: BridgeResult = {
      success: true,
      outputFiles: ['/tmp/out.png'],
      metadata: { width: 32, height: 32 },
    };
    expect(result.success).toBe(true);
    expect(result.outputFiles).toHaveLength(1);
  });

  it('BridgeResult represents failure', () => {
    const result: BridgeResult = {
      success: false,
      error: 'Aseprite not found',
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe('Aseprite not found');
  });

  it('BridgeOperation defines operation shape', () => {
    const op: BridgeOperation = {
      name: 'createSprite',
      params: { width: 32, height: 32 },
    };
    expect(op.name).toBe('createSprite');
  });

  it('PlatformPaths supports all platforms', () => {
    const paths: PlatformPaths = {
      darwin: '/Applications/Aseprite.app/Contents/MacOS/aseprite',
      win32: 'C:\\Program Files\\Aseprite\\aseprite.exe',
      linux: '/usr/bin/aseprite',
    };
    expect(paths.darwin).not.toBeUndefined();
    expect(paths.win32).not.toBeUndefined();
    expect(paths.linux).not.toBeUndefined();
  });

  it('BridgeToolStatus covers expected values', () => {
    const statuses: BridgeToolStatus[] = ['connected', 'disconnected', 'not_found', 'error'];
    expect(statuses).toHaveLength(4);
  });
});
