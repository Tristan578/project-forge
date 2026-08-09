---
"web": patch
---

fix(engine): drain the terrain command queues, and parent the level ground to the terrain that was actually spawned

Two defects on the 3D game-creation path, one on each side of the bridge.

The engine pushed every `spawn_terrain` / `update_terrain` / `sculpt_terrain` command onto a
`PendingCommands` queue that no system ever drained. The commands were accepted, acknowledged, and
discarded — live terrain creation was a silent no-op for the entire life of the feature. Three drain
systems now consume those queues, apply the noise config, rebuild the mesh, and emit
`TERRAIN_CHANGED`.

`create_level_layout` spawned the terrain and then read `primaryId` back out of the store to parent
the ground to it. `primaryId` is only set later, by an asynchronous engine event, so the read
returned whatever was selected *before* the spawn — the ground was parented to a stale entity, or to
none. `spawnTerrain` now returns the id it generated and the engine honours that id, so the handler
parents to the real terrain synchronously. This is the terrain variant of the mesh fix in #8748.

Also corrected while in the file:

- The `TERRAIN_CHANGED` payload flattened `TerrainData` to the top level while the web handler read a
  nested `terrainData`, so the terrain inspector stored `undefined` and rendered nothing. Both sides
  now assert against one shared fixture, and the event name is a single shared constant rather than a
  literal repeated across a boundary neither side can see across.
- The sculpt brush's falloff was inverted, weakening the effect at the brush centre instead of at its
  edge.
- Terrain resolution was unbounded and `resolution * resolution` was computed unchecked. `usize` is
  32-bit on wasm32 and the release profile does not enable overflow checks, so a large resolution
  wrapped silently in the shipped binary — at 65536 the product is exactly zero, which made every
  downstream `heights.len()` guard vacuous. The mesh builders now bound the resolution and check the
  multiplication.
- Both terrain commands snapped the requested resolution into `{32, 64, 128, 256}` before validating
  it. Asking for 100000 returned success and silently produced a 256-grid — the exact substitution the
  validator exists to refuse, defeated before it ever ran, and a cap four times lower than the mesh
  builder actually supports. An out-of-range resolution is now rejected with a message naming the
  supported range, and an in-range one is carried through verbatim.
- `spawn_terrain` from chat reported success even when the engine had not finished loading and nothing
  was dispatched, and never returned the new entity's id. A follow-up "now sculpt it" had nothing to
  target. It now returns the id, and reports the not-ready case as a failure.
- The sidebar and mobile toolbars discarded the result of adding an entity, so a click before the
  engine finished loading closed the menu, added nothing, and said nothing. Both now surface the
  reason.
- Caller-supplied entity ids were interpolated into warning logs at full length. They are now
  truncated before logging.
- `spawnEntity('terrain')` dropped the caller's `name` argument entirely, so every named terrain came
  back as the engine's auto-generated "Terrain (n)". The name is forwarded now.

The engine half ships as WASM and is not live until the next engine build reaches the CDN.
