---
"web": patch
---

Fix sprite generation status route hanging for 5 minutes on an empty Replicate result. When Replicate reports `succeeded` with no output image, the route now returns `failed` with a clear "produced no image" message so the client refunds immediately instead of polling to the timeout cap.
