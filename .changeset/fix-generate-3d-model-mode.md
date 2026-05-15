---
'web': patch
---

Fix `generate_3d_model` and `generate_3d_from_image` chat handlers always returning HTTP 400. Both omitted the required `mode` field on the request body to `/api/generate/model`. The route's validator hard-requires `mode ∈ {text-to-3d, image-to-3d}`, so every text-to-3D call from chat failed before reaching Meshy. Closes #8544.
