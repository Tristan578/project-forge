---
"web": patch
---

Test-suite hardening: a `mock*Once` value queued on a shared mock and never consumed now fails the test that queued it, naming the file and line. Such leftovers used to stay armed and were silently read by the next test (#9501); the guard runs in every web test file, ignores mocks built inside the test, and can be switched off with `MOCK_ONCE_GUARD=off`.
