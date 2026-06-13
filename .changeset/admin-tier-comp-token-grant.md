---
"web": patch
---

Grant the new tier's full monthly token allocation (and write a credit_transactions audit row) when an admin changes a user's tier via PATCH /api/admin/users/[id]. Previously a comped paid tier wrote the tier column alone with no tokens, leaving the user with a zero balance and blocked at every AI generation route — the paid-only alpha core journey never started.
