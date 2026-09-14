---
"web": minor
---

Implement the `forge.i18n` and `forge.leaderboard` script namespaces so game scripts can call them without crashing. `forge.i18n.t`/`setLocale`/`getLocale`/`getAvailableLocales` resolve synchronously against the project's locale bundles, and `forge.leaderboard.submit`/`getTop` route through a new async channel backed by the published-game leaderboard API (returning a clear "only available when playing a published game" error where no published identity exists, such as in-editor test play).
