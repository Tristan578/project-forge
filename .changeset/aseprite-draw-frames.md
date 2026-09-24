---
"web": patch
---

The Aseprite bridge can now turn pixel data (a palette plus per-frame grids of colour indices) into a real sprite sheet, instead of blank frames. The data is validated and drawn by a fixed template, so no model- or client-written Lua ever runs. The raw bridge route no longer lets a caller choose where the server reads or writes files.
