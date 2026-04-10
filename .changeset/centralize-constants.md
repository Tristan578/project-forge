---
"web": patch
---

Centralize hardcoded constants: migrate remaining timeout, provider, and scope consumers to shared config modules. Adds 7 new timeout constants, wires magic-constants check into pre-push hook, and replaces hardcoded provider strings across 10+ API routes with DB_PROVIDER/DIRECT_CAPABILITY_PROVIDER imports.
