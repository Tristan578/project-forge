---
"web": patch
---

The Clerk webhook handler now verifies deliveries with Clerk's own `verifyWebhook()` instead of a hand-rolled `svix` verification, passing the signing secret explicitly. The deprecated `svix` dependency is removed. Behaviour on valid, invalid and unsigned deliveries is unchanged.
