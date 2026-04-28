---
'web': minor
---

Auto-wire completed AI generation jobs into the target entity. When a model, texture, or audio job finishes with `autoPlace` set, the result is fetched and dispatched to the editor automatically — textures land on the requested material slot, audio attaches to the requested entity, models import alongside the placeholder. Idempotent across page refresh via `appliedAt`. Closes #8540.
