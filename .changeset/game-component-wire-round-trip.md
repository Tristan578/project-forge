---
"web": patch
---

Game component values authored by the AI are now range-checked against the
engine's own bounds before they are stored. A speed of a billion, a negative
gravity scale, a waypoint list of strings, or a loop mode the engine has never
heard of used to be kept verbatim by the editor while the engine quietly
simulated something else entirely, and nothing anywhere reported the
disagreement.

The inspector also reads game components correctly for the first time, and this
half is the more visible one: the Game Components panel was replaced by a "failed
to render" message whose Retry button re-rendered the same crash. The engine sends
each component in its own flat, tagged form, which the editor was casting into a
differently-shaped type, so every component the engine reported arrived with no
data bag at all — not an empty one, an absent one — and the panel threw the
moment it read a field off it. Any add, update or removal
of a game component put the panel into that state. Attaching a component now shows
its real values in the inspector.
