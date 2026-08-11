---
"web": patch
---

Game component values authored by the AI are now range-checked against the
engine's own bounds before they are stored. A speed of a billion, a negative
gravity scale, a waypoint list of strings, or a loop mode the engine has never
heard of used to be kept verbatim by the editor while the engine quietly
simulated something else entirely, and nothing anywhere reported the
disagreement.

The inspector also reads game components correctly for the first time. The
engine sends each component in its own flat, tagged form, which the editor was
casting into a differently-shaped type — so every component the engine reported
arrived with an empty data bag, and the panel threw while rendering it rather
than showing the component at all. Attaching a component in the engine now shows
its real values in the inspector.
