---
"web": patch
---

`npm run db:push` runs its push guard again instead of crashing before it. The guard script ended in a top-level `await`, which tsx's CommonJS output refuses, so the command died at transform time and never reached `drizzle-kit push`, even for the fresh, journal-less databases the guard exists to allow. A subprocess test now runs the script the way npm does, and a sweep checks every tsx-run script compiles as CommonJS.
