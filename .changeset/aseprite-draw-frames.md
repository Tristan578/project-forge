---
"web": patch
---

The Aseprite bridge can now turn pixel data (a palette plus per-frame grids of colour indices) into a real sprite sheet, instead of blank frames. The data is validated and drawn by a fixed template, so no model- or client-written Lua ever runs. The raw bridge route no longer lets a caller choose where the server reads or writes files: it runs only `createSprite` and `createAnimation`, saves to a server-chosen temp file, and returns that file's bytes (base64) instead of a path. Requests are capped at 2048×2048 pixels and 256 frames, and a saved file over 8 MiB is not returned. `editSprite`, `applyPalette` and `exportSheet` are refused for now, because they need an input sprite the route cannot yet accept safely (#10283).
