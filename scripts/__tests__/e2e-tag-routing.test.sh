#!/usr/bin/env bash
# Every @ui spec must be routed to a job that can actually run it.
#
# WHY THIS EXISTS (#9586)
#
# The "E2E UI Tests" job is a required check, so the board read as though the
# application was exercised on every PR. It was not. The job selected `@ui` and
# then grep-inverted `@dev` -- and almost every editor spec is tagged `@ui @dev`,
# so the filter excluded the specs by the same expression that selected them.
# 91 of 422 tests ran, all public pages and API routes. Nothing signed in and
# nothing opened the editor.
#
# That is invisible from a green board: the job passes, the shards look busy,
# and the excluded specs simply do not appear anywhere. Two production defects
# went out underneath it.
#
# So the routing itself is pinned. A tag may be excluded from the @ui job only
# if some other job selects it; an exclusion with nowhere to land silently
# deletes coverage while the required check stays green.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CI_YML="${E2E_TAG_ROUTING_CI_YML:-$HERE/../../.github/workflows/ci.yml}"
CD_YML="${E2E_TAG_ROUTING_CD_YML:-$HERE/../../.github/workflows/cd.yml}"
E2E_DIR="${E2E_TAG_ROUTING_E2E_DIR:-$HERE/../../web/e2e}"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

if [ ! -f "$CI_YML" ]; then
  echo "  FAIL: ci.yml not found at $CI_YML"
  echo "SUITE FAILED"
  exit 1
fi

echo "=== the @ui job must build the editor it claims to test ==="

ui_job="$(awk '/^  test-e2e-ui:/{f=1} f{print} f && /^  [a-z][a-z0-9-]*:$/ && !/test-e2e-ui/{exit}' "$CI_YML")"
if [ -z "$ui_job" ]; then
  # Fall back to locating by the run line, so a job rename does not silently
  # turn this whole suite into a no-op.
  ui_job="$(grep -n -B40 "grep '@ui'" "$CI_YML" | sed 's/^[0-9]*[-:]//')"
fi
if [ -z "$ui_job" ]; then
  fail "could not locate the @ui E2E job in ci.yml — this suite would pass vacuously"
else
  # Without NEXT_PUBLIC_E2E_HOOKS the /dev route redirects to /sign-in and the
  # editor stores are not exposed, so every editor spec is unrunnable no matter
  # what the grep says. That flag is the difference between a gate and a label.
  if grep -q 'NEXT_PUBLIC_E2E_HOOKS' <<<"$ui_job"; then
    pass "the @ui job builds with NEXT_PUBLIC_E2E_HOOKS (so /dev renders and the editor specs can run)"
  else
    fail "the @ui job does not set NEXT_PUBLIC_E2E_HOOKS — /dev redirects to /sign-in, so every editor spec is excluded by necessity and the job tests public pages only (#9586)"
  fi
fi

echo ""
echo "=== no tag may be excluded from the @ui job without another job running it ==="

invert="$(grep -oE "grep-invert '[^']+'" "$CI_YML" | head -1 | sed -E "s/grep-invert '([^']+)'/\1/")"
if [ -z "$invert" ]; then
  fail "could not read the @ui job's --grep-invert expression"
else
  echo "  (@ui excludes: ${invert})"
  IFS='|' read -r -a excluded <<< "$invert"
  for tag in "${excluded[@]}"; do
    [ -n "$tag" ] || continue
    # Some OTHER playwright invocation must select this tag, or the specs
    # carrying it run nowhere at all.
    if grep -E "playwright test" "$CI_YML" | grep -v -- "--grep-invert" | grep -qF -- "$tag" \
       || grep -rqF -- "$tag" "$HERE/../../web/playwright."*.config.ts 2>/dev/null; then
      pass "'${tag}' is excluded from @ui but selected by another job or config"
    else
      fail "'${tag}' is excluded from the @ui job and NO other job or config selects it — specs carrying it run nowhere, while the required check stays green (this is exactly #9586)"
    fi
  done
fi

echo ""
echo "=== ci.yml and cd.yml must run the SAME @ui selection ==="
# These are the only two places the @ui suite runs. When they drift, the deploy
# path keeps a hole the PR gate has already closed -- which is exactly what
# happened: ci.yml was fixed to stop excluding the editor specs and cd.yml was
# left excluding them, so deploys would still have tested 91 of 422 (#9586).
# Fixing one of two identical call sites is the same mistake that produced the
# CDN failures this milestone chased, so it is asserted rather than remembered.
if [ ! -f "$CD_YML" ]; then
  fail "cd.yml not found at $CD_YML — cannot verify the deploy path runs the same selection"
else
  ci_sel="$(grep -oE "grep-invert '[^']+'" "$CI_YML" | head -1)"
  cd_sel="$(grep -oE "grep-invert '[^']+'" "$CD_YML" | head -1)"
  if [ -z "$ci_sel" ] || [ -z "$cd_sel" ]; then
    fail "could not read the @ui selection from both workflows (ci='${ci_sel:-none}' cd='${cd_sel:-none}') — this rule would pass vacuously"
  elif [ "$ci_sel" = "$cd_sel" ]; then
    pass "ci.yml and cd.yml exclude the same tags (${ci_sel})"
  else
    fail "the @ui selection has drifted — ci.yml uses ${ci_sel} but cd.yml uses ${cd_sel}; the deploy path tests a different set than the PR gate"
  fi

  # The hooks build is half the fix; a matching grep against a store-less build
  # still cannot open the editor.
  cd_job="$(awk '/^  test-e2e-ui:/{f=1} f{print} f && /^  [a-z][a-z0-9-]*:$/ && !/test-e2e-ui/{exit}' "$CD_YML")"
  [ -n "$cd_job" ] || cd_job="$(grep -B40 "grep '@ui'" "$CD_YML")"
  if grep -q 'NEXT_PUBLIC_E2E_HOOKS' <<<"$cd_job"; then
    pass "cd.yml's @ui job also builds with NEXT_PUBLIC_E2E_HOOKS"
  else
    fail "cd.yml's @ui job does not set NEXT_PUBLIC_E2E_HOOKS — /dev redirects to /sign-in there, so the deploy path still tests public pages only"
  fi
fi

echo ""
echo "=== @dev must no longer be used as an exclusion ==="
# The specific regression: @dev is the tag on ~all editor specs, so excluding it
# empties the gate. Routing is by capability now (@engine-ui), not by which
# route a spec happens to use.
if grep -qE "grep-invert '[^']*@dev" "$CI_YML"; then
  fail "ci.yml still grep-inverts @dev — that is the filter that removed 331 of 422 tests while the job read as an application gate (#9586)"
else
  pass "no job excludes @dev (editor specs are routed by capability, not by route)"
fi

echo ""
echo "=== the @engine-ui tag is real and applied ==="
if [ ! -d "$E2E_DIR" ]; then
  fail "e2e directory not found at $E2E_DIR"
else
  n="$(grep -rho '@engine-ui' "$E2E_DIR" --include=*.spec.ts 2>/dev/null | grep -c . || true)"
  if [ "${n:-0}" -gt 0 ]; then
    pass "@engine-ui is applied to ${n} test(s) — the canvas-dependent set, which needs a live engine"
  else
    fail "no spec carries @engine-ui, but the @ui job excludes it — either the tag was removed and its specs now run nowhere, or the exclusion is stale"
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
