---
applyTo: ".github/**"
---

# CI/CD Instructions

GitHub Actions workflow in `.github/workflows/ci.yml` runs on every PR and push to main.

## Jobs

- **build-web**: Install deps → build Next.js → run vitest → run ESLint with `--max-warnings 0`
- **build-wasm**: Install Rust → build WebGL2 + WebGPU variants → run wasm-bindgen → check binary size (60MB threshold)
- **rust-audit**: Install Rust → `cargo audit` on engine dependencies

All three jobs must pass before merge. Do not add `continue-on-error: true` to any step.

## Rules

- Never skip or weaken existing checks. If a step fails, fix the code, not the CI config.
- The WASM binary size threshold (60MB) exists to prevent bloat. If a legitimate change pushes past it, raise the threshold with a comment explaining why.
- `cargo audit` failures on critical/high severity must be fixed before merge. Use `cargo audit --ignore RUSTSEC-XXXX-XXXX` only with a documented justification and a tracking issue.
- Keep CI fast. Cache Rust builds with `Swatinem/rust-cache@v2`. Cache npm with `actions/setup-node` built-in caching.
- Binary size results are written to `$GITHUB_STEP_SUMMARY` for visibility in the PR checks UI.
