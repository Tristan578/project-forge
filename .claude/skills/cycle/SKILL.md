---
name: cycle
description: Runs the standard Plan -> Build -> Verify loop with domain-specific skills. usage: /cycle [task]
---

# The Development Loop

## Overview

This is the full development cycle for SpawnForge. Every feature goes through Plan → Build → Verify → Update Context. Each phase uses domain-specific skills to ensure consistent, high-quality output aligned with the product vision.

## 1. Plan

Invoke the `planner` skill to draft a spec for: {{input}}
- The planner uses the `design` skill patterns for architectural decisions
- The planner verifies claims against actual code (not just design docs)
- **STOP and await user approval.**

## 2. Build

Once approved, invoke the `builder` skill to implement it. The builder will:
- Use `/rust-engine` patterns for Bevy 0.18 / Rapier 0.33 / WASM code
- Use `/frontend` patterns for React 19 / Next.js 16 / Zustand 5 / Tailwind 4 code
- Use `/mcp-commands` patterns for AI parity (commands, handlers, manifest)
- Use `/testing` patterns for 100% coverage target
- Use `/docs` patterns for documentation updates

## 3. Verify

Run the architecture validator and test suite:

```bash
# Architecture boundaries
python3 .claude/skills/arch-validator/check_arch.py

# Lint (zero warnings enforced)
cd web && npx eslint --max-warnings 0 .

# TypeScript
cd web && npx tsc --noEmit

# Unit tests
cd web && npx vitest run

# MCP tests
cd mcp-server && npx vitest run
```

If any check fails, fix immediately before proceeding.

## 4. Update Context

After verification passes, update project context files:
- **New pitfalls/API quirks?** → Add to `.claude/rules/*.md`
- **Phase completed?** → Update Phase Roadmap in `.claude/CLAUDE.md`
- **MCP commands changed?** → Update count in `MEMORY.md` and `CLAUDE.md`
- **New ECS components or libraries?** → Update `rules/file-map.md`, `rules/bevy-api.md`, `rules/library-apis.md`
- **New EntitySnapshot fields?** → Update `rules/entity-snapshot.md`
- **Temporary learnings?** → Log in `MEMORY.md`, promote to rules after confirmation

## Version Reference

All implementations must use these exact versions:
- Bevy 0.18, bevy_rapier 0.33, bevy_hanabi 0.18, bevy_panorbit_camera 0.34
- Next.js 16, React 19, Zustand 5, TypeScript 5, Tailwind 4, Vitest 4
- Rust stable, wasm-bindgen 0.2.108, csgrs 0.20
