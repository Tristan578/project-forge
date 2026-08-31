---
"@spawnforge/docs": patch
---

Emit URL paths in the docs sitemap regardless of the host's path separator (#9538). `collectMdxPaths` fed `path.relative()` output straight into the sitemap, so a build on Windows advertised `/mcp\overview`, never stripped a trailing `/index`, and — because `startsWith('/mcp/')` then matched nothing — silently demoted every MCP page from priority 0.7 to 0.6. The normalisation now lives in an exported `toUrlPath()` whose separator is injectable, so the Windows shape stays pinned from a POSIX runner where the conversion is otherwise a no-op.
