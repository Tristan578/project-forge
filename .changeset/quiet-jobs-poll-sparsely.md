---
"web": patch
---

Use durable generation callbacks as the primary completion channel when QStash is configured. Durable jobs now perform one immediate status read, recheck when the editor regains focus, and use a 30-second capped safety cadence, while deployments without QStash retain the existing 3-second polling loop and all refund behavior.
