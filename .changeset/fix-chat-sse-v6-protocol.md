---
"web": patch
---

Fix AI chat replies rendering blank and tool calls never executing: the client SSE parser now reads the AI SDK v6 `UIMessageChunk` protocol (hyphenated chunk types, `delta`/`errorText`/`messageMetadata` fields) that `/api/chat` actually emits, instead of a dead underscored protocol. Also closes an approval-mode bug where streamed tool calls auto-executed without user consent — approval mode now always previews and waits.
