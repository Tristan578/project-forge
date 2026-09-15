---
"web": patch
---

Prevent provider diagnostics from exposing credentials in API responses. Generation failures now return fixed, actionable messages while server monitoring retains the diagnostic details.

App Router route handlers now apply a shared response guard to supported text bodies, response headers, cookies and redirect locations. The guard checks JSON escapes and percent-encoded credentials, preserves responses that need no redaction, and verifies rewritten output before returning it. If redaction cannot complete safely, it returns a fixed error response and reports the failure instead of returning partially sanitized data.

The guard preserves legitimate one-time API key displays, signed asset download URLs and successful binary responses. Its documented limits remain: successful event-stream bodies are not redacted; framework-generated errors and metadata responses are outside the wrapper; percent-decoding before JSON-unescaping is not supported. Coverage tests enforce the wrapper on route handlers, and regression tests cover nested scene data, encoded credentials, response headers and failure paths.

Background generation failures now show persistent, deduplicated messages with retry guidance. Refund messages appear only after a refund succeeds.

See #9736 and the repository's security lessons for the implementation rationale and validation history.
