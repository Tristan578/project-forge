---
"web": patch
---

Improve keyboard navigation and accessible names, states, and focus for the Scene Hierarchy and Inspector chrome. SceneSettings form-control accessibility remains deferred. Hierarchy rows now use a roving tabindex with Home/End jumps, arrow navigation moves real focus, and Enter selects the focused entity. Every icon-only control in the hierarchy, inspector, search box, and inspector error boundary gains a visible focus ring and an accessible name, the inspector name field is properly labelled, and pressing Escape while renaming discards the unconfirmed edit instead of saving it. Collapsible inspector section headers no longer nest their action buttons inside the toggle button, so copy/paste no longer collapses the section and the markup passes accessibility checks.
