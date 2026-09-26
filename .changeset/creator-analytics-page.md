---
"web": minor
---

Creators can now see how their games are doing. A new Analytics page, reached from the dashboard header, shows how many of your games are live, total plays, your token usage this billing cycle, and plays for each game, most played first. It is backed by a new signed-in `GET /api/creator/stats` endpoint that only ever returns your own numbers.
