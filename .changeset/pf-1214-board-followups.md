---
"web": patch
---

Generated players now jump a distance a person would recognise as a jump.

Every path that tuned a character controller from a physics preset passed the
preset's unitless `jumpForce` dial straight into `jumpHeight`, which the engine
reads as a real height in metres. The default preset therefore asked for a
ten-metre apex with close to three seconds of hang time. The dials are now
converted to heights through one shared calibration, and the presets that jump
land between roughly half a second and one and a half seconds of airtime.

`forge.physics.isGrounded` works in an exported game. It was documented and
typed but the exported runtime never exposed it, so a script that ran in the
editor threw as soon as the game was published. The event handler both exporters
install is now generated once rather than written out twice, which is what let
the two drift apart in the first place.

Ground contact reported before the script worker starts is no longer discarded,
so a character standing on the floor at the moment play begins is grounded to a
script immediately instead of only after its next landing.

The kinematic controller gained a coyote window and a jump buffer, carries a
player standing on a moving platform, bounds upward velocity as well as
downward, and reports characters it had to skip for having no collider.
