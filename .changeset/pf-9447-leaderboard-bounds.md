---
"web": patch
---

Leaderboard score submissions are now bounds-checked before they reach the database. A score outside the range a Postgres `integer` column can hold, or a `metadata` object that is larger than 4 KiB or nested more than 32 levels deep, comes back as a `400` with a message naming the limit. Previously those requests were accepted by the handler, refused by the database mid-insert, and returned to the player as a generic `500` — which also filed a spurious error report on every attempt, on a route that needs no sign-in.
