#!/usr/bin/env bash
# Contract test for scripts/alias-wasm-cdn-version.sh — the step that gives a
# deploy's commit SHA a valid engine prefix when the engine did not change.
#
# WHY THE NEGATIVE CASES DOMINATE
#
# The bug being fixed (#9581) was silent: cd.yml stamped a SHA, the upload job
# skipped, and both the CDN path and the same-origin fallback 404'd — while
# every job stayed green. A fix that can itself fail quietly just relocates the
# problem, so every way the copy can produce an empty prefix must exit non-zero.
#
# Two traps, both of which have actually bitten:
#
#   1. `aws s3 cp --recursive` over a non-existent prefix EXITS 0 having copied
#      nothing. Trusting its exit code alone reproduces the original failure
#      exactly - a green deploy serving 404s.
#   2. `--metadata-directive REPLACE` DISCARDS every header not restated. The
#      first version of this script restated only cache-control, so the aliased
#      objects were served with NO Content-Type (#9593), which MIME-blocks the
#      dynamic ES module import in useEngine.ts. HTTP 200 with the wrong headers
#      is not a working engine, so "it copied something" is not the assertion.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../alias-wasm-cdn-version.sh"
CD_YML="$HERE/../../.github/workflows/cd.yml"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "script not found: $SCRIPT"; exit 1; }

# A stub `aws` driven by two files: what `s3 ls` prints per prefix, and whether
# `s3 cp` succeeds. Records its argv so the flags can be asserted.
make_aws() {
  local dir="$1" ls_latest="$2" ls_dest="$3" cp_rc="$4"
  cat > "$dir/aws" <<STUB
#!/usr/bin/env bash
echo "\$@" >> "$dir/argv.log"
case "\$*" in
  *"s3 ls"*"/latest/"*)  printf '%s' '${ls_latest}' ;;
  *"s3 ls"*)             printf '%s' '${ls_dest}' ;;
  *"s3 cp"*)             exit ${cp_rc} ;;
esac
exit 0
STUB
  chmod +x "$dir/aws"
}

run_case() {
  local ls_latest="$1" ls_dest="$2" cp_rc="$3"
  local dir
  dir="$(mktemp -d)"
  make_aws "$dir" "$ls_latest" "$ls_dest" "$cp_rc"
  local out rc
  out="$(AWS_CLI="$dir/aws" ENGINE_VERSION=abc123 R2_BUCKET=test-bucket bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
  printf '%s\n---RC---%s\n---ARGV---\n%s' "$out" "$rc" "$(cat "$dir/argv.log" 2>/dev/null)"
  rm -rf "$dir"
}

echo "=== alias-wasm-cdn-version.sh ==="

# --- happy path ---------------------------------------------------------------
RES="$(run_case 'obj1
obj2' 'obj1
obj2' 0)"
RC="${RES#*---RC---}"; RC="${RC%%$'\n'---ARGV---*}"
if [ "$RC" = "0" ]; then
  pass "a populated latest/ with a successful copy exits 0"
else
  fail "happy path exited $RC: $(head -3 <<<"$RES")"
fi

ARGV="${RES#*---ARGV---$'\n'}"
if grep -q -- "--metadata-directive REPLACE" <<<"$ARGV"; then
  pass "the copy REPLACEs metadata (latest/ is short-TTL; a pinned prefix must not inherit that)"
else
  fail "copy did not pass --metadata-directive REPLACE: $ARGV"
fi
if grep -q -- "immutable" <<<"$ARGV"; then
  pass "the copy sets an immutable cache-control on the pinned prefix"
else
  fail "copy did not set an immutable cache-control: $ARGV"
fi
if grep -qE "s3 cp s3://test-bucket/latest/ s3://test-bucket/abc123/" <<<"$ARGV"; then
  pass "copies latest/ to the stamped version prefix"
else
  fail "unexpected copy source/destination: $ARGV"
fi

echo ""
echo "--- REPLACE discards every header not restated, so each type must be named ---"
# The regression that made the engine unloadable while every object still
# returned HTTP 200 (#9593): the aliased prefix carried no Content-Type, and a
# module script served without a JavaScript MIME type is refused by the browser.
check_type() {
  local ext="$1" ctype="$2" label="$3"
  if grep -qF -- "--include *${ext}" <<<"$ARGV" && grep -qF -- "--content-type ${ctype}" <<<"$ARGV"; then
    pass "${label} is copied with --content-type ${ctype}"
  else
    fail "${label} is not given ${ctype} - REPLACE drops the type and the browser refuses the asset: ${ARGV}"
  fi
}
check_type ".wasm" "application/wasm" "the wasm module"
check_type ".js" "text/javascript" "the glue module"
check_type ".json" "application/json" "the manifest"

echo ""
echo "--- every way this can produce an empty prefix must fail ---"

# The trap: `aws s3 cp --recursive` over a missing prefix exits 0 having copied
# nothing. Exit code alone is not evidence.
RES="$(run_case '' '' 0)"
RC="${RES#*---RC---}"; RC="${RC%%$'\n'---ARGV---*}"
if [ "$RC" != "0" ]; then
  pass "an EMPTY latest/ fails even though the copy would exit 0 (exit $RC)"
else
  fail "an empty source produced a success — this is the original bug"
fi
if grep -q "refusing to stamp" <<<"$RES"; then
  pass "the refusal explains that nothing would be behind the stamp"
else
  fail "empty-source refusal did not explain itself"
fi

# A copy that genuinely errors.
RES="$(run_case 'obj1' 'obj1' 1)"
RC="${RES#*---RC---}"; RC="${RC%%$'\n'---ARGV---*}"
if [ "$RC" != "0" ]; then
  pass "a failing copy exits non-zero (exit $RC)"
else
  fail "a failing copy was reported as success"
fi

# Source present, copy "succeeds", destination still empty. This is the shape
# that would ship a green deploy serving 404s.
RES="$(run_case 'obj1' '' 0)"
RC="${RES#*---RC---}"; RC="${RC%%$'\n'---ARGV---*}"
if [ "$RC" != "0" ]; then
  pass "a copy that leaves the destination empty fails (exit $RC)"
else
  fail "an empty destination after copy was reported as success"
fi

# A file whose extension matches no content-type group is silently skipped by
# the per-extension copy. A destination that merely has SOME objects in it would
# hide that, so the script compares COUNTS - here the source has 4 objects and
# only 3 arrive.
RES="$(run_case 'a.js
b.wasm
c.json
d.css' 'a.js
b.wasm
c.json' 0)"
RC="${RES#*---RC---}"; RC="${RC%%$'
'---ARGV---*}"
if [ "$RC" != "0" ]; then
  pass "a source object that never reached the destination fails the deploy (exit $RC)"
else
  fail "a partially-copied prefix was reported as success - it would serve an incomplete engine"
fi
if grep -q "matches none of the content-type groups" <<<"$RES"; then
  pass "the parity refusal names the cause and says to add a group rather than relax the check"
else
  fail "the parity refusal did not explain itself"
fi

# Stale type declarations must NOT break parity. upload-wasm-to-r2.sh passes
# `--exclude "*.d.ts"`, but `aws s3 sync` never deletes, so the ones written
# before that exclusion existed are still in latest/ -- 8 of them in the real
# bucket, still serving 200. Counting them made parity unsatisfiable and failed
# EVERY deploy (#9599), which is why the source is counted through the same
# exclusion the uploader applies.
RES="$(run_case 'a.js
b.wasm
c.json
forge_engine.d.ts
forge_engine_bg.wasm.d.ts' 'a.js
b.wasm
c.json' 0)"
RC="${RES#*---RC---}"; RC="${RC%%$'
'---ARGV---*}"
if [ "$RC" = "0" ]; then
  pass "stale .d.ts objects in latest/ do not break parity (the uploader excludes them too)"
else
  fail "stale .d.ts objects failed parity - this is #9599, which skipped every production deploy: $(head -3 <<<"$RES")"
fi

# The exclusion is narrow ON PURPOSE. Filtering "whatever did not get copied"
# would make the assertion vacuous; only the uploader's own exclusions come out,
# so a new extension the uploader DOES write must still fail.
RES="$(run_case 'a.js
b.wasm
c.json
forge_engine.d.ts
e.map' 'a.js
b.wasm
c.json' 0)"
RC="${RES#*---RC---}"; RC="${RC%%$'
'---ARGV---*}"
if [ "$RC" != "0" ]; then
  pass "a new uncovered extension still fails parity even alongside excluded .d.ts files"
else
  fail "the .d.ts exclusion was written broadly enough to swallow a genuinely uncopied file - the parity guard is now vacuous"
fi

# Missing configuration is a usage error, not a verdict.
for var in ENGINE_VERSION R2_BUCKET; do
  d="$(mktemp -d)"; make_aws "$d" 'obj1' 'obj1' 0
  if [ "$var" = "ENGINE_VERSION" ]; then
    out="$(AWS_CLI="$d/aws" R2_BUCKET=b bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
  else
    out="$(AWS_CLI="$d/aws" ENGINE_VERSION=v bash "$SCRIPT" 2>&1)" && rc=0 || rc=$?
  fi
  rm -rf "$d"
  if [ "$rc" -ne 0 ]; then
    pass "a missing $var exits non-zero"
  else
    fail "a missing $var was tolerated: $out"
  fi
done

# --- wiring -------------------------------------------------------------------
# The script is only useful if the deploy actually reaches it on the runs where
# the engine did NOT change — which is ~11 of 12.
echo ""
echo "=== cd.yml wiring ==="
if [ ! -f "$CD_YML" ]; then
  fail "cd.yml not found"
else
  if grep -q 'scripts/alias-wasm-cdn-version\.sh' "$CD_YML"; then
    pass "cd.yml calls the alias script"
  else
    fail "cd.yml never calls scripts/alias-wasm-cdn-version.sh"
  fi

  block="$(awk '/^  upload-wasm-cdn:/{f=1; next} f && /^  [a-z][a-z0-9-]*:$/{exit} f' "$CD_YML")"
  if [ -z "$block" ]; then
    fail "cd.yml has no upload-wasm-cdn job"
  else
    # Without always(), an `if:` carries an implicit success() over `needs`, so a
    # SKIPPED build-wasm skips the upload with it. That implicit skip is the
    # whole of #9581.
    if grep -q 'always()' <<<"$block"; then
      pass "upload-wasm-cdn uses always() so a skipped build-wasm cannot cascade-skip it"
    else
      fail "upload-wasm-cdn has no always() — a skipped build-wasm would skip the upload, which IS #9581"
    fi
    if grep -q "needs.build-wasm.result == 'skipped'" <<<"$block"; then
      pass "upload-wasm-cdn has an explicit engine-unchanged path"
    else
      fail "upload-wasm-cdn does not branch on a skipped build-wasm"
    fi
  fi
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
