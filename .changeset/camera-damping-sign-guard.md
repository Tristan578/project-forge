---
"web": patch
---

Refuse a negative camera follow damping instead of sending it to the engine.

The engine follows with `t = (damping * delta).min(1.0)` and then
`translation.lerp(target, t)` — `t` is capped above but never below, so a
negative rate is a negative lerp factor: the camera extrapolates away from its
target every frame and the gap compounds (~16x per second at 60fps with -3),
putting the camera somewhere unreachable within two seconds. It was accepted by
the GDD camera translator, sent, and reported as applied.

The rate is now rejected at both boundaries — `flat_damping` on the command path
and a floored `follow_lerp_factor` at each consume site, because `.forge` scene
files deserialize straight into the camera struct without passing through
`from_flat`. On the TypeScript side, camera config keys that do not reach the
engine are now reported by reason: an unrecognized key, a value the engine
cannot take, and a duplicate spelling each get their own sentence, where all
three previously shared one that named only the first.
