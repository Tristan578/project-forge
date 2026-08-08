---
"web": patch
---

Pixel-art generation no longer reports a job `completed` when the provider delivered no image. Completion is now derived from the artifact actually returned rather than from the absence of a prediction id, both provider clients reject an empty response, and an empty artifact surfaces as a 503 naming what is missing — with tokens refunded — instead of a 201 the client cannot poll.
