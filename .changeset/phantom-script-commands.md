---
"web": minor
---

**Breaking for scripts.** Seven `forge.*` methods that dispatched commands the
engine never implemented are removed: `forge.physics.setVelocity`,
`forge.physics2d.setVelocity`, `forge.physics2d.setAngularVelocity`,
`forge.camera.setPosition`, `forge.camera.lookAt`,
`forge.skeleton2d.stopAnimation` and `forge.skeleton2d.setIkTarget`. Each
already did nothing — the command was accepted and discarded — so no behaviour
changes, but a script that calls one now throws a `TypeError` where the author
can see it instead of failing silently. There is no replacement: use
`applyForce` / `applyImpulse` for velocity, and the `camera` commands for the
camera.

`forge.setScale(entityId, x, y, z)` is **added**. It was the opposite case —
`update_transform` has always carried an optional scale, and the shipped Arena
Shooter template already called the method, which simply did not exist.

Three script-console messages that were written to a channel the console never
read — an engine command refusal, the infinite-loop watchdog, and a command
blocked by the allowlist — are now displayed.

The `forge.*` conformance gate now also covers the Template Gallery, the
`/api/chat` system prompt and `docs/reference/script-api.md`. That found all six
2D starter templates to be non-functional; they are recorded and tracked at
#9763, not fixed here.
