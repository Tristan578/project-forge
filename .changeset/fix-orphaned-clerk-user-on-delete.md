---
"web": patch
---

Fix account deletion leaving an orphaned Clerk identity. `POST /api/user/delete` purged all DB data but never deleted the Clerk user, so the Clerk session/user survived and the next authenticated request re-synced a fresh empty DB user — silently resurrecting the "deleted" account. The route now deletes the Clerk identity after the DB purge, in its own try/catch: the DB delete is the privacy-critical step and runs first (a failure 500s and keeps the Clerk user intact), while a Clerk-side failure after the DB commit reports success and captures to Sentry for manual cleanup rather than 500ing (#8606).
