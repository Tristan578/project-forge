#!/usr/bin/env bash
# Assert that every WASM variant is bindgen'd from the build that produced it.
#
# THE BUG THIS EXISTS FOR (#9579)
#
# Every `cargo build` writes the SAME output file:
#   engine/target/wasm32-unknown-unknown/release/forge_engine.wasm
# so a variant is only correct if its `wasm-bindgen` runs before the NEXT build
# overwrites that file. cd.yml ran build, build, bindgen, bindgen -- so both
# bindgen steps read the WebGPU build, and `engine-pkg-webgl2` on the CDN was a
# WebGPU binary, served to exactly the browsers that have no WebGPU.
#
# WHY THIS HAS TO BE A STRUCTURAL TEST
#
# The failure is invisible from CI. Both packages upload. Both are valid WASM.
# Nothing errors, no job goes red, no artifact is missing. The only symptom is
# the wrong renderer in a browser that cannot run it -- which no CI check looks
# at. It was found by comparing CDN ETags, not by anything in the pipeline.
#
# So the invariant is pinned at the source: walk each workflow's `cargo build`
# and `wasm-bindgen` commands IN ORDER, and require that the build most recently
# preceding each bindgen is the one whose features match that bindgen's out-dir.
# That is exactly the property the interleaved form has and the split form does
# not, and it holds regardless of how the steps are named or split.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WF_DIR="${WASM_INTEGRITY_WF_DIR:-$HERE/../../.github/workflows}"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# features -> the out-dir that build is allowed to feed.
#   webgl2          -> pkg-webgl2
#   webgpu,runtime  -> pkg-webgpu-runtime
expected_outdir() {
  local feats="$1" base="" suffix=""
  case "$feats" in
    *webgl2*) base="webgl2" ;;
    *webgpu*) base="webgpu" ;;
    *)        printf 'pkg-UNKNOWN'; return ;;
  esac
  case "$feats" in *runtime*) suffix="-runtime" ;; esac
  printf 'pkg-%s%s' "$base" "$suffix"
}

# Emit "BUILD <features>" / "BINDGEN <out-dir>" in file order for one workflow.
# Comment lines are dropped so prose describing the bug cannot be read as code.
variant_ops() {
  grep -oE '^[^#]*(cargo build[^|]*--features[[:space:]]+[a-z0-9,]+|wasm-bindgen[^|]*--out-dir[[:space:]]+[a-zA-Z0-9-]+)' "$1" \
    | sed -E 's/.*--features[[:space:]]+([a-z0-9,]+).*/BUILD \1/; s/.*--out-dir[[:space:]]+([a-zA-Z0-9-]+).*/BINDGEN \1/'
}

check_workflow() {
  local wf="$1" name
  name="$(basename "$wf")"
  if [ ! -f "$wf" ]; then
    fail "$name not found at $wf"
    return
  fi

  local ops last_build n_bindgen bad
  ops="$(variant_ops "$wf")"
  if [ -z "$ops" ]; then
    # Not every workflow builds WASM; that is fine. Only report when one that
    # bindgens has no builds, which would mean the extractor stopped working.
    if grep -q 'wasm-bindgen .*--out-dir' "$wf"; then
      fail "$name bindgens a variant but no build/bindgen pairs could be extracted (extractor broken?)"
    fi
    return
  fi

  last_build=""
  n_bindgen=0
  bad=0
  while IFS= read -r op; do
    case "$op" in
      "BUILD "*)
        last_build="${op#BUILD }"
        ;;
      "BINDGEN "*)
        local outdir want
        outdir="${op#BINDGEN }"
        n_bindgen=$((n_bindgen + 1))
        if [ -z "$last_build" ]; then
          fail "$name: '$outdir' is bindgen'd with no preceding cargo build"
          bad=1
          continue
        fi
        want="$(expected_outdir "$last_build")"
        if [ "$want" != "$outdir" ]; then
          fail "$name: '$outdir' is bindgen'd from a '--features $last_build' build (which produces $want) — the intervening build overwrote forge_engine.wasm, so this package gets the WRONG variant"
          bad=1
        fi
        ;;
    esac
  done <<< "$ops"

  if [ "$n_bindgen" -eq 0 ]; then
    return
  fi
  if [ "$bad" -eq 0 ]; then
    pass "$name: all $n_bindgen variant(s) bindgen'd from their own build"
  fi
}

echo "=== every WASM variant is bindgen'd from its own build ==="
for wf in cd.yml ci.yml quality-gates.yml; do
  check_workflow "$WF_DIR/$wf"
done

# --- Negative control ---------------------------------------------------------
# A suite that can only pass is worth nothing. Reproduce the exact shape of the
# #9579 bug in a fixture and require this checker to reject it.
#
# The control re-invokes THIS FILE against a fixture directory, so it has to be
# suppressed in the child or the suite recurses forever.
if [ -n "${WASM_INTEGRITY_SKIP_CONTROL:-}" ]; then
  echo ""
  echo "  PASS=$PASS FAIL=$FAIL"
  if [ "$FAIL" -eq 0 ]; then echo "SUITE PASSED"; exit 0; fi
  echo "SUITE FAILED"
  exit 1
fi

echo ""
echo "=== negative control: the #9579 ordering must be rejected ==="
CTRL="$(mktemp -d)"
mkdir -p "$CTRL/wf"
cat > "$CTRL/wf/cd.yml" <<'BROKEN'
jobs:
  build-wasm:
    steps:
      - name: Build WebGL2
        run: cargo build --target wasm32-unknown-unknown --release --features webgl2
      - name: Build WebGPU
        run: cargo build --target wasm32-unknown-unknown --release --features webgpu
      - name: Run wasm-bindgen (WebGL2)
        run: wasm-bindgen --target web --out-dir pkg-webgl2 target/wasm32-unknown-unknown/release/forge_engine.wasm
      - name: Run wasm-bindgen (WebGPU)
        run: wasm-bindgen --target web --out-dir pkg-webgpu target/wasm32-unknown-unknown/release/forge_engine.wasm
BROKEN
CTRL_OUT="$(WASM_INTEGRITY_SKIP_CONTROL=1 WASM_INTEGRITY_WF_DIR="$CTRL/wf" bash "${BASH_SOURCE[0]}" 2>&1)" && CTRL_RC=0 || CTRL_RC=$?
rm -rf "$CTRL"
if [ "$CTRL_RC" -ne 0 ]; then
  pass "the split build,build,bindgen,bindgen ordering is rejected (exit $CTRL_RC)"
else
  fail "the #9579 ordering PASSED this checker — it would not have caught the bug"
fi
if grep -q "WRONG variant" <<<"$CTRL_OUT"; then
  pass "the rejection explains that the package gets the wrong variant"
else
  fail "the rejection did not name the failure: $(tr '\n' ' ' <<<"$CTRL_OUT")"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
