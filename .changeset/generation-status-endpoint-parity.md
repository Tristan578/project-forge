---
"web": patch
---

Fix `get_generation_status` returning a false "Could not find generation job"
for valid `pixel-art`, `sprite_sheet`, and `tileset` jobs (#8762). The chat
tool's hand-maintained type→status-route map had drifted from the auto-poller's
(`useGenerationPolling`), omitting the three types added since. Both now consume
a single exported `STATUS_ENDPOINTS` source of truth in
`@/lib/generation/statusEndpoints`, and a unit test pins the type set so any
future generation type that is added to one consumer but not the map fails CI.
