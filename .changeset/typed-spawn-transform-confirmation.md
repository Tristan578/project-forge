---
"web": minor
---

Game-creation steps can query entity state before reporting success. The observation adapter checks the latest cached `QUERY_ENTITY_DETAILS` response against entity-presence or transform predicates, with a five-second deadline and cancellation support. Missing or mismatched observations time out.

The returned result carries the caller's operation label and entity ID. These labels do not correlate an engine response to a particular command or prove that the cached response is fresh. World-build and auto-polish compare observed position and scale with the requested values using an f32 tolerance; this is observation evidence, not a command acknowledgement. Contexts without a query capability retain the existing command-acceptance and frame-wait path.
