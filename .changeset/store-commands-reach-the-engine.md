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

A new test scans every command name the editor dispatches and fails if one has
no working engine arm behind it, so the next one cannot ship silently. Names
that are genuinely waiting on engine work are listed explicitly with a ticket,
and the list fails if an entry becomes implemented or stops being used — it
cannot quietly grow stale.
