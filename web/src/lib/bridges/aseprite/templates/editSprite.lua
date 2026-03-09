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
