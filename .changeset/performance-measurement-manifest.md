---
"web": minor
---

Add a versioned measurement manifest alongside captured performance reports. Capture report snapshots existing profiler statistics with available build identity, OS, browser major version, active render backend, viewport, device memory and sample count. Manifest metadata that cannot be determined is shown as "unknown"; fixture identity, cache state and GPU/driver information remain unknown until supplied by a measurement harness. Capturing a report does not establish a performance budget pass.
