-- Draw validated pixel data into a new sprite and export it as a sprite sheet.
--
-- Every substituted value below is DATA the server validated and serialised
-- (asepriteDraw.ts -> luaTemplates.ts): integers, a list of hex colours, a hex
-- string of palette indices, and two server-generated file paths. Nothing here
-- is written by a model or a client (#10271).
local width = {{width}}
local height = {{height}}
local frameCount = {{frameCount}}
local frameDuration = {{frameDuration}}
local paletteHex = { {{paletteColors}} }
-- Two hex characters per pixel, row-major, frame after frame. 00 is
-- transparent; n (1-based) is paletteHex[n].
local pixels = "{{pixelData}}"

if #pixels ~= width * height * frameCount * 2 then
  print("ERROR:pixel data does not match the sprite size")
  app.exit()
  return
end

local colors = {}
for i, hex in ipairs(paletteHex) do
  local r = tonumber(hex:sub(1, 2), 16)
  local g = tonumber(hex:sub(3, 4), 16)
  local b = tonumber(hex:sub(5, 6), 16)
  local a = 255
  if #hex == 8 then
    a = tonumber(hex:sub(7, 8), 16)
  end
  colors[i] = app.pixelColor.rgba(r, g, b, a)
end

local spr = Sprite(width, height, ColorMode.RGB)
for i = 2, frameCount do
  spr:newFrame()
end

local layer = spr.layers[1]
local pos = 1
for f = 1, frameCount do
  local img = Image(width, height, ColorMode.RGB)
  for y = 0, height - 1 do
    for x = 0, width - 1 do
      local index = tonumber(pixels:sub(pos, pos + 1), 16)
      pos = pos + 2
      if index > #colors then
        print("ERROR:palette index out of range")
        app.exit()
        return
      end
      if index > 0 then
        img:drawPixel(x, y, colors[index])
      end
    end
  end
  -- newFrame() copies the previous frame's cel, and newCel's behaviour over an
  -- existing cel is undocumented, so replace the image of the cel that is
  -- there (Cel.image is settable) and only create one where none exists.
  local cel = layer:cel(f)
  if cel then
    cel.image = img
    cel.position = Point(0, 0)
  else
    spr:newCel(layer, f, img, Point(0, 0))
  end
  spr.frames[f].duration = frameDuration / 1000
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

print("OK:drawn:" .. frameCount)
app.exit()
