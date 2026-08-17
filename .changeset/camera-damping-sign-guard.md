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
`from_flat`.

Because `set_game_camera` is full-replace, that engine-side tightening needs a
matching screen on the browser side or one bad rate would take `mode`,
`targetEntity` and `offset` down with it. Both write paths into the wire
`damping` key now share one predicate, and the actionable signal moved to the
input surfaces: the inspector's Smoothing field carries a real floor (the `min`
attribute alone is advisory — a typed value still fires `change`), and the chat
tool rejects a negative rate with a validation error naming the field instead of
dropping it silently. `0` stays a legitimate authored value everywhere — it
means "never move", not "absent".

Camera config keys that do not reach the engine are also now reported by reason:
an unrecognized key, a value the engine cannot take, and a duplicate spelling
each get their own sentence, where all three previously shared one that named
only the first.
