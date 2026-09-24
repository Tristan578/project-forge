---
"web": patch
---

The editor engine now initializes reliably in development. Under React's development-mode effect replay the engine hook marked itself initialized before the asynchronous WASM load, its cleanup cancelled that load, and the replayed effect saw the mark and returned, so the viewport could sit on "Starting engine..." while the same build booted in production. Initialization now has explicit ownership: an attempt retired before `init_engine` releases its claim so the replay starts the one real attempt (reusing the in-flight download), and an attempt that reached `init_engine` keeps the canvas so nothing can start Bevy twice.
