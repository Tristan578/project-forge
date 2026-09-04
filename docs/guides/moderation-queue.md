# Moderation queue — operator runbook

How to grant yourself moderator access, work the reported-games queue, and
handle appeals. Covers the UGC game-moderation system shipped in #8354
(PF-681).

There is **no admin UI** for this yet. Every action below is an authenticated
HTTP call against the app's own API. `web/src/app/admin/` contains only the
economics dashboard.

---

## 1. Grant moderator access

Admin authority is a comma-separated allowlist of **Clerk user ids** in the
`ADMIN_USER_IDS` environment variable, checked by `assertAdmin()` in
`web/src/lib/auth/api-auth.ts`. There is no admin role in the database and no
UI that grants it.

```bash
# Find the Clerk id (starts with `user_`) for the person you are promoting.
# Clerk Dashboard -> Users -> the user -> "User ID", or:
curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  "https://api.clerk.com/v1/users?email_address=someone@example.com" \
  | python3 -c 'import json,sys; print([u["id"] for u in json.load(sys.stdin)])'
```

Then set the variable for the environment you are granting access in:

```bash
# Production
vercel env add ADMIN_USER_IDS production --scope tnolan
# Value: user_2abc...,user_2def...   (comma-separated, no spaces needed)
```

Notes that matter:

- **The value is read at request time from `process.env`, so a change needs a
  redeploy** — Vercel only injects new env values into new deployments.
- An empty or unset `ADMIN_USER_IDS` means *nobody* is an admin; every admin
  route returns `403 Forbidden`. That is the safe default, and it is what a
  fresh preview environment has.
- Whitespace around ids is trimmed; empty entries are dropped.
- Set it separately per environment. Preview and production do not share it.

Verify before you rely on it:

```bash
curl -s -i -H "Cookie: $SESSION_COOKIE" \
  "https://spawnforge.ai/api/admin/moderation?type=game&limit=1"
# 200 -> you are an admin. 403 -> you are not (check the id and redeploy).
```

All admin moderation routes are rate limited to **10 requests per 60 seconds
per admin user** (`rateLimitAdminRoute`, `RATE_LIMIT_ADMIN_MAX` /
`RATE_LIMIT_ADMIN_WINDOW_MS` in `web/src/lib/config/timeouts.ts`). A `429`
while working a backlog is the limiter, not an outage — wait out the window.

---

## 2. How a game gets into the queue

A signed-in viewer reports a published game from the play page
(`ReportGameDialog`). `POST /api/community/games/[id]/report` records the
report and, in the same statement, may auto-hide the game.

A game is auto-hidden when **`REPORT_AUTOHIDE_THRESHOLD` (currently 3) distinct
reporters** have reported it *since its last moderator review*. Auto-hide sets:

| Column | Value |
|---|---|
| `published_games.status` | `'flagged'` |
| `published_games.flagged_at` | `now()` — the moderation **hold** |
| `published_games.report_count` | the running count of distinct reporters |

`flagged_at` is the load-bearing field. `POST /api/publish` refuses to
republish any row of the same project while it is non-NULL, so clearing it —
not the status — is what actually returns control to the creator.

Guards that sit in front of the queue (all in the report route):

- self-reports are rejected (`403 SELF_REPORT`);
- per-reporter rate limit: 5 reports / 60s;
- per-game rate limit: 10 reports / hour across all reporters, so a brigade is
  bounded in wall-clock time rather than in accounts;
- Vercel BotID gate;
- a unique index on `(game_id, reporter_id)` makes a repeat report from the
  same account a no-op, so one account can never reach the threshold alone.

The counts are **per review cycle**: an approve or a won appeal resets
`report_count` to 0. Without that reset any threshold above 1 would be
decorative after a game's first review.

---

## 3. Work the queue

### List reported games

```bash
curl -s -H "Cookie: $SESSION_COOKIE" \
  "https://spawnforge.ai/api/admin/moderation?type=game&limit=50&offset=0"
```

```jsonc
{
  "items": [
    {
      "id": "…uuid…",          // published_games.id — what you POST back
      "type": "game",
      "gameId": "…uuid…",       // same value; the comment queue also uses `id`
      "title": "…",
      "slug": "…",
      "authorId": "…",
      "authorName": "…",
      "authorEmail": "…",
      "reportCount": 3,
      "flaggedAt": "2026-09-01T12:00:00.000Z"
    }
  ],
  "total": 137,                 // QUEUE DEPTH, not the page size
  "hasMore": true
}
```

`total` is a separate `COUNT(*)` over the whole queue, so it is the number to
watch for backlog. Newest holds sort first (`ORDER BY flagged_at DESC`).

Omit `type` (or pass `type=comment`) for the flagged-comment queue, which has
the same shape.

The queue does not carry the individual reports. To see the reasons behind a
hold, query the database directly:

```sql
SELECT reason, details, created_at
FROM game_reports
WHERE game_id = '…uuid…'
ORDER BY created_at DESC;
```

Reasons are one of `sexual_content`, `violence`, `hate_speech`, `copyright`,
`spam`, `other` (`GAME_REPORT_REASONS` in `web/src/lib/config/moderation.ts`).

### Decide: approve or delete

Both go to `POST /api/admin/moderation` with `{ id, type: 'game', action }`.

**`approve` — the reports were wrong; lift the hold.**

```bash
curl -s -X POST -H "Cookie: $SESSION_COOKIE" -H 'Content-Type: application/json' \
  -d '{"id":"…uuid…","type":"game","action":"approve"}' \
  "https://spawnforge.ai/api/admin/moderation"
# -> {"success":true,"action":"approved","type":"game","status":"published"}
```

Clears `flagged_at`, resets `report_count` to 0, and returns the game to
`published` **only if it was still `flagged`**. If the creator unpublished it
while it sat in the queue, the response comes back with
`"status":"unpublished"` — the hold is lifted (they can republish) but the game
stays down, which is the creator's own choice and not yours to reverse.

`404 {"error":"No held game with that id"}` means no row with that id has a
hold. Either it was already approved, or you have the wrong id.

**`delete` — the reports were right; take it down.**

```bash
curl -s -X POST -H "Cookie: $SESSION_COOKIE" -H 'Content-Type: application/json' \
  -d '{"id":"…uuid…","type":"game","action":"delete"}' \
  "https://spawnforge.ai/api/admin/moderation"
# -> {"success":true,"action":"deleted","type":"game"}
```

This is a **soft** removal: `status` becomes `'unpublished'` and `flagged_at`
is deliberately left in place as the takedown record. The row is never deleted
— `game_comments`, `game_ratings`, `game_likes` and `game_reports` all hold
NOT NULL foreign keys to `published_games.id` with no `ON DELETE CASCADE`.

Because `flagged_at` survives, **the creator stays blocked from republishing
that project**. That is the enforcement. The only ways out are an admin
`approve` or a won appeal.

### The one-play-session caveat

Auto-hide and takedown stop the game being *served*: the gallery and
`GET /api/play/[userId]/[slug]` both filter on `status = 'published'`. A viewer
who already loaded the page keeps the session they have — the engine is not
torn down mid-play.

At the edge the hide is **not** instant. Both read routes are `force-dynamic`
with hand-set cache headers (play: `s-maxage=30, stale-while-revalidate=120`;
gallery: `s-maxage=60, stale-while-revalidate=300`), so a cached response can
still be served for up to **150s (play) / 360s (gallery)** after the database
row changes. A `force-dynamic` handler has no Next.js cache entry, so
`revalidatePath()` does not shorten this — closing the window means changing
those two routes' cache headers, which is a latency trade-off on the hottest
read path. See the "KNOWN WINDOW" docblock in
`web/src/app/api/community/games/[id]/report/route.ts`. For content that must
stop being reachable *right now*, take the game down and then purge the CDN
edge cache for those paths out of band.

---

## 4. Appeals

A creator whose game was hidden files `POST /api/moderation/appeal` with
`{ contentId, contentType: 'game', reason }`. `contentId` is the
`published_games.id`, and the route enforces that the appellant owns it.

### List pending appeals

```bash
curl -s -H "Cookie: $SESSION_COOKIE" \
  "https://spawnforge.ai/api/admin/moderation/appeals?status=pending&limit=50"
```

`status` accepts `pending` (default), `approved`, or `rejected`.

### Review one

```bash
curl -s -X POST -H "Cookie: $SESSION_COOKIE" -H 'Content-Type: application/json' \
  -d '{"decision":"approve","note":"False reports — no policy violation."}' \
  "https://spawnforge.ai/api/admin/moderation/appeals/<appealId>/review"
```

```jsonc
{ "success": true, "action": "reviewed", "status": "approved", "gameRestored": true }
```

**Check `gameRestored`.** `status: "approved"` only says the appeal row was
marked approved. `gameRestored: false` means the restore statement matched no
row — the creator has been told they won and their game is still held. The
server also logs a warning in that case. Investigate before replying to the
creator: the usual causes are an appeal whose `contentId` names a game the
appellant no longer owns, or a hold that had already been lifted.

`gameRestored` is absent (not `false`) when the appeal's `contentId` is not a
uuid, because the restore never runs at all.

`decision: "reject"` marks the appeal rejected and touches nothing else — the
game stays hidden and the hold stays in place.

An already-reviewed appeal returns `409`. Appeals are decided once.

---

## 5. Quick reference

| Action | Call |
|---|---|
| Game queue | `GET /api/admin/moderation?type=game` |
| Comment queue | `GET /api/admin/moderation?type=comment` |
| Restore a game | `POST /api/admin/moderation` `{id, type:'game', action:'approve'}` |
| Take a game down | `POST /api/admin/moderation` `{id, type:'game', action:'delete'}` |
| Pending appeals | `GET /api/admin/moderation/appeals?status=pending` |
| Decide an appeal | `POST /api/admin/moderation/appeals/<id>/review` `{decision}` |

| Knob | Value | Where |
|---|---|---|
| Auto-hide threshold | 3 distinct reporters per review cycle | `REPORT_AUTOHIDE_THRESHOLD` |
| Per-reporter limit | 5 / 60s | `REPORT_RATE_LIMIT_MAX` |
| Per-game limit | 10 / 3600s | `REPORT_PER_GAME_RATE_LIMIT_MAX` |
| Admin route limit | 10 / 60s per admin | `RATE_LIMIT_ADMIN_MAX` |

The first three live in `web/src/lib/config/moderation.ts`, the last in
`web/src/lib/config/timeouts.ts`. None of them is an environment variable, on
purpose: a threshold that differs between preview and production makes
moderation behaviour untestable, and a typo'd env value would silently disable
auto-hide entirely. Changing one is a code change and a deploy.
