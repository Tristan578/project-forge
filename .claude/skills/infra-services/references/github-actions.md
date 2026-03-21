# GitHub Actions CI/CD Patterns

## Workflows
- `ci.yml` -- PR checks: lint, tsc, vitest, playwright (4 shards), WASM build check
- `cd.yml` -- Deploy: build, staging deploy, smoke test, production deploy
- `codeql.yml` -- Security scanning (should run on push-to-main + weekly only, PF-633)
- `quality-gates.yml` -- Additional quality checks
- `post-deploy-smoke.yml` -- Post-deployment smoke tests
- `pr-workitem-check.yml` -- PR requires linked work item

## Gotchas
1. **Duplicate job definitions**: `cd.yml` has had duplicate smoke-production jobs (PF-736). Check for duplicates after editing.
2. **WASM artifact naming**: Use consistent artifact names between CI upload and CD download (PF-733).
3. **Path filtering**: Add path filtering to skip irrelevant CI jobs (PF-632). E.g., docs-only PRs shouldn't trigger WASM build.
4. **Timeout-minutes**: All jobs should have `timeout-minutes` set (PF-635) to prevent runaway jobs.
5. **Permissions block**: Workflow files should have explicit `permissions:` block (PF-782) for security.
6. **WASM build time**: 5-10 minutes. Engine binary is CDN-hosted so this is tolerable, but cache artifacts between CI/CD for same SHA (PF-636).
7. **vitest hangs in CI**: jsdom open handles (vitest#3077). Use `--pool=threads --coverage` + 600s timeout wrapper.
8. **Playwright retries**: Configured with retries for flaky GPU tests. Use `--grep` tags for smoke vs full suite.

## Testing Workflow Changes
```bash
# Validate workflow syntax
gh workflow list --all

# Check recent CI runs
gh run list --workflow=ci.yml --limit 5

# View specific run logs
gh run view <run-id> --log
```
