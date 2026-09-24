---
"web": minor
---

Add an opt-in isolation boundary for in-editor game scripts (#8700). With `NEXT_PUBLIC_SCRIPT_ISOLATION=sandboxed-origin` set at build time, scripts run in the same worker code but inside a hidden `sandbox="allow-scripts"` iframe with its own `connect-src 'none'` policy, so a script that escapes the name shadowing gets an opaque origin with no cookies and cannot make any network request, whether or not the network globals were revoked first. The default (`revoke`, or any value other than the exact strings `sandboxed-origin` / `ast`) is unchanged. `ast` is reserved and currently runs the sandboxed transport with a notice in the script console.
