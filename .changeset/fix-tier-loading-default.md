---
"spawnforge": patch
---

Fix Pro model dropdown disabled for Pro users on first paint. The user's tier
defaulted to `'starter'` until the profile API resolved, causing the chat input
to incorrectly disable premium models. Now `EditorLayout` calls `fetchProfile`
on mount, and the dropdown only enforces the tier gate after `profileLoaded` is
true.
