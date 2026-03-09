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
