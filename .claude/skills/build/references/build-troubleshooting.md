# Build Troubleshooting Reference

Common failures when building the SpawnForge WASM engine and web frontend.

## WASM Build Failures

### wasm-bindgen version mismatch

**Symptom:**
```
error: the `#[wasm_bindgen]` attribute is not supported on this version
```
or
```
it looks like the Rust project used to generate this wasm file was linked against
a different version of wasm-bindgen
```

**Fix:**
```bash
cargo install wasm-bindgen-cli --version 0.2.108 --force
```

The version is pinned to `0.2.108` and MUST match `Cargo.lock`. Never upgrade without
updating both the CLI and `Cargo.toml`.

---

### Missing wasm32 target

**Symptom:**
```
error[E0463]: can't find crate for `std`
  = note: the `wasm32-unknown-unknown` target may not be installed
```

**Fix:**
```bash
rustup target add wasm32-unknown-unknown
```

---

### doc-image-embed Windows SDK missing (Windows only)

**Symptom:**
```
LINK : fatal error LNK1181: cannot open input file 'ucrt.lib'
```

**Cause:** `csgrs` pulls the `doc-image-embed` proc-macro which compiles natively and
needs Windows SDK libs to link.

**Fix:** `build_wasm.ps1` auto-detects and sets `$env:LIB`. If it fails, ensure
Windows SDK 10.0.22621.0+ and MSVC 14.x are installed. The script searches:
```
C:\Program Files (x86)\Windows Kits\10\Lib\<version>\ucrt\x64\ucrt.lib
C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC\<ver>\lib\x64
```

---

### Pink/magenta materials in the renderer

**Symptom:** All objects render as solid pink or magenta in the WebGPU viewport.

**Cause:** The `tonemapping_luts` Bevy feature is missing. Without it, tonemapping
lookup tables are absent and Bevy falls back to a pink shader error.

**Fix:** Ensure `tonemapping_luts` is enabled in `engine/Cargo.toml` under the Bevy
features. It MUST be present in both the `webgl2` and `webgpu` feature sets.

---

### cargo check must use --target wasm32-unknown-unknown

**Symptom:** `cargo check` passes but the WASM build fails with symbol errors.

**Cause:** Running `cargo check` without `--target wasm32-unknown-unknown` checks against
the host target (x86_64 or aarch64), which has `std::thread`, `std::fs`, etc. These
don't exist on wasm32 and cause link failures.

**Fix:** Always check with the WASM target:
```bash
cd engine && cargo check --target wasm32-unknown-unknown --features webgl2
cd engine && cargo check --target wasm32-unknown-unknown --features webgpu
```

Or use the wrapper:
```bash
bash .claude/skills/rust-engine/scripts/cargo-check-wasm.sh
```

---

## Web Frontend Build Failures

### Turbopack vs Webpack

**Context:**
- `npm run dev` uses Webpack (`--webpack` flag in `package.json`)
- `npm run build` uses Turbopack (Next.js 16 default)

**Symptom:** Plugin works in dev but build fails.

**Cause:** A webpack-only plugin or loader is configured that is incompatible with
Turbopack.

**Fix:** Remove the webpack-only plugin. Check `next.config.ts` `webpack()` callback —
Turbopack ignores the `webpack` callback entirely.

---

### SRI hashes break production

**Symptom:** Blank page in production. Browser console shows:
```
Failed to load resource: net::ERR_SRI_HASH_MISMATCH
```

**Cause:** `experimental.sri` is NOT compatible with Vercel CDN. Vercel post-processes
chunks (compression, immutable headers) after build, changing byte content without
updating hashes.

**Fix:** Do NOT enable `experimental.sri` in `next.config.ts`. It is permanently
disabled. CSP `script-src 'self'` provides the equivalent injection protection.

---

### safeAuth() vs auth() crash in CI

**Symptom:** Dev server or E2E tests crash with:
```
Error: @clerk/nextjs: auth() was called but Clerk middleware was not detected.
```

**Fix:** Replace `auth()` from `@clerk/nextjs/server` with `safeAuth()` from
`@/lib/auth/safe-auth.ts` in all page/layout files. `safeAuth()` returns
`{ userId: null }` when Clerk is not configured.

---

### Missing `NEXT_PUBLIC_ENGINE_CDN_URL`

**Symptom:** Engine WASM fails to load in production. Console shows 404 on
`engine-pkg-webgpu/forge_engine_bg.wasm`.

**Fix:** Ensure `NEXT_PUBLIC_ENGINE_CDN_URL` is set in Vercel project settings to
`https://engine.spawnforge.ai`. This is a build-time variable — must be set before
running `vercel build`.

---

### Node 25.x V8 segfaults in hooks

**Symptom:** A pre-commit hook crashes with a stack trace mentioning `libnode`.

**Cause:** Intermittent V8 JIT crashes in Node 25.x. Not a code bug.

**Fix:** If reproducible, downgrade to Node 22 LTS. Do NOT bypass with `--no-verify`.
File a ticket and investigate the hook script for patterns that trigger the JIT issue.

---

## Validation Commands

```bash
# Full engine WASM check (both feature sets)
bash .claude/skills/rust-engine/scripts/cargo-check-wasm.sh

# Architecture boundary check
python3 .claude/skills/arch-validator/check_arch.py

# Frontend lint + tsc
bash .claude/tools/validate-frontend.sh quick

# Full suite
bash .claude/tools/validate-all.sh
```
