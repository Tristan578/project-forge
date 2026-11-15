---
"@spawnforge/docs": patch
---

The docs app now compiles the MDX files under `content/`. `next.config.ts` wraps the config in the fumadocs-mdx plugin, and the new `source.config.ts` accepts both frontmatter shapes the generator writes: index pages that carry a `title`, and command pages that carry `commandName` and no `title`. A command page takes its title from its `commandName`. The generated `.source/` loader index is gitignored. Nothing renders these pages yet: the catch-all route and layout come in a later change.
