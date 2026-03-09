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
