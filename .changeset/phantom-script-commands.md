---
"web": patch
---

Seven `forge.*` script methods that dispatched commands the engine never
implemented are removed. A script calling `forge.physics.setVelocity`,
`forge.camera.lookAt` or the other five got no error and no effect; calling one
now throws where the author can see it, and a blocked command reaches the
in-editor script console instead of only the browser devtools.
