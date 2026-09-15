---
"web": patch
---

Add win-condition outcome tests for the six 2D starter templates and repair the 2D puzzle starter. Each 2D starter is now asserted to enumerate under its category, declare a reachable win/score/progress outcome, call only `forge.*` symbols that exist in the scripting API, and wire its game loop to input actions (2d.FR-2.OP-01/OP-02). The Match-3 puzzle starter, which relied on a mouse-and-material scripting API the sandbox never exposed and so never advanced its game loop, is rewritten as a working keyboard-driven match-3 that reaches a real win.
