---
"web": patch
---

Size the `/api/vitals` rate limit against the beacons a page view actually sends. The endpoint allowed 10 requests per minute per IP while its own client emits one beacon per Core Web Vital per page view, so a visitor's third page view inside a minute was silently dropped and anyone behind a shared egress IP lost telemetry almost immediately.
