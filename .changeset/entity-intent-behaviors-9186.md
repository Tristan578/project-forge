---
"web": minor
---

Generated games now translate per-entity design intent into real behavior. The
game design document carries a closed `behavior` vocabulary (chase, patrol,
flee, idle, projectile_fire), and the pipeline turns each verb into an
engine-native component or a hand-written script template, so a generated enemy
chases, a guard patrols and a creature flees instead of standing where it
spawned. Also fixes the script generator's API reference, which advertised ten
methods that did not exist.
