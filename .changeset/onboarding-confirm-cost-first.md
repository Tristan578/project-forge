---
"web": minor
---

"Make me a game" now asks before it spends build tokens. After you describe your game, "Plan my game" designs it and shows the plan with its estimated token cost. The build starts, and its tokens are taken, only when you press "Build it". "Discard plan" asks once, then drops the plan (designing it again costs tokens), and "Close" keeps it so reopening the dialog brings you back to it. Building from the orchestrator panel works the same way: tokens are taken when the build starts, not while the plan waits. If the server declines to start a build, no build tokens are taken and the plan stays in the review with the reason and what to do next: a link to buy tokens for a short balance, or a plain explanation for an expired session, a rate limit, or an account problem. If the server's answer cannot be confirmed, the build stops and asks you to check your balance before trying again.

For a first-time user who picked "Build with AI" in the welcome wizard, onboarding now counts as complete only once that build finishes. If it fails or is cancelled, or the dialog is closed before a plan exists, the welcome wizard comes back.
