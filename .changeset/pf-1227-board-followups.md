---
"web": patch
---

A tilemap coordinate past the 32-bit range is now refused instead of wrapping
into a real cell.

The overflow guard in the engine's tilemap module caught coordinates outside
the declared map, but the numbers reaching it had already been truncated. The
layer, x and y of every paint, erase and fill were read by casting a 64-bit
value straight to a pointer-sized one, which drops the high bits on the 32-bit
WebAssembly target the engine ships on: an x of 4,294,967,299 arrived as 3,
looked like an ordinary in-range cell, and painted a tile the caller never
asked for. The tile index was cast to a fixed 32-bit integer instead, so it
wrapped everywhere, the 64-bit test host included; the pointer-sized cast is
the one that reproduces only on wasm32, since the host keeps the high bits.
All four values are now rejected above the 32-bit maximum. The new native
tests cover all four, and all four go red on the host the moment any of the
old casts is put back: they demand that one-past-the-maximum be refused, and
the old code accepts it on a host where nothing was truncated. What a host
test could never have shown is the wrap itself -- the coordinate that came
back as 3 and painted a cell.

A script that passes such a coordinate gets an error naming the field, the
value and the limit, rather than a command that disappears.
`forge.tilemap.fillRect` also checks the far edge of the rectangle, not just
its origin and size -- it is the cells in between that the engine reads -- and
its error says which axis ran off the end and what it reached.
