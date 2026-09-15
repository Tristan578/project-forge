---
"web": patch
---

Prevent game creation from repeating accepted spawn operations when engine confirmation times out. The pipeline now reports the unresolved result and preserves existing entities instead of automatically creating duplicates.
