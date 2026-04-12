---
'web': minor
---

Add shared `RouteErrorBoundary` primitive and wire it across the editor, dashboard, settings, admin, community, and play routes. Each boundary now reports to Sentry with a `route` tag and `digest`, exposes an accessible `alert` live region, and masks raw error messages in production while appending them in development.
