---
"web": patch
---

The engine's command vocabulary now describes what the engine actually does.

Twenty command names were routed to a domain that had no handler for them, so
anything that called one — chat, a tool, the generation pipeline — got back
"unknown command" for a name the surface advertised as real. Names with no
implementation behind them have been removed; the ones worth keeping
(`get_sprite`, `get_camera_2d`, `get_joint_2d`, `list_joints_2d`) are now
answered. A test walks the router against every domain's own handlers, so a
name can no longer be advertised without being reachable, and a name can no
longer be routed to the wrong domain where a stub shadows a working handler.

The ten tilemap tools now declare the parameters their handlers really read.
Every one of them documented at least one wrong name — a tileset id, a layer
index, a fill rectangle — so a model following the tool description supplied
arguments that were silently discarded and the edit did nothing. The
descriptions and the validation are now the same list, pinned by a test so they
cannot drift apart again.

Reading a 3D joint back from the engine works. The reply to a joint list
request had no listener, so the editor asked and nothing ever arrived.

Painting, erasing or filling a tile at a coordinate far outside the map no
longer writes to an unrelated cell. On the 32-bit WebAssembly target the
coordinate arithmetic could wrap back into range, so an out-of-bounds edit
landed on a real tile somewhere else in the map instead of being skipped.

Two identical `get_tilemap` handlers were registered, and which one ran depended
on registration order. The remaining one is the one that rejects a malicious
entity id rather than returning an internal object as tilemap data.
