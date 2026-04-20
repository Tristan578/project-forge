---
"web": patch
---

Fix test suite reliability: add @testing-library/user-event devDependency, add @spawnforge/ui source alias in vitest configs to eliminate build-order flakiness in WelcomeModal, Sidebar, and EditorLayout tests. Security: upgrade @clerk/nextjs to ^7.2.1 and add protobufjs/@clerk/shared overrides to address GHSA-vqx2-fgx2-5wq9 (critical Clerk route-protection bypass) and GHSA-xq3m-2v4x-88gg (protobufjs arbitrary code execution).
