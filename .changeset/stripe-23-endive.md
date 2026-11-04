---
"web": patch
---

Upgrade the Stripe Node SDK from 22.6.2 to 23.1.0, which pins Stripe API version `2026-10-28.endive` (previously `2026-08-26.dahlia`). Endive is a breaking-change release line; its one removal relevant to Checkout, the `payment_method_types` parameter on Checkout Sessions, is not used by this app.
