---
"web": patch
---

Upgrade to eslint-plugin-react-hooks 7.1.1 and fix everything its three new rule
families found. The user-visible part is the editor Help menu: its arrow-key order
came from a ref array indexed by a counter mutated during render, so the order was
correct only by accident and would have silently mis-mapped had any item been
rendered conditionally. It now follows the menu's real DOM order.
