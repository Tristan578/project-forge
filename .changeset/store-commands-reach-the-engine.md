---
"web": patch
---

Four editor actions that appeared to work now actually reach the engine.

Deleting a sprite, changing the 2D camera, editing a reverb zone, and setting a
2D skeleton each dispatched a command name the engine has never had an arm for.
The engine returned "unknown command" into a value nobody reads, so the panel
updated, the undo entry recorded, and the running scene simply ignored it — no
error, no warning, nothing in the console. All four have working arms under
different spellings and now use them.

The skeleton case was wrong twice: the engine also expects the skeleton nested
one level down rather than spread across the payload, so a corrected name on the
old shape would have replaced the rig with an empty one instead of doing nothing.
That same mismatch had already broken Apply Rig in the auto-rigging panel, which
searched for the old command name and therefore never found it — the button had
been doing nothing at all, and its only test checked that the panel rendered.
Apply Rig works, and the test now drives the button and checks what the store
receives.

2D tilemaps and 2D skeletal animation work again. The engine keeps a routing
table in front of its command handlers, and sixteen sprite commands were missing
from it — so tile painting, tilemap edits, skin changes, IK chains, auto-weighting
and sprite animation state machines all had complete, correct handlers that could
never be reached. Every one of them returned "unknown command" into a value
nobody reads. Two were worse: they were pointed at the wrong section of the
table, where an unfinished placeholder answered in place of the real handler.
Both the tilemap panels and the AI tools that edit tilemaps were affected, as
were user scripts calling the 2D skeletal API.

Tileset assignment is the one piece still not connected: the engine wants a
tileset attached to a specific object while the editor tracks tilesets per
image, and picking a side changes behaviour rather than just wiring. It is
tracked and now recorded in the code instead of failing quietly.

A new test scans every command name the editor dispatches and fails if one has
no working engine arm behind it, so the next one cannot ship silently. Names
that are genuinely waiting on engine work are listed explicitly with a ticket,
and the list fails if an entry becomes implemented or stops being used — it
cannot quietly grow stale.

A second test on the engine side reads the routing table against the handlers it
points at and fails if any handler is unreachable or pointed at the wrong
section. That is what found the sixteen, and it covers every command the engine
has rather than only the ones the editor happens to send.
