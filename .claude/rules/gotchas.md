# Extended Gotchas — Index

The gotchas are split across four topic files so each loads only in sessions that touch
its area (see the `paths:` frontmatter in each). This index is always loaded; the bodies
are not. Existing cross-references of the form "`gotchas.md` → \<Section\>" resolve via
the table below.

| Section | Lives in | Loads when you touch |
|---------|----------|----------------------|
| Build & CI | `rules/gotchas-build-ci.md` | `.github/**`, `scripts/**`, manifests/lockfile, vitest configs, `web/next.config.ts`, `web/src/app/api/**`, `web/src/lib/**` |
| Database | `rules/gotchas-web.md` | `web/**`, `packages/**`, `apps/**`, `drizzle/**` |
| API & Security | `rules/gotchas-web.md` | same as above |
| WASM / CDN | `rules/gotchas-web.md` | same as above |
| UI & Frontend | `rules/gotchas-web.md` | same as above |
| Engine & Game Loop | `rules/gotchas-engine.md` | `engine/**`, `web/src/lib/{engine,game-creation,physics,cutscene,scripting}/**`, `web/src/stores/**`, `web/src/hooks/**` |
| Claude Code Config | `rules/gotchas-ops.md` | `.claude/**`, `.github/**`, `vercel.json` |
| Infrastructure | `rules/gotchas-ops.md` | same as above |
| Enforcement Hooks | `rules/gotchas-ops.md` | same as above |

If you are working outside those paths and need a gotcha anyway, `Read` the file directly —
nothing was deleted in the split, only moved.
