---
"web": patch
---

The welcome wizard's "Start from Template" path now loads the chosen starter game through the editor store, completes onboarding only once the load has landed, and stays open with the store's error when it fails, instead of completing onboarding onto a blank scene. Its Platformer and Runner cards read their 2D/3D tag from the template registry (both are 3D games, not 2D). The "Build with AI" card follows the user's plan as it loads: it shows a pending state until the profile resolves, then the enabled or locked card, rather than a locked "Upgrade" card for a paying user on first render (#10156).
