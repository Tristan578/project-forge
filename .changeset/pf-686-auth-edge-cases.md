---
'@spawnforge/web': patch
---

fix(auth): catch Clerk token throws and enforce banned flag

- `authenticateRequest` and `authenticateClerkSession` now wrap `auth()` in try/catch so expired/malformed tokens return 401 instead of propagating as 500.
- Both helpers now reject banned users (`users.banned > 0`) with 403 ACCOUNT_BANNED. Previously the column was unused and banned users could access any authenticated route.
- `attemptSyncWithRetry` detects Clerk 404 and returns early without retrying — closes a 500ms timing side-channel that distinguished deleted users from DB flakes.
- Adds a schema-locking test that fails if a future refactor adds `banned` to `syncUserFromClerk`'s `onConflictDoUpdate.set()` block (which would silently unban users on re-sync).
