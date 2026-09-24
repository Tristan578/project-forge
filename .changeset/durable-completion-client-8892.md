---
"web": patch
---

Show a generation that finished while the tab was closed as finished (#8892).

When QStash callbacks are configured, the server finalizes a generation job's row with no tab open, but the editor never read that row: it listed only live jobs on reload, so an asset that completed in the background simply vanished from the queue, and the 30-second safety poll for durable jobs still asked the provider instead of the row the callback had already written.

- `GET /api/jobs?status=active` now also returns durable jobs the callback finished (completed or failed) that no client has reflected yet, and reports `durableCompletionEnabled` (a boolean only).
- `GET /api/jobs/[id]` returns the whole owned row in the list shape (status, artifact, texture maps, error), not just the artifact; a row with no artifact is `resultUrl: null` rather than a 422.
- On load, such a job is imported (or refunded and marked failed, with the server's message) from its row, without starting a poll loop, and the row is marked reflected so it does not come back on the next reload.
- A durable job's poll reads its own row before the provider status route and stops as soon as the row is terminal; a transient failure falls through to the provider read as before. With QStash unset, nothing changes.
