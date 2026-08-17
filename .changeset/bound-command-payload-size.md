---
"web": patch
---

Reject command payloads that are nested too deeply, or that carry more objects and arrays than the engine can convert, before they cross into WASM. A deeply nested payload previously overflowed the stack during the recursive JS-to-Rust conversion, which on wasm32 is an unrecoverable trap that kills the engine instance for the rest of the session. Bulk data is unaffected — a full-size tilemap is millions of values but only a handful of containers, and only containers count toward the bound.
