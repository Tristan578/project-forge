---
"web": patch
---

Execute the distributed rate limiter's sliding-window Lua script in a real Lua VM under test, instead of only asserting the request we send to Upstash. The script's boundary arithmetic and `tonumber` coercions are now covered by tests that fail when the script changes.
