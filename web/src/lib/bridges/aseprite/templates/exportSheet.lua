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
