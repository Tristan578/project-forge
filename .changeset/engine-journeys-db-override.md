---
"web": patch
---

Added a test-only switch, `E2E_NEON_HTTP_ENDPOINT`, that lets the app's database driver send its queries to a Neon-protocol proxy running on the same machine instead of to Neon's cloud. Continuous integration uses it to exercise the editor against a database created for that run and thrown away afterwards, so account features such as saving and publishing can be tested on every change without touching shared data. The switch is honoured only in builds compiled with the end-to-end testing flag: a normal production build ignores the variable even when it is set, and even in a test build a value that does not point at the local machine is refused rather than used. Nothing changes for people using the app.

A database migration that fails now names the migration file and the statement within it that failed, instead of reporting only the database's error text.
