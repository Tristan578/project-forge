---
"web": minor
---

Implement `forge.i18n` translation lookup and locale selection in the editor's
script worker. Add the `forge.leaderboard` namespace and async channel so calls
reject with an actionable error instead of accessing an undefined namespace.
Leaderboard submission and reads remain unavailable in running games: the editor
has no published identity, and published play pages do not yet host this worker.
Published worker integration remains tracked by #9856.
