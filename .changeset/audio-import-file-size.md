---
"web": patch
---

Audio imports now retain their decoded file size in the engine asset registry
and report that size to the editor. Imported audio previously appeared as zero
bytes regardless of its actual size, preventing the asset panel from displaying
accurate metadata or warning about large files.
