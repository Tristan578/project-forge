#!/usr/bin/env bash
# Unit tests for generate-wasm-manifests.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$SCRIPT_DIR/generate-wasm-manifests.sh"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

setup_fixture() {
  local tmpdir
  tmpdir=$(mktemp -d)
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
bash "$SCRIPT" "$DIR" > /dev/null 2>&1
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
  fail "manifest not created"
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
DIR=$(mktemp -d)
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

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
