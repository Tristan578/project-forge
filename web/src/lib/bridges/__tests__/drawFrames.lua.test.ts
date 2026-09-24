/**
 * Runs the SHIPPED `drawFrames.lua`, rendered by the real `buildScript`, in a
 * real Lua VM (fengari) against a stub of the Aseprite API that records every
 * pixel (#10271).
 *
 * No Aseprite is available in CI (the integration suite skips without it), so
 * this is what executes the template's own logic: the hex parsing, the index
 * walk, the palette lookup, per-frame images and the export call. The stub
 * follows the documented API (aseprite.org/api): `Sprite:newFrame()` COPIES the
 * previous frame's cel, `Layer:cel(n)` returns nil when there is none,
 * `Cel.image` is settable, and `Image:drawPixel` takes an integer pixel value
 * built by `app.pixelColor.rgba`. What it cannot prove is Aseprite's own
 * rendering; the recorded-fixture integration test covers that where Aseprite
 * exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { lua, lauxlib, lualib, to_luastring } from 'fengari';

vi.mock('server-only', () => ({}));

import { buildScript } from '../luaTemplates';

/** The Aseprite API surface the template touches, recording what it does. */
const ASEPRITE_STUB = `
__out = {}
function print(s) __out[#__out + 1] = tostring(s) end
ColorMode = { RGB = 0 }
SpriteSheetType = { HORIZONTAL = 1 }
SpriteSheetDataFormat = { JSON_ARRAY = 1 }
function Point(x, y) return { x = x, y = y } end

local ImageMT = {}
ImageMT.__index = ImageMT
function Image(w, h, mode) return setmetatable({ w = w, h = h, px = {} }, ImageMT) end
function ImageMT:drawPixel(x, y, v)
  if x < 0 or y < 0 or x >= self.w or y >= self.h then error("drawPixel out of bounds") end
  if type(v) ~= "string" then error("drawPixel needs a pixel value from app.pixelColor") end
  self.px[y * self.w + x] = v
end

app = {
  pixelColor = {
    rgba = function(r, g, b, a) return string.format("%02x%02x%02x%02x", r, g, b, a or 255) end,
  },
  command = { ExportSpriteSheet = function(opts) __exported = opts end },
  exit = function() end,
}

function Sprite(w, h, mode)
  local layer = { cels = {} }
  function layer:cel(f) return self.cels[f] end
  local spr = { width = w, height = h, frames = { { duration = 0.1 } }, layers = { layer } }
  layer.cels[1] = { image = Image(w, h), position = Point(0, 0) }
  function spr:newFrame()
    local n = #self.frames + 1
    self.frames[n] = { duration = self.frames[n - 1].duration }
    -- A copy of the previous cel: it starts out sharing that frame's image.
    local prev = layer.cels[n - 1]
    layer.cels[n] = { image = prev.image, position = prev.position }
    return self.frames[n]
  end
  function spr:newCel(l, f, img, pos)
    l.cels[f] = { image = img, position = pos }
    return l.cels[f]
  end
  __sprite = spr
  return spr
end
`;

/** Serialise what the stub recorded into one string the test can parse. */
const COLLECT = `
local parts = {}
parts[#parts + 1] = "out=" .. table.concat(__out, ";")
if __sprite then
  local layer = __sprite.layers[1]
  for f = 1, #__sprite.frames do
    local img = layer.cels[f].image
    local row = {}
    for i = 0, img.w * img.h - 1 do row[#row + 1] = img.px[i] or "-" end
    parts[#parts + 1] = "frame" .. f .. "=" .. table.concat(row, ",")
    parts[#parts + 1] = "duration" .. f .. "=" .. tostring(__sprite.frames[f].duration)
  end
end
if __exported then
  parts[#parts + 1] = "png=" .. __exported.textureFilename
  parts[#parts + 1] = "json=" .. __exported.dataFilename
  parts[#parts + 1] = "ui=" .. tostring(__exported.ui)
end
__result = table.concat(parts, "\\n")
`;

interface Run {
  out: string;
  frames: string[][];
  durations: number[];
  png?: string;
  json?: string;
  ui?: string;
}

function run(params: Record<string, string>): Run {
  const script = buildScript('drawFrames', params);
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  // Three chunks, as Aseprite runs a script as its own chunk: the template's
  // early `return` on an error must end the template, not the collector.
  for (const chunk of [ASEPRITE_STUB, script, COLLECT]) {
    const status = lauxlib.luaL_dostring(L, to_luastring(chunk));
    if (status !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  }
  lua.lua_getglobal(L, to_luastring('__result'));
  const raw = lua.lua_tojsstring(L, -1);
  const fields = Object.fromEntries(
    raw.split('\n').map((line: string) => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), line.slice(eq + 1)];
    }),
  ) as Record<string, string>;
  const frames: string[][] = [];
  const durations: number[] = [];
  for (let f = 1; fields[`frame${f}`] !== undefined; f += 1) {
    frames.push(fields[`frame${f}`]!.split(','));
    durations.push(Number(fields[`duration${f}`]));
  }
  return { out: fields.out ?? '', frames, durations, png: fields.png, json: fields.json, ui: fields.ui };
}

/** Encode frames of palette indices the way asepriteDraw does. */
function hex(frames: number[][]): string {
  return frames.flat().map((i) => i.toString(16).padStart(2, '0')).join('');
}

const PALETTE = 'ff0000,00ff0080';
const RED = 'ff0000ff';
const GREEN_HALF = '00ff0080';

describe('drawFrames.lua', () => {
  it('draws every frame from the palette indices, leaving index 0 transparent', () => {
    const frames = [
      [1, 0, 2, 1],
      [0, 2, 2, 0],
      [2, 1, 0, 0],
    ];
    const result = run({
      width: '2',
      height: '2',
      frameCount: '3',
      frameDuration: '150',
      paletteColors: PALETTE,
      pixelData: hex(frames),
      outputPng: 'C:/tmp/spawnforge-bridge/sheet.png',
      outputJson: 'C:/tmp/spawnforge-bridge/sheet.json',
    });

    expect(result.out).toBe('OK:drawn:3');
    const colour = (i: number) => (i === 0 ? '-' : i === 1 ? RED : GREEN_HALF);
    expect(result.frames).toEqual(frames.map((f) => f.map(colour)));
    expect(result.durations).toEqual([0.15, 0.15, 0.15]);
  });

  // newFrame() copies the previous cel, sharing its image. Drawing into
  // whatever image a frame already had would paint every frame onto one
  // shared canvas; the template must give each frame its own image.
  it('gives each frame its own image rather than drawing into a copied one', () => {
    const result = run({
      width: '1',
      height: '1',
      frameCount: '2',
      frameDuration: '100',
      paletteColors: PALETTE,
      pixelData: hex([[1], [2]]),
      outputPng: 'a.png',
      outputJson: 'a.json',
    });

    expect(result.frames).toEqual([[RED], [GREEN_HALF]]);
  });

  it('exports a sheet to exactly the paths the server passed, without UI', () => {
    const result = run({
      width: '1',
      height: '1',
      frameCount: '1',
      frameDuration: '100',
      paletteColors: PALETTE,
      pixelData: '01',
      outputPng: 'C:/tmp/spawnforge-bridge/x.png',
      outputJson: 'C:/tmp/spawnforge-bridge/x.json',
    });

    expect(result.png).toBe('C:/tmp/spawnforge-bridge/x.png');
    expect(result.json).toBe('C:/tmp/spawnforge-bridge/x.json');
    expect(result.ui).toBe('false');
  });

  it('refuses pixel data whose length does not match the sprite, drawing nothing', () => {
    const result = run({
      width: '2',
      height: '2',
      frameCount: '1',
      frameDuration: '100',
      paletteColors: PALETTE,
      pixelData: '010101',
      outputPng: 'a.png',
      outputJson: 'a.json',
    });

    expect(result.out).toBe('ERROR:pixel data does not match the sprite size');
    expect(result.frames).toEqual([]);
    expect(result.png).toBeUndefined();
  });

  it('refuses an index outside the palette rather than drawing a nil colour', () => {
    const result = run({
      width: '1',
      height: '1',
      frameCount: '1',
      frameDuration: '100',
      paletteColors: PALETTE,
      pixelData: '03',
      outputPng: 'a.png',
      outputJson: 'a.json',
    });

    expect(result.out).toBe('ERROR:palette index out of range');
    expect(result.png).toBeUndefined();
  });

  it('cannot be handed anything but hex as pixel data', () => {
    expect(() =>
      buildScript('drawFrames', { pixelData: '01"; os.execute("calc") --' }),
    ).toThrow(/lowercase hex/);
  });
});
