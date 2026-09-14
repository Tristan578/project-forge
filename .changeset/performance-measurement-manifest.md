---
"web": minor
---

Add a versioned performance-measurement manifest that pins each captured report to the machine and build it was taken on — build SHA, fixture checksum, OS, exact browser version, GPU/driver, render backend, viewport, device memory, warm/cold cache state and sample count. The performance profiler now has a Capture report button that snapshots the live stats alongside this manifest, and any metric the browser cannot expose is recorded and displayed as "unknown" rather than silently becoming zero or a passed budget.
