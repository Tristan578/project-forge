---
"web": minor
---

Add an intentional completion mode to games. A scene can now declare whether it is a classic goal-driven `win` game or an `endless`, `sandbox`, or `narrative` experience. Sandbox, endless, and narrative games are allowed to Play without a win condition, while win-mode games (and every existing scene, which defaults to `win`) still require a valid, satisfiable win condition. Malformed win conditions continue to be flagged in every mode, and the human Play button, the AI play action, and orchestrator verification all gate on the same authored mode.
