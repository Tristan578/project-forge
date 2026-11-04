---
"web": patch
---

A page path that no route serves now shows the site's 404 page with status 404, instead of redirecting to sign-in. Before this, `/refunds` and `/contact` answered a 307 to the accounts sign-in, so a stale link asked visitors to log in to read a page that does not exist and crawlers indexed a redirect. The proxy now requires a session only for the app's protected pages (`/dashboard`, `/editor`, `/settings`, `/admin`, and `/dev` in production), each of which still redirects an anonymous visitor to sign-in. API paths are unchanged: any `/api` path that is not public, including one that does not exist, still answers 401. A new test walks `src/app` and fails if a top-level route is neither public nor listed as protected, so a new authenticated page cannot go public by omission.
