---
"web": patch
---

Fix flaky exportAbortSignal test that intermittently reported unhandled rejection errors in CI by attaching promise rejection handlers before advancing fake timers
