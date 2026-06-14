---
"web": patch
---

Fix exported games receiving no keyboard/mouse input. The event callback embedded in the export bundle was wired to a contract the engine never speaks: a 2-arg `(eventType, eventPayload)` signature with `JSON.parse` (the engine sends a single `{ type, payload }` object), a dead `INPUT_STATE_CHANGED` event (input is delivered inside `PLAY_TICK` as `payload.inputState`), and a transposed action-keyed snake_case read of the input state (the engine emits field-keyed camelCase `pressed`/`justPressed`/`justReleased`/`axes`). All three are now corrected across the single-HTML and ZIP export paths, so exported games respond to input.
