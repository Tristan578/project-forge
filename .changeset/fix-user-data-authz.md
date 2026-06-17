---
"web": patch
---

Harden moderation-appeal authorization and complete the GDPR data export.

- `POST /api/moderation/appeal` now verifies the authenticated user owns the
  referenced content (comment/game/asset) before filing an appeal, returning
  404 (not 403, to avoid disclosing existence) when they do not. `contentId` is
  now validated as a uuid so malformed ids are rejected with 400 instead of
  surfacing as a 500. (#8613)
- `POST /api/admin/moderation/appeals/[id]/review` re-confirms the appellant
  authored the comment before clearing its `flagged` state (defense-in-depth).
- `GET /api/user/export-data` now includes the previously-omitted user-owned
  tables: game comments, ratings, likes, follows, forks, marketplace listings,
  asset purchases, asset reviews, the seller profile, and moderation appeals.
  (#8639)
