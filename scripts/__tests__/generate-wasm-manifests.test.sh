#!/usr/bin/env bash
# Unit tests for generate-wasm-manifests.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$SCRIPT_DIR/generate-wasm-manifests.sh"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

# A temp dir whose path every process in this suite can resolve.
#
# These tests interpolate the fixture path into `python3 -c` one-liners. Under
# Git-for-Windows `mktemp -d` returns an MSYS path (/tmp/tmp.XXXX) that only
# MSYS-linked programs understand: a NATIVE python3 reads the leading slash as
# the current drive root and reports ENOENT on a file bash just wrote, so every
# assertion below collapses. `cygpath -m` renders the same directory as a
# Windows-absolute path with forward slashes (C:/Users/.../Temp/tmp.XXXX),
# which bash, python3 and the gate under test all resolve identically. On
# Linux/macOS cygpath does not exist and the path passes through untouched.
mktemp_d_native() {
  local d
  d=$(mktemp -d)
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$d"
  else
    printf '%s\n' "$d"
  fi
}

setup_fixture() {
  local tmpdir
  tmpdir=$(mktemp_d_native)
  local variant_dir="$tmpdir/engine-pkg-webgl2"
  mkdir -p "$variant_dir"
  echo "fake wasm content" > "$variant_dir/forge_engine_bg.wasm"
  echo "fake js content"   > "$variant_dir/forge_engine.js"
  echo "$tmpdir"
}

cleanup() { rm -rf "$1"; }

echo "=== generate-wasm-manifests.sh tests ==="

# Test 1: Generates valid JSON manifest
echo "Test 1: generates manifest with correct fields"
DIR=$(setup_fixture)
# Keep the generator's own output: when it aborts (a missing hash tool, an
# unreadable fixture) the only symptom otherwise is "manifest not created",
# which says nothing about why.
GEN_OUT=$(bash "$SCRIPT" "$DIR" 2>&1) || true
MANIFEST="$DIR/engine-pkg-webgl2/wasm-manifest.json"
if [ -f "$MANIFEST" ]; then
  # Verify all required fields exist
  HAS_FIELDS=$(python3 -c "
import json, sys
m = json.load(open('$MANIFEST'))
required = ['wasmFile', 'jsFile', 'wasmHash', 'jsHash', 'buildId', 'hash']
missing = [f for f in required if f not in m]
print('ok' if not missing else 'missing: ' + ','.join(missing))
")
  if [ "$HAS_FIELDS" = "ok" ]; then pass "all fields present"; else fail "fields: $HAS_FIELDS"; fi
else
  fail "manifest not created; generator said: ${GEN_OUT:-<no output>}"
fi
cleanup "$DIR"

# Test 2: wasmHash is 16 hex chars
echo "Test 2: wasmHash is 16 hex characters"
DIR=$(setup_fixture)
bash "$SCRIPT" "$DIR" > /dev/null 2>&1
HASH=$(python3 -c "import json; print(json.load(open('$DIR/engine-pkg-webgl2/wasm-manifest.json'))['wasmHash'])")
if echo "$HASH" | grep -qE '^[0-9a-f]{16}$'; then pass "wasmHash format"; else fail "wasmHash=$HASH"; fi
cleanup "$DIR"

# Test 3: buildId is 16 hex chars (XOR of wasmHash and jsHash)
echo "Test 3: buildId is correct XOR of wasmHash and jsHash"
DIR=$(setup_fixture)
bash "$SCRIPT" "$DIR" > /dev/null 2>&1
VALID=$(python3 -c "
import json
m = json.load(open('$DIR/engine-pkg-webgl2/wasm-manifest.json'))
expected = format(int(m['wasmHash'],16) ^ int(m['jsHash'],16), '016x')
print('ok' if m['buildId'] == expected else f'expected={expected} got={m[\"buildId\"]}')
")
if [ "$VALID" = "ok" ]; then pass "buildId XOR"; else fail "buildId: $VALID"; fi
cleanup "$DIR"

# Test 4: backward-compat hash field equals wasmHash
echo "Test 4: legacy hash field equals wasmHash"
DIR=$(setup_fixture)
bash "$SCRIPT" "$DIR" > /dev/null 2>&1
MATCH=$(python3 -c "
import json
m = json.load(open('$DIR/engine-pkg-webgl2/wasm-manifest.json'))
print('ok' if m['hash'] == m['wasmHash'] else 'mismatch')
")
if [ "$MATCH" = "ok" ]; then pass "hash==wasmHash"; else fail "hash mismatch"; fi
cleanup "$DIR"

# Test 5: exits 1 when no engine-pkg-* dirs exist
echo "Test 5: exits 1 with no engine-pkg-* directories"
DIR=$(mktemp_d_native)
if bash "$SCRIPT" "$DIR" > /dev/null 2>&1; then
  fail "should have exited 1"
else
  pass "exits non-zero"
fi
cleanup "$DIR"

# Test 6: XOR handles high-bit values (overflow regression)
echo "Test 6: XOR handles high-bit hex values without overflow"
DIR=$(setup_fixture)
# Create files whose SHA256 starts with high-bit chars (f...)
python3 -c "import os; open('$DIR/engine-pkg-webgl2/forge_engine_bg.wasm','wb').write(os.urandom(1024))"
python3 -c "import os; open('$DIR/engine-pkg-webgl2/forge_engine.js','wb').write(os.urandom(1024))"
bash "$SCRIPT" "$DIR" > /dev/null 2>&1
BUILD_ID=$(python3 -c "import json; print(json.load(open('$DIR/engine-pkg-webgl2/wasm-manifest.json'))['buildId'])")
if echo "$BUILD_ID" | grep -qE '^[0-9a-f]{16}$'; then pass "high-bit XOR"; else fail "buildId=$BUILD_ID"; fi
cleanup "$DIR"

# Test 7: a hash tool that returns something that is not a digest must ABORT
echo "Test 7: a bad digest aborts the whole run, it does not write a manifest"
# Why this is pinned: hash16 reports the failure and calls `exit 1`, but it is
# invoked through a command substitution (wasm_hash=$(hash16 ...)), where an
# exit only leaves the SUBSHELL. What actually stops the script is the `set -e`
# at the top of it, applied to the failing assignment. That is a real but
# non-obvious dependency -- drop `set -e`, or wrap the assignment in an `if` or
# a `||`, and the run would carry on with an EMPTY hash and bake it into a
# manifest that clients use as a cache key. Rather than leave that resting on a
# reader noticing `set -e`, the behaviour is asserted here.
DIR=$(setup_fixture)
# Plain mktemp, NOT mktemp_d_native: this directory goes on $PATH, which the
# shell resolves in its own path space -- a Windows-style C:/... entry there
# is simply never searched, and the stubs below would be silently ignored.
STUB=$(mktemp -d)
for tool in sha256sum shasum openssl; do
  printf '#!/usr/bin/env bash
echo "not-a-digest  stub"
' > "$STUB/$tool"
  chmod +x "$STUB/$tool"
done
# `... && RC=0 || RC=$?`, not `...; RC=$?`: this suite runs under `set -e`, so
# the assignment failing (which is the whole point of the case) would abort
# the suite before $? was ever read.
OUT=$(PATH="$STUB:$PATH" bash "$SCRIPT" "$DIR" 2>&1) && RC=0 || RC=$?
if [ "$RC" -ne 0 ]; then pass "a bad digest exits non-zero (got $RC)"; else fail "a bad digest should exit non-zero, got 0"; fi
if grep -q "could not hash" <<<"$OUT"; then pass "the failure names the hashing step"; else fail "expected a 'could not hash' message, got: $OUT"; fi
if [ ! -f "$DIR/engine-pkg-webgl2/wasm-manifest.json" ]; then
  pass "no manifest is written when the digest is rejected"
else
  fail "a manifest was written despite the digest being rejected: $(cat "$DIR/engine-pkg-webgl2/wasm-manifest.json")"
fi
rm -rf "$STUB"
cleanup "$DIR"

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
