# Changelog

All notable changes to SpawnForge are documented in this file.

## [Unreleased]

### Fixed
- **Sentry observability**: Replaced `captureException` with `addBreadcrumb` for non-error engine recovery attempts — recovery is an expected operation, not an error
- **Engine recovery**: Removed dead localStorage state backup code from `recoverEngine()` — Zustand store persists in memory, backup was never consumed
- **Engine recovery docstring**: Corrected inaccurate claim about "replaying commands from snapshot" — recovery re-initializes the WASM module; React components re-sync via effects
- **Merge conflict**: Resolved duplicate Sentry SDK imports in `instrumentation.ts` introduced by parallel branches

### Added
- `recoverEngine` test coverage: breadcrumb emission, exception capture, missing canvas, and load failure cases
