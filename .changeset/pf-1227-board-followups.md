---
"web": patch
---

A tilemap coordinate past the 32-bit range is now refused instead of wrapping
into a real cell.

The overflow guard added earlier caught coordinates outside the declared map,
but the numbers reaching it had already been truncated: the engine read layer,
x, y and tile index by casting a 64-bit value straight to a pointer-sized one,
and on the 32-bit WebAssembly target that cast silently drops the high bits. An
x of 4,294,967,299 arrived as 3, looked like an ordinary in-range cell, and
painted a tile the caller never asked for. Painting, erasing and filling now
reject any of those four values above the 32-bit maximum.

A script that passes such a coordinate gets a named error naming the field and
the limit, rather than a command that disappears. `forge.tilemap.fillRect` also
checks the far edge of the rectangle, not just its origin and size, since it is
the cells in between that the engine reads.
