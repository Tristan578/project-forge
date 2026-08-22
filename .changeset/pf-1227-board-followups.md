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
asked for. That one was invisible to the test suite by construction -- the
tests run on a 64-bit host, where the same cast keeps every bit and the bug
does not reproduce. The tile index was cast to a fixed 32-bit integer instead,
so it wrapped everywhere, the test host included; nothing had simply ever
asked it to. All four values are now rejected above the 32-bit maximum, and
the new native tests cover both -- the tile index goes red on the host the
moment the old cast is put back.

A script that passes such a coordinate gets an error naming the field, the
value and the limit, rather than a command that disappears.
`forge.tilemap.fillRect` also checks the far edge of the rectangle, not just
its origin and size -- it is the cells in between that the engine reads -- and
its error says which axis ran off the end and what it reached.
