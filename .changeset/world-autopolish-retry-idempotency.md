---
"web": patch
---

Prevent duplicate entities when spawn or transform confirmation is delayed. Confirmation timeouts stop automatic retries because an accepted spawn may still apply after the observation deadline. On repeated invocations, `world_build` reuses positively observed entities, and `auto_polish` uses a reserved ground-plane id with the same observation guard. A missing cached observation does not prove that an earlier spawn failed.
