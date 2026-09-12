---
"web": minor
---

Enable PostHog session replay, with the one rendered credential masked.

Replay has been available the whole time and was never switched on, so we have had no visibility into what a user actually did in a canvas-heavy editor before abandoning a session. It inherits the existing cookie-consent gate: `initPostHog` returns before `init()` unless the visitor accepted, so nothing records beforehand.

Inputs are masked explicitly rather than by relying on the SDK default, and the API key shown once on creation is marked `ph-no-capture` — `maskAllInputs` does not cover it, because the key is rendered as text rather than typed.

Surveys needed no change: they ship in the main bundle and the CSP already admits the assets host that serves them.
