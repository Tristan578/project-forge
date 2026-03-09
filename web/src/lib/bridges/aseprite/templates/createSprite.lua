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
