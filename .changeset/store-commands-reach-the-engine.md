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

A new test scans every command name the editor's state layer dispatches and
fails if one has no working engine arm behind it, so the next one cannot ship
silently. It covers the store, which is where all of these bugs were; the AI
tool handlers dispatch a few names of their own and are not scanned yet. Names
that are genuinely waiting on engine work are listed explicitly with a ticket,
and the list fails if an entry becomes implemented or stops being used — it
cannot quietly grow stale.

A second test on the engine side reads the routing table against the handlers it
points at and fails if any handler is unreachable or pointed at the wrong
section. That is what found the sixteen, and it covers every command the engine
has rather than only the ones the editor happens to send. It reads the list of
handler sections off disk rather than from a list kept by hand, so a section
added later cannot sit outside the check by not being mentioned in it.

Auto-weighting a 2D skeleton now recomputes vertex weights instead of erasing
them. The tool never called the engine command that does the work; it re-sent the
whole rig from the editor's own copy, and that copy carries no weights at all —
so the one action whose entire job is computing weights was the action that
cleared them. Its two options are also gone: the engine has only ever had one
weighting method and ignores the iteration count, so offering a choice between
them described a control that did not exist. Sending one still works and still
weights the rig, and the result now says the option had no effect.

IK chains created by the AI now bend. Every one of them pointed at a target
entity that does not exist, on both sides of the bridge, and the solver skips any
constraint whose target it cannot find — so an IK chain could be created, listed
in the inspector, and never move a bone. The engine also built its chain out of
one bone name repeated, and read the chain length straight from the request as an
allocation size, which made an oversized number enough to take the engine down
for the session. Asking for a chain between two bones with no path between them
used to invent one; it now says so. A cycle in the bone hierarchy used to hang
the tab.

The target-entity field was published as a number everywhere it was documented —
in the command reference an assistant reads before composing a call — while the
engine has only ever held a text id. A model following the documentation
therefore produced a constraint the solver was always going to skip. It is a
string on both sides now, and the reference is checked against the code rather
than kept in step by hand.

The same limits are applied wherever a constraint is built, not only on the AI
path. Editing a rig in the inspector and importing one from a file both went
through a builder that had none of them, so a chain long enough to crash the
engine, a blend weight outside the range the solver understands, or a bend
direction that is neither left nor right could all still reach it from the
editor. Importing a rig is also no longer destructive. Storing a rig replaces
whatever the object had, and anything the importer did not understand — a
mistyped file, an export from another animation tool, a file that is not a rig at
all — was quietly turned into an empty rig and reported as a successful import.
So a bad file replaced a real rig with nothing and said it had worked. A file
that cannot be read is now refused, the reason names the part of it that is
wrong, and the rig already on the object is left alone. Formats the importer has
never been able to read are no longer offered in the first place.
