---
"web": minor
---

Add a UGC takedown workflow for published games: viewers can report a game from
the play page, a reported game is automatically hidden pending review, admins
can list and act on the queue via `GET/POST /api/admin/moderation?type=game`,
and a game whose appeal is approved is restored to published.
