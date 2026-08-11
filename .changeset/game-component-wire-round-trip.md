---
"web": patch
---

Game component values authored by the AI are now range-checked against the
engine's own bounds before they are stored. A speed of a billion, a negative
gravity scale, a waypoint list of strings, or a loop mode the engine has never
heard of used to be kept verbatim by the editor while the engine quietly
simulated something else entirely, and nothing anywhere reported the
disagreement.
