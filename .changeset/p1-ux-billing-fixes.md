---
"spawnforge": patch
---

Fix Stripe refund TOCTOU race condition, add server-side AI tier gate, improve chat/editor UX

- Eliminate double-credit race in token refund deduction using CTE-based atomic SQL
- Add server-side starter tier block on /api/chat (was client-only)
- Show upgrade prompt for free-tier users in chat panel
- Add retry button on chat errors
- Hide canvas black rectangle during engine initialization
- Show browser/GPU requirements on WASM load failure
- Show 'Empty scene' guidance for first-time users
- Fix sprite-sheet status route for client-side imports
