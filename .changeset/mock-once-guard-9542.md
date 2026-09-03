---
"web": patch
---

Test-suite hardening: a `mock*Once` value queued on a shared mock and never consumed now fails the test that queued it, naming the file and line still armed. Such leftovers used to stay armed and were silently read by the next test (#9501). The guard runs in every web test file and covers module-scoped `vi.fn` mocks, `vi.mock` factory mocks (including factories first triggered by a dynamic import inside a test) and bare automocks; it ignores mocks built inside the test and `vi.spyOn` spies. `MOCK_ONCE_GUARD=off` switches it off for a local run and is ignored under CI.
