# Issue #1 Resolution: Fix failing tests in PR #2

## Summary
PR #2 (`auto-eval/security-and-ci-fixes`) was experiencing CI failures. Investigation revealed two issues:

### Issue 1: Test Failures (Already Fixed)
The `detectPromptInjection()` function was changed to return an object `{ detected: boolean, pattern?: string }` instead of a plain boolean, but tests and validator code weren't updated.

**Status: ✅ FIXED**
- All tests in `web/src/lib/chat/sanitizer.test.ts` now correctly use `.detected` property
- Validator in `web/src/lib/security/validator.ts` now correctly uses `.detected` property
- All 1389 tests pass locally

### Issue 2: CI Rust Audit Failure (Fixed in commit 676e234)
The `rust-audit` job in CI was failing with a compilation error:

```
error[E0282]: type annotations needed for `Box<_>`
  --> time-0.3.32/src/format_description/parse/mod.rs:83:9
```

**Root Cause**: `cargo-audit` version 0.20.0 has a dependency on `time` crate v0.3.32, which fails to compile with newer Rust compilers due to a known issue.

**Solution**: Update `cargo-audit` from version 0.20.0 to 0.22.1

**Status: ✅ FIXED in commit 676e234**
- Updated `.github/workflows/ci.yml` line 169
- Changed `cargo install cargo-audit --version 0.20.0 --locked` to `cargo install cargo-audit --version 0.22.1 --locked`

## Fix Applied
The fix has been committed to the `auto-eval/security-and-ci-fixes` branch:
- Commit: `676e234` 
- Message: "fix: Update cargo-audit to v0.22.1 to resolve time crate compilation error"

## Next Steps

### Option 1: Apply the Patch (Recommended)
A patch file has been created at `issues/pr2-cargo-audit-fix.patch`. To apply it to PR #2:

```bash
git checkout auto-eval/security-and-ci-fixes
git am issues/pr2-cargo-audit-fix.patch
git push origin auto-eval/security-and-ci-fixes
```

### Option 2: Manual Fix
Edit `.github/workflows/ci.yml` line 169 on the `auto-eval/security-and-ci-fixes` branch:
- Change: `cargo install cargo-audit --version 0.20.0 --locked`
- To: `cargo install cargo-audit --version 0.22.1 --locked`

Once applied and pushed, CI should pass and PR #2 will be ready for review and merge.

## Files Changed
- `.github/workflows/ci.yml` (line 169): Updated cargo-audit version

## Testing
- ✅ All web tests pass (1389/1389)
- ✅ Sanitizer tests pass (30/30)  
- ✅ Validator tests pass (9/9)
- ⏳ CI validation pending push
