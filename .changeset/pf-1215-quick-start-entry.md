---
"web": minor
---

Add a visible "Make me a game" entry point to the editor. The game-creation
pipeline was previously reachable only when the AI chat's intent classifier
happened to route a message to it; there was no control anywhere in the UI that
started it. A quick-start dialog now runs the pipeline end to end, auto-approving
only the plan gate (the user already said yes to that by typing a prompt), while
`gate_assets` and `gate_final` still ask.
