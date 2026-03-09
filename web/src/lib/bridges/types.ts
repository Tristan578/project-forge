/** Status of a bridge tool connection. */
export type BridgeToolStatus = 'connected' | 'disconnected' | 'not_found' | 'error';

/** Per-platform executable paths. */
export interface PlatformPaths {
  darwin?: string;
  win32?: string;
  linux?: string;
}

/** Configuration for a single bridge tool. */
export interface BridgeToolConfig {
  id: string;
  name: string;
  paths: PlatformPaths;
  activeVersion: string | null;
  status: BridgeToolStatus;
}

/** An operation to execute on a bridge tool. */
export interface BridgeOperation {
  name: string;
  params: Record<string, unknown>;
}

/** Result of a bridge operation. */
export interface BridgeResult {
  success: boolean;
  outputFiles?: string[];
  metadata?: Record<string, unknown>;
  error?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

/** Persistent bridge config stored at ~/.spawnforge/bridges.json. */
export interface BridgesConfig {
  [toolId: string]: {
    paths: PlatformPaths;
    activeVersion: string | null;
  };
}
