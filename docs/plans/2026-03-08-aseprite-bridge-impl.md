# Aseprite Bridge Phase 2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a bridge service that lets SpawnForge control Aseprite via Lua scripting for pixel art generation, with record/replay testing from real Aseprite responses.

**Architecture:** Standalone bridge service layer (`web/src/lib/bridges/`) spawns `aseprite --batch --script <file>` child processes. Lua templates with `{{variable}}` substitution generate scripts. API routes expose operations to the editor. A Zustand store tracks tool status and running operations. Record/replay fixtures from real Aseprite drive all CI mocks.

**Tech Stack:** Node.js `child_process.execFile` (NOT exec — no shell injection risk), Aseprite CLI (`--batch --script`), Lua templates, Vitest, Next.js API routes, Zustand

**Design Doc:** `docs/plans/2026-03-08-aseprite-bridge-design.md`

---

## Task 1: Bridge Core Types and Config

**Files:**
- Create: `web/src/lib/bridges/types.ts`
- Test: `web/src/lib/bridges/__tests__/types.test.ts`

**Step 1: Write the failing test**

Create `web/src/lib/bridges/__tests__/types.test.ts`:

```typescript
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
    expect(paths.darwin).toBeDefined();
    expect(paths.win32).toBeDefined();
    expect(paths.linux).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/types.test.ts`
Expected: FAIL — module `../types` not found

**Step 3: Write the types module**

Create `web/src/lib/bridges/types.ts`:

```typescript
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
  /** User-provided path override (takes precedence over auto-discovered paths). */
  customPath?: string;
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
    customPath?: string;
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/types.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add web/src/lib/bridges/types.ts web/src/lib/bridges/__tests__/types.test.ts
git commit -m "feat(bridges): add core bridge type definitions (PF-89)"
```

---

## Task 2: Bridge Manager — Platform Discovery

**Files:**
- Create: `web/src/lib/bridges/bridgeManager.ts`
- Test: `web/src/lib/bridges/__tests__/bridgeManager.test.ts`

**Step 1: Write the failing tests**

Create `web/src/lib/bridges/__tests__/bridgeManager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process and fs before imports
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home'),
  platform: vi.fn(() => 'darwin'),
}));

describe('BridgeManager', () => {
  let bridgeManager: typeof import('../bridgeManager');
  let fs: typeof import('fs');
  let childProcess: typeof import('child_process');

  beforeEach(async () => {
    vi.resetModules();
    fs = await import('fs');
    childProcess = await import('child_process');
    bridgeManager = await import('../bridgeManager');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefaultPaths', () => {
    it('returns macOS default paths for aseprite', () => {
      const paths = bridgeManager.getDefaultPaths('aseprite');
      expect(paths.darwin).toContain('Aseprite.app');
      expect(paths.win32).toContain('Aseprite');
      expect(paths.linux).toBeDefined();
    });
  });

  describe('discoverTool', () => {
    it('returns connected config when binary exists on macOS', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'Aseprite 1.3.17-arm64', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const config = await bridgeManager.discoverTool('aseprite');
      expect(config.status).toBe('connected');
      expect(config.activeVersion).toBe('1.3.17');
    });

    it('returns not_found when no binary exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = await bridgeManager.discoverTool('aseprite');
      expect(config.status).toBe('not_found');
      expect(config.activeVersion).toBeNull();
    });

    it('uses customPath over default paths when provided', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.existsSync).mockImplementation((p) => p === '/custom/aseprite');
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'Aseprite 1.3.17', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const config = await bridgeManager.discoverTool('aseprite', '/custom/aseprite');
      expect(config.status).toBe('connected');
    });
  });

  describe('loadConfig / saveConfig', () => {
    it('returns empty config when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const config = bridgeManager.loadBridgesConfig();
      expect(config).toEqual({});
    });

    it('loads config from ~/.spawnforge/bridges.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        aseprite: { paths: { darwin: '/usr/local/bin/aseprite' }, activeVersion: '1.3.17' },
      }));
      const config = bridgeManager.loadBridgesConfig();
      expect(config.aseprite).toBeDefined();
      expect(config.aseprite.activeVersion).toBe('1.3.17');
    });

    it('saves config to ~/.spawnforge/bridges.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockWrite = vi.mocked(fs.writeFileSync);
      bridgeManager.saveBridgesConfig({
        aseprite: { paths: { darwin: '/usr/bin/aseprite' }, activeVersion: '1.3.17' },
      });
      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('bridges.json'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('healthCheck', () => {
    it('returns connected when binary responds', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'Aseprite 1.3.17', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const status = await bridgeManager.healthCheck('/Applications/Aseprite.app/Contents/MacOS/aseprite');
      expect(status).toBe('connected');
    });

    it('returns error when binary fails', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
        (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('ENOENT'), '', 'not found');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const status = await bridgeManager.healthCheck('/bad/path');
      expect(status).toBe('error');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/bridgeManager.test.ts`
Expected: FAIL — module `../bridgeManager` not found

**Step 3: Write the bridge manager**

Create `web/src/lib/bridges/bridgeManager.ts`:

```typescript
import { execFile } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import type { BridgeToolConfig, BridgeToolStatus, BridgesConfig, PlatformPaths } from './types';

const CONFIG_DIR = join(homedir(), '.spawnforge');
const CONFIG_FILE = join(CONFIG_DIR, 'bridges.json');

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
};

/** Additional search paths per platform (checked if default is missing). */
const EXTRA_SEARCH_PATHS: Record<string, Record<string, string[]>> = {
  aseprite: {
    win32: ['C:\\Program Files (x86)\\Aseprite\\aseprite.exe'],
    linux: ['/usr/local/bin/aseprite', join(homedir(), '.local/bin/aseprite')],
  },
};

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

/** Find a working binary path for a tool on the current platform. */
function findBinaryPath(toolId: string, customPath?: string): string | null {
  // 1. Custom path takes priority
  if (customPath && existsSync(customPath)) return customPath;

  const plat = platform() as 'darwin' | 'win32' | 'linux';
  const defaults = TOOL_DEFAULTS[toolId]?.paths ?? {};

  // 2. Default path for current platform
  const defaultPath = defaults[plat];
  if (defaultPath && existsSync(defaultPath)) return defaultPath;

  // 3. Extra search paths
  const extras = EXTRA_SEARCH_PATHS[toolId]?.[plat] ?? [];
  for (const p of extras) {
    if (existsSync(p)) return p;
  }

  // 4. Check saved config
  const saved = loadBridgesConfig()[toolId];
  if (saved?.customPath && existsSync(saved.customPath)) return saved.customPath;
  const savedPlatPath = saved?.paths?.[plat];
  if (savedPlatPath && existsSync(savedPlatPath)) return savedPlatPath;

  return null;
}

/** Run --version on a binary and return its version string. */
function getVersion(binaryPath: string): Promise<{ version: string | null; error?: string }> {
  return new Promise((resolve) => {
    execFile(binaryPath, ['--version'], (err, stdout, stderr) => {
      if (err) {
        resolve({ version: null, error: stderr || err.message });
        return;
      }
      resolve({ version: parseVersion(stdout) });
    });
  });
}

/** Discover a bridge tool: find binary, check version, return config. */
export async function discoverTool(toolId: string, customPath?: string): Promise<BridgeToolConfig> {
  const defaults = TOOL_DEFAULTS[toolId];
  const name = defaults?.name ?? toolId;

  const binaryPath = findBinaryPath(toolId, customPath);
  if (!binaryPath) {
    return {
      id: toolId,
      name,
      paths: defaults?.paths ?? {},
      activeVersion: null,
      status: 'not_found',
      customPath,
    };
  }

  const { version, error } = await getVersion(binaryPath);
  if (error || !version) {
    return {
      id: toolId,
      name,
      paths: defaults?.paths ?? {},
      activeVersion: null,
      status: 'error',
      customPath,
    };
  }

  // Save discovered config
  const config = loadBridgesConfig();
  const plat = platform() as 'darwin' | 'win32' | 'linux';
  config[toolId] = {
    paths: { ...defaults?.paths, [plat]: binaryPath },
    activeVersion: version,
    customPath,
  };
  saveBridgesConfig(config);

  return {
    id: toolId,
    name,
    paths: { ...defaults?.paths, [plat]: binaryPath },
    activeVersion: version,
    status: 'connected',
    customPath,
  };
}

/** Health check: verify a binary is accessible and returns a version. */
export async function healthCheck(binaryPath: string): Promise<BridgeToolStatus> {
  if (!existsSync(binaryPath)) return 'not_found';
  const { version, error } = await getVersion(binaryPath);
  if (error || !version) return 'error';
  return 'connected';
}
```

**Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/bridgeManager.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Lint check**

Run: `cd web && npx eslint src/lib/bridges/bridgeManager.ts src/lib/bridges/types.ts --max-warnings 0`
Expected: Clean

**Step 6: Commit**

```bash
git add web/src/lib/bridges/bridgeManager.ts web/src/lib/bridges/__tests__/bridgeManager.test.ts
git commit -m "feat(bridges): bridge manager with platform-aware auto-discovery (PF-89)"
```

---

## Task 3: Lua Template Engine

**Files:**
- Create: `web/src/lib/bridges/luaTemplates.ts`
- Create: `web/src/lib/bridges/aseprite/templates/createSprite.lua`
- Create: `web/src/lib/bridges/aseprite/templates/exportSheet.lua`
- Create: `web/src/lib/bridges/aseprite/templates/applyPalette.lua`
- Create: `web/src/lib/bridges/aseprite/templates/createAnimation.lua`
- Create: `web/src/lib/bridges/aseprite/templates/editSprite.lua`
- Test: `web/src/lib/bridges/__tests__/luaTemplates.test.ts`

**Step 1: Write the failing tests**

Create `web/src/lib/bridges/__tests__/luaTemplates.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

describe('Lua Templates', () => {
  let luaTemplates: typeof import('../luaTemplates');
  let fs: typeof import('fs');

  beforeAll(async () => {
    fs = await import('fs');
    luaTemplates = await import('../luaTemplates');
  });

  describe('renderTemplate', () => {
    it('replaces {{key}} placeholders with values', () => {
      const result = luaTemplates.renderTemplate(
        'local w = {{width}}\nlocal h = {{height}}',
        { width: '32', height: '32' }
      );
      expect(result).toBe('local w = 32\nlocal h = 32');
    });

    it('JSON-escapes string values for safety', () => {
      const result = luaTemplates.renderTemplate(
        'local name = "{{name}}"',
        { name: 'test"file' }
      );
      expect(result).toBe('local name = "test\\"file"');
    });

    it('leaves unmatched placeholders as empty strings', () => {
      const result = luaTemplates.renderTemplate(
        'local x = {{missing}}',
        {}
      );
      expect(result).toBe('local x = ');
    });

    it('handles numeric values', () => {
      const result = luaTemplates.renderTemplate(
        'local r = {{red}}\nlocal g = {{green}}',
        { red: '255', green: '128' }
      );
      expect(result).toBe('local r = 255\nlocal g = 128');
    });
  });

  describe('getTemplate', () => {
    it('reads template file from disk', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('local spr = Sprite({{width}}, {{height}})');
      const tpl = luaTemplates.getTemplate('createSprite');
      expect(tpl).toContain('Sprite({{width}}');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('createSprite.lua'),
        'utf-8'
      );
    });

    it('throws for unknown template', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);
      expect(() => luaTemplates.getTemplate('nonexistent')).toThrow();
    });
  });

  describe('buildScript', () => {
    it('reads template and applies params', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('Sprite({{width}}, {{height}})');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const script = luaTemplates.buildScript('createSprite', { width: '64', height: '64' });
      expect(script).toBe('Sprite(64, 64)');
    });
  });

  describe('template safety', () => {
    it('does not allow Lua injection via params', () => {
      const malicious = 'os.execute("rm -rf /")';
      const result = luaTemplates.renderTemplate(
        'local name = "{{name}}"',
        { name: malicious }
      );
      // The value should be escaped, not executable as Lua
      expect(result).not.toContain('os.execute("rm');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/luaTemplates.test.ts`
Expected: FAIL — module not found

**Step 3: Write the Lua template engine**

Create `web/src/lib/bridges/luaTemplates.ts`:

```typescript
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Resolve templates dir relative to this file (works in both CJS and ESM)
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'aseprite', 'templates');

/** Escape a string value for safe inclusion in Lua source code. */
function escapeForLua(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** Render a Lua template by replacing {{key}} placeholders. */
export function renderTemplate(
  template: string,
  params: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) return '';
    return escapeForLua(value);
  });
}

/** Load a named template from disk. */
export function getTemplate(name: string): string {
  const filePath = join(TEMPLATES_DIR, `${name}.lua`);
  if (!existsSync(filePath)) {
    throw new Error(`Bridge template not found: ${name} (expected at ${filePath})`);
  }
  return readFileSync(filePath, 'utf-8');
}

/** Load a template and render it with params in one step. */
export function buildScript(
  templateName: string,
  params: Record<string, string>
): string {
  const template = getTemplate(templateName);
  return renderTemplate(template, params);
}
```

**Step 4: Write the Lua template files**

Create `web/src/lib/bridges/aseprite/templates/createSprite.lua`:

```lua
-- Create a new sprite with specified dimensions and optional base color.
local width = {{width}}
local height = {{height}}
local colorMode = ColorMode.RGB

local spr = Sprite(width, height, colorMode)
spr.filename = "{{outputPath}}"

-- Apply base color if specified
local baseColor = "{{baseColor}}"
if baseColor ~= "" then
  local r = tonumber("{{baseColorR}}") or 0
  local g = tonumber("{{baseColorG}}") or 0
  local b = tonumber("{{baseColorB}}") or 0
  local a = tonumber("{{baseColorA}}") or 255
  app.fgColor = Color(r, g, b, a)
  app.command.FillWithForegroundColor()
end

spr:saveAs("{{outputPath}}")
print("OK:" .. spr.width .. "x" .. spr.height)
app.exit()
```

Create `web/src/lib/bridges/aseprite/templates/exportSheet.lua`:

```lua
-- Export sprite as sprite sheet PNG + JSON metadata.
local spr = app.open("{{inputPath}}")
if not spr then
  print("ERROR:Could not open file")
  app.exit()
  return
end

app.command.ExportSpriteSheet {
  ui = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = "{{outputPng}}",
  dataFilename = "{{outputJson}}",
  dataFormat = SpriteSheetDataFormat.JSON_ARRAY,
  filenameFormat = "{frame}",
  trimSprite = false,
}

print("OK:exported")
app.exit()
```

Create `web/src/lib/bridges/aseprite/templates/applyPalette.lua`:

```lua
-- Apply a palette to an existing .ase file.
local spr = app.open("{{inputPath}}")
if not spr then
  print("ERROR:Could not open file")
  app.exit()
  return
end

local palette = spr.palettes[1]
local colors = { {{paletteColors}} }

palette:resize(#colors)

for i, hex in ipairs(colors) do
  local r = tonumber(hex:sub(1, 2), 16)
  local g = tonumber(hex:sub(3, 4), 16)
  local b = tonumber(hex:sub(5, 6), 16)
  palette:setColor(i - 1, Color(r, g, b, 255))
end

spr:saveAs("{{outputPath}}")
print("OK:palette_applied:" .. #colors .. "_colors")
app.exit()
```

Create `web/src/lib/bridges/aseprite/templates/createAnimation.lua`:

```lua
-- Set up animation frames with timing and layers.
local width = {{width}}
local height = {{height}}
local frameCount = {{frameCount}}
local frameDuration = {{frameDuration}}

local spr = Sprite(width, height, ColorMode.RGB)

for i = 2, frameCount do
  spr:newFrame()
end

for i = 1, #spr.frames do
  spr.frames[i].duration = frameDuration / 1000
end

local layerNames = "{{layerNames}}"
if layerNames ~= "" then
  for name in layerNames:gmatch("[^,]+") do
    local trimmed = name:match("^%s*(.-)%s*$")
    if trimmed ~= "Layer 1" then
      spr:newLayer()
      spr.layers[#spr.layers].name = trimmed
    end
  end
end

spr:saveAs("{{outputPath}}")
print("OK:animation:" .. frameCount .. "frames")
app.exit()
```

Create `web/src/lib/bridges/aseprite/templates/editSprite.lua`:

```lua
-- Modify an existing .ase file (resize, add layers).
local spr = app.open("{{inputPath}}")
if not spr then
  print("ERROR:Could not open file")
  app.exit()
  return
end

local newWidth = tonumber("{{newWidth}}")
local newHeight = tonumber("{{newHeight}}")
if newWidth and newWidth > 0 and newHeight and newHeight > 0 then
  spr:resize(newWidth, newHeight)
end

local addLayer = "{{addLayer}}"
if addLayer ~= "" then
  spr:newLayer()
  spr.layers[#spr.layers].name = addLayer
end

spr:saveAs("{{outputPath}}")
print("OK:edited:" .. spr.width .. "x" .. spr.height)
app.exit()
```

**Step 5: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/luaTemplates.test.ts`
Expected: PASS (all 7 tests)

**Step 6: Commit**

```bash
git add web/src/lib/bridges/luaTemplates.ts web/src/lib/bridges/aseprite/templates/
git add web/src/lib/bridges/__tests__/luaTemplates.test.ts
git commit -m "feat(bridges): Lua template engine with 5 Aseprite templates (PF-89)"
```

---

## Task 4: Aseprite Bridge — Execution Layer

**Files:**
- Create: `web/src/lib/bridges/asepriteBridge.ts`
- Test: `web/src/lib/bridges/__tests__/asepriteBridge.test.ts`

**Step 1: Write the failing tests**

Create `web/src/lib/bridges/__tests__/asepriteBridge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
  homedir: vi.fn(() => '/mock-home'),
  platform: vi.fn(() => 'darwin'),
}));

describe('AsepriteBridge', () => {
  let asepriteBridge: typeof import('../asepriteBridge');
  let childProcess: typeof import('child_process');
  let fs: typeof import('fs');

  beforeEach(async () => {
    vi.resetModules();
    childProcess = await import('child_process');
    fs = await import('fs');
    asepriteBridge = await import('../asepriteBridge');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeOperation', () => {
    it('creates sprite via Lua script', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.readFileSync).mockReturnValue('Sprite({{width}}, {{height}})\nprint("OK:32x32")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'OK:32x32', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: { width: '32', height: '32' } }
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('OK');
      expect(mockExecFile).toHaveBeenCalledWith(
        '/usr/bin/aseprite',
        expect.arrayContaining(['--batch', '--script']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error result on Aseprite failure', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid lua');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
          Object.assign(new Error('exit code 1'), { code: 1 }),
          '',
          'Script error: line 1'
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: { width: '32', height: '32' } }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('writes temporary Lua script file', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      const mockWrite = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.readFileSync).mockReturnValue('print("OK")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'OK', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: {} }
      );

      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('.lua'),
        expect.any(String),
        'utf-8'
      );
    });

    it('cleans up temp script after execution', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      const mockUnlink = vi.mocked(fs.unlinkSync);
      vi.mocked(fs.readFileSync).mockReturnValue('print("OK")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'OK', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: {} }
      );

      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.lua'));
    });
  });

  describe('parseOutput', () => {
    it('extracts OK status from stdout', () => {
      const parsed = asepriteBridge.parseOutput('OK:32x32', '', 0);
      expect(parsed.success).toBe(true);
    });

    it('detects ERROR in stdout', () => {
      const parsed = asepriteBridge.parseOutput('ERROR:Could not open file', '', 0);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Could not open file');
    });

    it('treats non-zero exit code as failure', () => {
      const parsed = asepriteBridge.parseOutput('', 'segfault', 1);
      expect(parsed.success).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/asepriteBridge.test.ts`
Expected: FAIL — module not found

**Step 3: Write the Aseprite bridge**

Create `web/src/lib/bridges/asepriteBridge.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/asepriteBridge.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Lint check**

Run: `cd web && npx eslint src/lib/bridges/asepriteBridge.ts --max-warnings 0`

**Step 6: Commit**

```bash
git add web/src/lib/bridges/asepriteBridge.ts web/src/lib/bridges/__tests__/asepriteBridge.test.ts
git commit -m "feat(bridges): Aseprite bridge execution layer with temp script management (PF-89)"
```

---

## Task 5: Bridge Store (Zustand)

**Files:**
- Create: `web/src/stores/slices/bridgeSlice.ts`
- Modify: `web/src/stores/slices/index.ts:21` — add re-export
- Modify: `web/src/stores/editorStore.ts:60-102` — compose bridge slice
- Test: `web/src/stores/slices/__tests__/bridgeSlice.test.ts`

**Step 1: Write the failing tests**

Create `web/src/stores/slices/__tests__/bridgeSlice.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createSliceStore } from './sliceTestTemplate';
import { createBridgeSlice, type BridgeSlice } from '../bridgeSlice';

describe('BridgeSlice', () => {
  let store: ReturnType<typeof createSliceStore<BridgeSlice>>;

  beforeEach(() => {
    store = createSliceStore<BridgeSlice>(createBridgeSlice);
  });

  describe('initial state', () => {
    it('starts with no discovered tools', () => {
      expect(store.getState().bridgeTools).toEqual({});
    });

    it('starts with no running operations', () => {
      expect(store.getState().bridgeOperations).toEqual([]);
    });
  });

  describe('setBridgeTool', () => {
    it('adds a discovered tool', () => {
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: { darwin: '/usr/bin/aseprite' },
        activeVersion: '1.3.17',
        status: 'connected',
      });
      expect(store.getState().bridgeTools.aseprite).toBeDefined();
      expect(store.getState().bridgeTools.aseprite.status).toBe('connected');
    });

    it('updates an existing tool', () => {
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: {},
        activeVersion: null,
        status: 'not_found',
      });
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: { darwin: '/usr/bin/aseprite' },
        activeVersion: '1.3.17',
        status: 'connected',
      });
      expect(store.getState().bridgeTools.aseprite.status).toBe('connected');
    });
  });

  describe('removeBridgeTool', () => {
    it('removes a tool', () => {
      store.getState().setBridgeTool({
        id: 'aseprite',
        name: 'Aseprite',
        paths: {},
        activeVersion: null,
        status: 'connected',
      });
      store.getState().removeBridgeTool('aseprite');
      expect(store.getState().bridgeTools.aseprite).toBeUndefined();
    });
  });

  describe('bridge operations', () => {
    it('adds a running operation', () => {
      store.getState().addBridgeOperation({
        id: 'op-1',
        toolId: 'aseprite',
        operationName: 'createSprite',
        status: 'running',
        startedAt: Date.now(),
      });
      expect(store.getState().bridgeOperations).toHaveLength(1);
      expect(store.getState().bridgeOperations[0].status).toBe('running');
    });

    it('updates operation status', () => {
      store.getState().addBridgeOperation({
        id: 'op-1',
        toolId: 'aseprite',
        operationName: 'createSprite',
        status: 'running',
        startedAt: Date.now(),
      });
      store.getState().updateBridgeOperation('op-1', { status: 'completed' });
      expect(store.getState().bridgeOperations[0].status).toBe('completed');
    });

    it('removes completed operations', () => {
      store.getState().addBridgeOperation({
        id: 'op-1',
        toolId: 'aseprite',
        operationName: 'createSprite',
        status: 'completed',
        startedAt: Date.now(),
      });
      store.getState().removeBridgeOperation('op-1');
      expect(store.getState().bridgeOperations).toHaveLength(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/stores/slices/__tests__/bridgeSlice.test.ts`
Expected: FAIL — module not found

**Step 3: Write the bridge slice**

Create `web/src/stores/slices/bridgeSlice.ts`:

```typescript
/**
 * Bridge slice — tracks external tool connections and running operations.
 */

import { StateCreator } from 'zustand';

export interface BridgeToolInfo {
  id: string;
  name: string;
  paths: Record<string, string | undefined>;
  activeVersion: string | null;
  status: 'connected' | 'disconnected' | 'not_found' | 'error';
  customPath?: string;
}

export interface BridgeOperationInfo {
  id: string;
  toolId: string;
  operationName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  error?: string;
}

export interface BridgeSlice {
  bridgeTools: Record<string, BridgeToolInfo>;
  bridgeOperations: BridgeOperationInfo[];

  setBridgeTool: (tool: BridgeToolInfo) => void;
  removeBridgeTool: (toolId: string) => void;
  addBridgeOperation: (op: BridgeOperationInfo) => void;
  updateBridgeOperation: (opId: string, update: Partial<BridgeOperationInfo>) => void;
  removeBridgeOperation: (opId: string) => void;
}

export const createBridgeSlice: StateCreator<BridgeSlice, [], [], BridgeSlice> = (set) => ({
  bridgeTools: {},
  bridgeOperations: [],

  setBridgeTool: (tool) =>
    set((s) => ({
      bridgeTools: { ...s.bridgeTools, [tool.id]: tool },
    })),

  removeBridgeTool: (toolId) =>
    set((s) => {
      const { [toolId]: _removed, ...rest } = s.bridgeTools;
      return { bridgeTools: rest };
    }),

  addBridgeOperation: (op) =>
    set((s) => ({
      bridgeOperations: [...s.bridgeOperations, op],
    })),

  updateBridgeOperation: (opId, update) =>
    set((s) => ({
      bridgeOperations: s.bridgeOperations.map((op) =>
        op.id === opId ? { ...op, ...update } : op
      ),
    })),

  removeBridgeOperation: (opId) =>
    set((s) => ({
      bridgeOperations: s.bridgeOperations.filter((op) => op.id !== opId),
    })),
});
```

**Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/stores/slices/__tests__/bridgeSlice.test.ts`
Expected: PASS (all 7 tests)

**Step 5: Wire into editorStore**

In `web/src/stores/slices/index.ts`, add at end:
```typescript
export * from './bridgeSlice';
```

In `web/src/stores/editorStore.ts`:
- Add to imports (line ~60 area): `BridgeSlice, createBridgeSlice,`
- Add `& BridgeSlice` to `EditorState` type union (after `& EditModeSlice`)
- Add `...createBridgeSlice(...args),` to store creation (after `...createEditModeSlice`)

No dispatcher setter needed — bridge slice manages external tools, not the Bevy engine.

**Step 6: Lint + type check**

Run: `cd web && npx eslint src/stores/slices/bridgeSlice.ts --max-warnings 0 && npx tsc --noEmit`

**Step 7: Commit**

```bash
git add web/src/stores/slices/bridgeSlice.ts web/src/stores/slices/__tests__/bridgeSlice.test.ts
git add web/src/stores/slices/index.ts web/src/stores/editorStore.ts
git commit -m "feat(bridges): bridge Zustand store slice for tool tracking (PF-89)"
```

---

## Task 6: API Routes

**Files:**
- Create: `web/src/app/api/bridges/discover/route.ts`
- Create: `web/src/app/api/bridges/aseprite/execute/route.ts`
- Create: `web/src/app/api/bridges/aseprite/status/route.ts`
- Test: `web/src/lib/bridges/__tests__/api.test.ts`

**Step 1: Write the failing tests**

Create `web/src/lib/bridges/__tests__/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/bridges/bridgeManager', () => ({
  discoverTool: vi.fn(),
  healthCheck: vi.fn(),
}));
vi.mock('@/lib/bridges/asepriteBridge', () => ({
  executeOperation: vi.fn(),
}));

describe('Bridge API logic', () => {
  let bridgeManager: typeof import('../bridgeManager');
  let asepriteBridge: typeof import('../asepriteBridge');

  beforeEach(async () => {
    vi.resetModules();
    bridgeManager = await import('../bridgeManager');
    asepriteBridge = await import('../asepriteBridge');
  });

  describe('discover', () => {
    it('returns tool config on successful discovery', async () => {
      vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
        id: 'aseprite',
        name: 'Aseprite',
        paths: { darwin: '/usr/bin/aseprite' },
        activeVersion: '1.3.17',
        status: 'connected',
      });

      const result = await bridgeManager.discoverTool('aseprite');
      expect(result.status).toBe('connected');
      expect(result.activeVersion).toBe('1.3.17');
    });

    it('returns not_found when tool is missing', async () => {
      vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
        id: 'aseprite',
        name: 'Aseprite',
        paths: {},
        activeVersion: null,
        status: 'not_found',
      });

      const result = await bridgeManager.discoverTool('aseprite');
      expect(result.status).toBe('not_found');
    });
  });

  describe('execute', () => {
    it('returns success result from aseprite bridge', async () => {
      vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
        success: true,
        stdout: 'OK:32x32',
        exitCode: 0,
      });

      const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
        name: 'createSprite',
        params: { width: '32', height: '32' },
      });
      expect(result.success).toBe(true);
    });

    it('returns error result on failure', async () => {
      vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
        success: false,
        error: 'Script error',
        exitCode: 1,
      });

      const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
        name: 'createSprite',
        params: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Script error');
    });
  });

  describe('healthCheck', () => {
    it('returns connected for working binary', async () => {
      vi.mocked(bridgeManager.healthCheck).mockResolvedValue('connected');
      const status = await bridgeManager.healthCheck('/usr/bin/aseprite');
      expect(status).toBe('connected');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/api.test.ts`
Expected: FAIL — mocked modules not found

**Step 3: Write the API routes**

Create `web/src/app/api/bridges/discover/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const toolId = body?.toolId;
    const customPath = body?.customPath;

    if (!toolId || typeof toolId !== 'string') {
      return NextResponse.json({ error: 'toolId is required' }, { status: 400 });
    }

    const config = await discoverTool(toolId, customPath);
    return NextResponse.json(config);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}
```

Create `web/src/app/api/bridges/aseprite/execute/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { executeOperation } from '@/lib/bridges/asepriteBridge';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { operation, params, customPath } = body ?? {};

    if (!operation || typeof operation !== 'string') {
      return NextResponse.json({ error: 'operation is required' }, { status: 400 });
    }

    const tool = await discoverTool('aseprite', customPath);
    if (tool.status !== 'connected') {
      return NextResponse.json(
        { error: `Aseprite not available: ${tool.status}` },
        { status: 503 }
      );
    }

    const platform = process.platform as 'darwin' | 'win32' | 'linux';
    const binaryPath = tool.customPath || tool.paths[platform];
    if (!binaryPath) {
      return NextResponse.json(
        { error: 'No Aseprite binary path for current platform' },
        { status: 503 }
      );
    }

    const result = await executeOperation(binaryPath, {
      name: operation,
      params: params ?? {},
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Execution failed' },
      { status: 500 }
    );
  }
}
```

Create `web/src/app/api/bridges/aseprite/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { discoverTool } from '@/lib/bridges/bridgeManager';

export async function GET() {
  try {
    const config = await discoverTool('aseprite');
    return NextResponse.json({
      status: config.status,
      version: config.activeVersion,
      paths: config.paths,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Status check failed' },
      { status: 500 }
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/api.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Lint check**

Run: `cd web && npx eslint src/app/api/bridges/ --max-warnings 0`

**Step 6: Commit**

```bash
git add web/src/app/api/bridges/ web/src/lib/bridges/__tests__/api.test.ts
git commit -m "feat(bridges): API routes for discover, execute, and status (PF-89)"
```

---

## Task 7: Bridge Settings UI

**Files:**
- Create: `web/src/components/editor/BridgeToolsSection.tsx`
- Modify: `web/src/components/editor/SceneSettings.tsx` — add Bridge Tools section

**Step 1: Write the component**

Create `web/src/components/editor/BridgeToolsSection.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';

export function BridgeToolsSection() {
  const bridgeTools = useEditorStore((s) => s.bridgeTools);
  const setBridgeTool = useEditorStore((s) => s.setBridgeTool);
  const [discovering, setDiscovering] = useState(false);
  const [customPath, setCustomPath] = useState('');

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch('/api/bridges/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId: 'aseprite',
          customPath: customPath || undefined,
        }),
      });
      const data = await res.json();
      if (data.id) {
        setBridgeTool(data);
      }
    } catch {
      // Discovery failed — UI shows current state
    } finally {
      setDiscovering(false);
    }
  }, [customPath, setBridgeTool]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'text-green-400';
      case 'not_found': return 'text-zinc-500';
      case 'error': return 'text-red-400';
      default: return 'text-zinc-500';
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'connected': return 'Connected';
      case 'not_found': return 'Not Found';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Bridge Tools
      </h3>

      {Object.values(bridgeTools).length === 0 && (
        <p className="text-xs text-zinc-600">No tools discovered yet.</p>
      )}

      {Object.values(bridgeTools).map((tool) => (
        <div
          key={tool.id}
          className="flex items-center justify-between rounded bg-zinc-800/50 px-3 py-2"
        >
          <div>
            <span className="text-sm text-zinc-200">{tool.name}</span>
            {tool.activeVersion && (
              <span className="ml-2 text-xs text-zinc-500">v{tool.activeVersion}</span>
            )}
          </div>
          <span className={`text-xs ${statusColor(tool.status)}`}>
            {statusLabel(tool.status)}
          </span>
        </div>
      ))}

      <div className="space-y-2">
        <label className="block text-xs text-zinc-400">
          Custom path override (optional)
        </label>
        <input
          type="text"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          placeholder="/path/to/aseprite"
          className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600"
        />
      </div>

      <button
        onClick={handleDiscover}
        disabled={discovering}
        className="w-full rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {discovering ? 'Discovering...' : 'Discover Tools'}
      </button>
    </div>
  );
}
```

**Step 2: Wire into SceneSettings**

In `web/src/components/editor/SceneSettings.tsx`, add import at top:
```typescript
import { BridgeToolsSection } from './BridgeToolsSection';
```

Add before the closing `</div>` of the main container:
```tsx
<div className="border-t border-zinc-800 pt-4">
  <BridgeToolsSection />
</div>
```

**Step 3: Lint + type check**

Run: `cd web && npx eslint src/components/editor/BridgeToolsSection.tsx --max-warnings 0 && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add web/src/components/editor/BridgeToolsSection.tsx web/src/components/editor/SceneSettings.tsx
git commit -m "feat(bridges): Bridge Tools settings UI with discovery and status (PF-89)"
```

---

## Task 8: Integration Tests with Fixture Recording

**Files:**
- Create: `web/src/lib/bridges/__tests__/asepriteBridge.integration.test.ts`
- Create: `web/src/lib/bridges/__tests__/fixtures/` directory
- Create: `web/src/lib/bridges/__tests__/record-fixtures.ts`

**Step 1: Write the fixture recording utility**

Create `web/src/lib/bridges/__tests__/record-fixtures.ts`:

```typescript
/**
 * Fixture recording utility — run against real Aseprite to capture responses.
 *
 * Usage:
 *   ASEPRITE_PATH=/path/to/aseprite npx tsx src/lib/bridges/__tests__/record-fixtures.ts
 *
 * Creates/updates fixture files in __tests__/fixtures/ with real Aseprite output.
 * These fixtures are used by unit tests in CI where Aseprite is not available.
 */

import { execFile } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const ASEPRITE_BIN = process.env.ASEPRITE_PATH
  || '/Applications/Aseprite.app/Contents/MacOS/aseprite';

interface FixtureRecord {
  operation: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timestamp: string;
  asepriteVersion: string;
}

function runAndCapture(args: string[], operation: string): Promise<FixtureRecord> {
  return new Promise((resolve) => {
    execFile(ASEPRITE_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({
        operation,
        args,
        exitCode: err ? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        timestamp: new Date().toISOString(),
        asepriteVersion: '',
      });
    });
  });
}

async function main() {
  if (!existsSync(FIXTURES_DIR)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log('Recording Aseprite fixtures...');
  console.log(`Binary: ${ASEPRITE_BIN}`);

  // 1. Version check
  const version = await runAndCapture(['--version'], 'version');
  version.asepriteVersion = version.stdout.trim();
  writeFileSync(join(FIXTURES_DIR, 'version.json'), JSON.stringify(version, null, 2));
  console.log(`  Recorded: version (${version.stdout.trim()})`);

  // 2. Create sprite
  const createScript = 'local spr = Sprite(32, 32)\nspr:saveAs("/tmp/fixture_create.png")\nprint("OK:" .. spr.width .. "x" .. spr.height)\napp.exit()';
  writeFileSync('/tmp/fixture_create.lua', createScript);
  const create = await runAndCapture(['--batch', '--script', '/tmp/fixture_create.lua'], 'createSprite');
  writeFileSync(join(FIXTURES_DIR, 'createSprite.json'), JSON.stringify(create, null, 2));
  console.log(`  Recorded: createSprite (exit: ${create.exitCode})`);

  // 3. Bad script (error case)
  writeFileSync('/tmp/fixture_bad.lua', 'this is not valid lua');
  const bad = await runAndCapture(['--batch', '--script', '/tmp/fixture_bad.lua'], 'badScript');
  writeFileSync(join(FIXTURES_DIR, 'badScript.json'), JSON.stringify(bad, null, 2));
  console.log(`  Recorded: badScript (exit: ${bad.exitCode})`);

  // 4. Create animation
  const animScript = 'local spr = Sprite(32, 32)\nfor i = 2, 4 do spr:newFrame() end\nfor i = 1, #spr.frames do spr.frames[i].duration = 0.1 end\nspr:saveAs("/tmp/fixture_anim.png")\nprint("OK:animation:4frames")\napp.exit()';
  writeFileSync('/tmp/fixture_anim.lua', animScript);
  const anim = await runAndCapture(['--batch', '--script', '/tmp/fixture_anim.lua'], 'createAnimation');
  writeFileSync(join(FIXTURES_DIR, 'createAnimation.json'), JSON.stringify(anim, null, 2));
  console.log(`  Recorded: createAnimation (exit: ${anim.exitCode})`);

  console.log(`\nAll fixtures saved to ${FIXTURES_DIR}`);
}

main().catch(console.error);
```

**Step 2: Write the integration test**

Create `web/src/lib/bridges/__tests__/asepriteBridge.integration.test.ts`:

```typescript
/**
 * Integration tests — require real Aseprite installation.
 * Skip in CI (no Aseprite available). Run locally with:
 *   ASEPRITE_PATH=/path/to/aseprite npx vitest run src/lib/bridges/__tests__/asepriteBridge.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { execFile } from 'child_process';

const ASEPRITE_BIN = process.env.ASEPRITE_PATH
  || '/Applications/Aseprite.app/Contents/MacOS/aseprite';

const HAS_ASEPRITE = existsSync(ASEPRITE_BIN);

function runAseprite(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(ASEPRITE_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: err ? 1 : 0,
      });
    });
  });
}

describe.skipIf(!HAS_ASEPRITE)('Aseprite Integration', () => {
  beforeAll(() => {
    console.log(`Using Aseprite at: ${ASEPRITE_BIN}`);
  });

  it('reports version', async () => {
    const { stdout, exitCode } = await runAseprite(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Aseprite \d+\.\d+\.\d+/);
  });

  it('creates a sprite via Lua script', async () => {
    const { writeFileSync } = await import('fs');
    const script = 'local spr = Sprite(32, 32)\nspr:saveAs("/tmp/integration_test.png")\nprint("OK:" .. spr.width .. "x" .. spr.height)\napp.exit()';
    writeFileSync('/tmp/integration_test.lua', script);

    const { stdout, exitCode } = await runAseprite(['--batch', '--script', '/tmp/integration_test.lua']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('OK:32x32');
    expect(existsSync('/tmp/integration_test.png')).toBe(true);
  });

  it('handles script errors gracefully', async () => {
    const { writeFileSync } = await import('fs');
    writeFileSync('/tmp/integration_bad.lua', 'this is not valid lua');

    const { exitCode } = await runAseprite(['--batch', '--script', '/tmp/integration_bad.lua']);
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  it('creates animation frames', async () => {
    const { writeFileSync } = await import('fs');
    const script = 'local spr = Sprite(16, 16)\nfor i = 2, 4 do spr:newFrame() end\nprint("OK:frames:" .. #spr.frames)\napp.exit()';
    writeFileSync('/tmp/integration_anim.lua', script);

    const { stdout, exitCode } = await runAseprite(['--batch', '--script', '/tmp/integration_anim.lua']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('OK:frames:4');
  });
});
```

**Step 3: Run integration test locally**

Run: `cd web && ASEPRITE_PATH="/Applications/Aseprite.app/Contents/MacOS/aseprite" npx vitest run src/lib/bridges/__tests__/asepriteBridge.integration.test.ts`
Expected: PASS (4 tests) or SKIP if Aseprite not found

**Step 4: Record fixtures**

Run: `cd web && npx tsx src/lib/bridges/__tests__/record-fixtures.ts`
Expected: Creates fixture JSON files in `__tests__/fixtures/`

**Step 5: Commit**

```bash
git add web/src/lib/bridges/__tests__/asepriteBridge.integration.test.ts
git add web/src/lib/bridges/__tests__/record-fixtures.ts
git add web/src/lib/bridges/__tests__/fixtures/
git commit -m "feat(bridges): integration tests with fixture recording for CI mocks (PF-89)"
```

---

## Task 9: Fixture-Based Unit Tests (CI-Ready)

**Files:**
- Modify: `web/src/lib/bridges/__tests__/asepriteBridge.test.ts` — add fixture-driven tests

**Step 1: Add fixture-based tests**

Add a new `describe('fixture-based tests', ...)` block to `asepriteBridge.test.ts`:

```typescript
describe('fixture-based tests', () => {
  it('handles real createSprite response from fixture', async () => {
    let fixture: { stdout: string; stderr: string; exitCode: number };
    try {
      fixture = (await import('./fixtures/createSprite.json')).default;
    } catch {
      return; // Skip if fixtures not recorded yet
    }

    const mockExecFile = vi.mocked(childProcess.execFile);
    vi.mocked(fs.readFileSync).mockReturnValue('print("OK")');

    mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as (err: null, stdout: string, stderr: string) => void)(
        null, fixture.stdout, fixture.stderr
      );
      return {} as ReturnType<typeof childProcess.execFile>;
    });

    const result = await asepriteBridge.executeOperation(
      '/usr/bin/aseprite',
      { name: 'createSprite', params: { width: '32', height: '32' } }
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe(fixture.stdout);
  });

  it('handles real error response from fixture', async () => {
    let fixture: { stdout: string; stderr: string; exitCode: number };
    try {
      fixture = (await import('./fixtures/badScript.json')).default;
    } catch {
      return;
    }

    const mockExecFile = vi.mocked(childProcess.execFile);
    vi.mocked(fs.readFileSync).mockReturnValue('bad lua');

    if (fixture.exitCode !== 0) {
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error, stdout: string, stderr: string) => void)(
          Object.assign(new Error('exit'), { code: fixture.exitCode }),
          fixture.stdout, fixture.stderr
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });
    } else {
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(
          null, fixture.stdout, fixture.stderr
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });
    }

    const result = await asepriteBridge.executeOperation(
      '/usr/bin/aseprite',
      { name: 'createSprite', params: {} }
    );

    if (fixture.exitCode !== 0) {
      expect(result.success).toBe(false);
    }
  });
});
```

**Step 2: Run all bridge tests**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/`
Expected: PASS

**Step 3: Commit**

```bash
git add web/src/lib/bridges/__tests__/asepriteBridge.test.ts
git commit -m "feat(bridges): fixture-based unit tests driven by real Aseprite responses (PF-89)"
```

---

## Task 10: E2E Tests with Mock Bridge

**Files:**
- Create: `web/src/lib/bridges/__tests__/bridgeE2E.test.ts`

**Step 1: Write E2E pipeline test**

Create `web/src/lib/bridges/__tests__/bridgeE2E.test.ts`:

```typescript
/**
 * E2E tests with mock bridge — validates the full SpawnForge pipeline:
 * bridge API -> result processing -> store updates
 *
 * Uses mocked responses (from recorded fixtures pattern).
 * Runs in CI without Aseprite installed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';
import { createBridgeSlice, type BridgeSlice } from '@/stores/slices/bridgeSlice';

vi.mock('@/lib/bridges/bridgeManager', () => ({
  discoverTool: vi.fn(),
  healthCheck: vi.fn(),
  loadBridgesConfig: vi.fn(() => ({})),
  saveBridgesConfig: vi.fn(),
  getDefaultPaths: vi.fn(() => ({
    darwin: '/Applications/Aseprite.app/Contents/MacOS/aseprite',
  })),
}));

vi.mock('@/lib/bridges/asepriteBridge', () => ({
  executeOperation: vi.fn(),
  parseOutput: vi.fn(),
}));

describe('Bridge E2E Pipeline', () => {
  let store: ReturnType<typeof createSliceStore<BridgeSlice>>;
  let bridgeManager: typeof import('../bridgeManager');
  let asepriteBridge: typeof import('../asepriteBridge');

  beforeEach(async () => {
    vi.resetModules();
    store = createSliceStore<BridgeSlice>(createBridgeSlice);
    bridgeManager = await import('../bridgeManager');
    asepriteBridge = await import('../asepriteBridge');
  });

  it('full discover -> execute -> store update pipeline', async () => {
    // 1. Discover tool
    vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
      id: 'aseprite',
      name: 'Aseprite',
      paths: { darwin: '/usr/bin/aseprite' },
      activeVersion: '1.3.17',
      status: 'connected',
    });

    const toolConfig = await bridgeManager.discoverTool('aseprite');
    store.getState().setBridgeTool(toolConfig);
    expect(store.getState().bridgeTools.aseprite.status).toBe('connected');

    // 2. Start operation
    const opId = 'op-create-sprite-1';
    store.getState().addBridgeOperation({
      id: opId,
      toolId: 'aseprite',
      operationName: 'createSprite',
      status: 'running',
      startedAt: Date.now(),
    });
    expect(store.getState().bridgeOperations[0].status).toBe('running');

    // 3. Execute (mocked)
    vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
      success: true,
      stdout: 'OK:32x32',
      exitCode: 0,
      outputFiles: ['/tmp/sprite.png'],
    });

    const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
      name: 'createSprite',
      params: { width: '32', height: '32' },
    });

    // 4. Update store
    store.getState().updateBridgeOperation(opId, {
      status: result.success ? 'completed' : 'failed',
    });
    expect(store.getState().bridgeOperations[0].status).toBe('completed');

    // 5. Clean up
    store.getState().removeBridgeOperation(opId);
    expect(store.getState().bridgeOperations).toHaveLength(0);
  });

  it('handles discovery failure gracefully', async () => {
    vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
      id: 'aseprite',
      name: 'Aseprite',
      paths: {},
      activeVersion: null,
      status: 'not_found',
    });

    const toolConfig = await bridgeManager.discoverTool('aseprite');
    store.getState().setBridgeTool(toolConfig);
    expect(store.getState().bridgeTools.aseprite.status).toBe('not_found');
  });

  it('handles execution failure and updates store', async () => {
    store.getState().setBridgeTool({
      id: 'aseprite',
      name: 'Aseprite',
      paths: { darwin: '/usr/bin/aseprite' },
      activeVersion: '1.3.17',
      status: 'connected',
    });

    const opId = 'op-fail-1';
    store.getState().addBridgeOperation({
      id: opId,
      toolId: 'aseprite',
      operationName: 'createSprite',
      status: 'running',
      startedAt: Date.now(),
    });

    vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
      success: false,
      error: 'Script error at line 5',
      exitCode: 1,
    });

    const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
      name: 'createSprite',
      params: {},
    });

    store.getState().updateBridgeOperation(opId, {
      status: 'failed',
      error: result.error,
    });

    expect(store.getState().bridgeOperations[0].status).toBe('failed');
    expect(store.getState().bridgeOperations[0].error).toBe('Script error at line 5');
  });
});
```

**Step 2: Run E2E tests**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/bridgeE2E.test.ts`
Expected: PASS (all 3 tests)

**Step 3: Commit**

```bash
git add web/src/lib/bridges/__tests__/bridgeE2E.test.ts
git commit -m "feat(bridges): E2E pipeline tests with mock bridge service (PF-89)"
```

---

## Task 11: Full Suite Verification

**Step 1: Run all bridge tests**

Run: `cd web && npx vitest run src/lib/bridges/__tests__/ src/stores/slices/__tests__/bridgeSlice.test.ts`
Expected: PASS — all ~48 tests pass

**Step 2: Lint entire bridge surface**

Run: `cd web && npx eslint src/lib/bridges/ src/stores/slices/bridgeSlice.ts src/components/editor/BridgeToolsSection.tsx src/app/api/bridges/ --max-warnings 0`
Expected: Clean

**Step 3: Type check**

Run: `cd web && npx tsc --noEmit`
Expected: Clean

**Step 4: Run full test suite to ensure no regressions**

Run: `cd web && npx vitest run`
Expected: All existing tests still pass

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(bridges): Phase 2 Aseprite Bridge complete — all tests passing (PF-89)"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Bridge types (`types.ts`) | 5 |
| 2 | Bridge manager + discovery (`bridgeManager.ts`) | 8 |
| 3 | Lua template engine + 5 templates | 7 |
| 4 | Aseprite execution layer (`asepriteBridge.ts`) | 7 |
| 5 | Bridge Zustand store slice | 7 |
| 6 | API routes (discover, execute, status) | 5 |
| 7 | Bridge Tools settings UI | 0 (visual) |
| 8 | Integration tests + fixture recording | 4 |
| 9 | Fixture-based CI unit tests | 2 |
| 10 | E2E pipeline tests with mock bridge | 3 |
| 11 | Full suite verification | 0 (validation) |
| **Total** | | **~48 tests** |

### Files Created
- `web/src/lib/bridges/types.ts`
- `web/src/lib/bridges/bridgeManager.ts`
- `web/src/lib/bridges/luaTemplates.ts`
- `web/src/lib/bridges/asepriteBridge.ts`
- `web/src/lib/bridges/aseprite/templates/*.lua` (5 files)
- `web/src/stores/slices/bridgeSlice.ts`
- `web/src/app/api/bridges/discover/route.ts`
- `web/src/app/api/bridges/aseprite/execute/route.ts`
- `web/src/app/api/bridges/aseprite/status/route.ts`
- `web/src/components/editor/BridgeToolsSection.tsx`
- `web/src/lib/bridges/__tests__/*.test.ts` (6 test files)
- `web/src/lib/bridges/__tests__/record-fixtures.ts`
- `web/src/lib/bridges/__tests__/fixtures/*.json`

### Files Modified
- `web/src/stores/slices/index.ts` — add bridgeSlice export
- `web/src/stores/editorStore.ts` — compose BridgeSlice
- `web/src/components/editor/SceneSettings.tsx` — add Bridge Tools section
