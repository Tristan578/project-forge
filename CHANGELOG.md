# Changelog

All notable changes to SpawnForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.2.0 (2026-04-03)

### Fixed
- **Sentry observability**: Replaced `captureException` with `addBreadcrumb` for non-error engine recovery attempts — recovery is an expected operation, not an error
- **Engine recovery**: Removed dead localStorage state backup code from `recoverEngine()` — Zustand store persists in memory, backup was never consumed
- **Engine recovery docstring**: Corrected inaccurate claim about "replaying commands from snapshot" — recovery re-initializes the WASM module; React components re-sync via effects
- **Merge conflict**: Resolved duplicate Sentry SDK imports in `instrumentation.ts` introduced by parallel branches

### Added
- `recoverEngine` test coverage: breadcrumb emission, exception capture, missing canvas, and load failure cases
- Changesets-based versioning, changelog automation, and release workflow

## 0.1.0 (2026-03-01)

Initial release of SpawnForge. AI-native 2D/3D game engine for the browser with Bevy/WASM rendering, React editor shell, 350+ MCP commands, Stripe billing, and Clerk authentication.
