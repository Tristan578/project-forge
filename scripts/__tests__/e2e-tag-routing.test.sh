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

# A `run: |` block may spread one command over several physical lines with a
# trailing backslash (quality-gates.yml does exactly this). grep hands back a
# single physical line, so any --config/--project sitting past the break is
# invisible and the scan below silently falls back to its defaults -- which
# credit every project the default config declares. Join the continuations
# first so a flag is found wherever the author wrapped the command.
join_continuations() {
  awk '{
    line = $0
    sub(/[[:space:]]+$/, "", line)
    if (line ~ /\\$/) { sub(/\\$/, "", line); buf = buf line " "; next }
    print buf line
    buf = ""
  } END { if (buf != "") print buf }' "$1"
}

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
echo "=== the real Upstash probe must use only CI-scoped credentials ==="

# GitHub expressions are literal fixture text here; single quotes deliberately prevent shell expansion.
# shellcheck disable=SC2016
if grep -qF 'UPSTASH_REDIS_REST_URL: ${{ secrets.CI_UPSTASH_REDIS_REST_URL }}' <<<"$ui_job" \
   && grep -qF 'UPSTASH_REDIS_REST_TOKEN: ${{ secrets.CI_UPSTASH_REDIS_REST_TOKEN }}' <<<"$ui_job"; then
  pass "the @ui job maps both CI-scoped Upstash secrets to the runtime names"
else
  fail "the @ui job does not map both CI_UPSTASH secrets — the real integration probe cannot run"
fi

if grep -qE 'secrets\.UPSTASH_REDIS_REST_(URL|TOKEN)' "$CI_YML"; then
  fail "ci.yml references production-named Upstash secrets — only CI_UPSTASH_* is allowed"
else
  pass "ci.yml never references production-named Upstash secrets"
fi

if grep -qF 'E2E_UPSTASH_TEST_REQUIRED:' <<<"$ui_job" \
   && grep -rqF -- "@ui real Upstash rate limit" "$E2E_DIR"; then
  pass "trusted CI requires the tagged real-Upstash probe"
else
  fail "the real-Upstash spec or its trusted-CI requirement is missing"
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
echo "=== every declared Playwright project is executed by some workflow (#9610) ==="
# firefox, webkit, mobile-iphone and mobile-pixel sat in playwright.config.ts
# for months and were executed by nothing: every workflow passed
# --project=chromium or a chromium-only config, so cross-browser coverage was
# a label. Declared-but-unrun is the #9586 shape again — nothing red, nothing
# run. A project counts as executed when some workflow either names it with
# --project, or invokes its config without --project (all of that config's
# projects run).
#
# The unit is the (config, project) PAIR, not the bare name. Two configs may
# declare the same name — `firefox` exists in both playwright.config.ts and
# playwright.crossbrowser.config.ts — and they are different projects: they
# carry different `use` blocks, different webServers and different timeouts.
# Matching on the bare name would credit an unrun project because a DIFFERENT
# file's same-named project runs, which is precisely the coverage-that-reads-
# as-present condition this block exists to catch.
WEB_DIR="$(cd "$E2E_DIR/.." 2>/dev/null && pwd)"
declared=""
for cfg in "$WEB_DIR"/playwright*.config.ts; do
  [ -f "$cfg" ] || continue
  base="$(basename "$cfg")"
  while IFS= read -r name; do
    [ -n "$name" ] && declared="${declared}${base}:${name}"$'\n'
  done < <(grep -oE "^[[:space:]]*name: '[^']+'" "$cfg" | sed -E "s/.*name: '([^']+)'/\1/")
done
executed=""
unresolved=""
# The literal three bytes that open a GitHub Actions expression. Assembled
# rather than written as '${{' so shellcheck does not read the case pattern
# below as an expansion someone forgot to double-quote (SC2016) -- the CI
# CI lint step runs at default severity, where an info finding is a red job.
matrix_ref_prefix='$'"{{"
for wf in "$CI_YML" "$CD_YML" "$(dirname "$CI_YML")/quality-gates.yml"; do
  [ -f "$wf" ] || continue
  while IFS= read -r line; do
    cfg="$(grep -oE -- '--config[= ]+[^ ]+' <<<"$line" | head -1 | sed -E 's/--config[= ]+//')"
    cfg="$(basename "${cfg:-playwright.config.ts}")"
    raw="$(grep -oE -- '--project[= ]+[^ ]+' <<<"$line" | sed -E 's/--project[= ]+//')"
    projects=""
    for p in $raw; do
      case "$p" in
        "$matrix_ref_prefix"*)
          # `--project=${{ matrix.<key> }}`. Splitting the line on spaces leaves
          # only the opening brace, so re-read the key from the whole line and
          # expand it from that workflow's own `<key>: [a, b, c]`. Without this
          # the flag resolves to a name no config declares, and every real
          # project silently reports as unexecuted.
          key="$(grep -oE -- '--project[= ]*\$\{\{[[:space:]]*matrix\.[A-Za-z0-9_]+' <<<"$line" | head -1 | sed -E 's/.*matrix\.//')"
          vals=""
          [ -n "$key" ] && vals="$(grep -oE "^[[:space:]]*${key}:[[:space:]]*\[[^]]*\]" "$wf" \
            | sed -E "s/^[[:space:]]*${key}:[[:space:]]*\[//; s/\]$//" | tr ',' ' ' | tr -d "'\"")"
          if [ -n "${vals// /}" ]; then
            for v in $vals; do projects="${projects} ${v}"; done
          else
            # Fail CLOSED. Falling through to the no-flag branch below would
            # credit every project the config declares -- the exact fail-open
            # this block exists to prevent.
            unresolved="${unresolved} ${cfg}"
          fi
          ;;
        *) projects="${projects} ${p}" ;;
      esac
    done
    if [ -n "${projects// /}" ] || [ -n "${unresolved// /}" ]; then
      for p in $projects; do executed="${executed}${cfg}:${p}"$'\n'; done
    else
      while IFS= read -r entry; do
        [ -n "$entry" ] && executed="${executed}${entry}"$'\n'
      done < <(grep "^${cfg}:" <<<"$declared" || true)
    fi
  done < <(join_continuations "$wf" | grep 'playwright test' | grep -vE '^[[:space:]]*#')
done
if [ -z "${unresolved// /}" ]; then
  pass "every --project flag resolved to a concrete project name"
else
  fail "could not resolve a --project value for:${unresolved} — an unresolvable flag must not be treated as 'runs everything' (#9610)"
fi
pairs="$(sort -u <<<"$declared" | grep . || true)"
exec_pairs="$(sort -u <<<"$executed" | grep . || true)"
# Declared projects that no workflow runs, each with the reason on record.
# Entries are `<config basename>:<project name>` — the same pair form as
# $declared, so an allowlist cannot accidentally cover a same-named project
# in a different config.
#   playwright.agent.config.ts:agent-chromium — the agentic browser harness,
#                    driven by hand against a dev server; no workflow runs it
#                    by design (#9610 records this as a policy decision).
ALLOWLIST_UNEXECUTED="playwright.agent.config.ts:agent-chromium"
pair_count="$(grep -c . <<<"$pairs" || true)"
# Floor, not a pin: adding a config or a project may only raise this. Measured
# at 10 when written. A walk over zero pairs would otherwise pass vacuously.
if [ "${pair_count:-0}" -ge 8 ]; then
  pass "enumerated ${pair_count} (config, project) pairs across the configs (a walk over zero pairs would pass vacuously)"
else
  fail "enumerated only ${pair_count:-0} (config, project) pairs — the config glob or the name: pattern no longer matches"
fi
missing=""
for n in $pairs; do
  if grep -qx "$n" <<<"$exec_pairs"; then continue; fi
  allowed=false
  for a in $ALLOWLIST_UNEXECUTED; do [ "$a" = "$n" ] && allowed=true; done
  [ "$allowed" = true ] || missing="${missing} ${n}"
done
if [ -z "$missing" ]; then
  pass "every declared project is executed by a workflow or allowlisted with a reason (executed: $(tr '\n' ' ' <<<"$exec_pairs"))"
else
  fail "declared but executed by NO workflow:${missing} — a project that runs nowhere is coverage that reads as present (#9610)"
fi
for a in $ALLOWLIST_UNEXECUTED; do
  if grep -qx "$a" <<<"$pairs"; then
    pass "allowlisted project '${a}' still exists (the allowlist is not stale)"
  else
    fail "allowlisted project '${a}' is no longer declared anywhere — drop it from ALLOWLIST_UNEXECUTED"
  fi
done

echo ""
echo "=== a playwright step whose webServer runs \`next start\` must set SKIP_ENV_VALIDATION (#9610) ==="
# web/src/instrumentation.ts throws "Server startup aborted: missing required
# environment variables" when NODE_ENV === 'production' and SKIP_ENV_VALIDATION
# is unset, and CI has no Clerk/Stripe keys. Playwright's webServer inherits the
# environment of the step that INVOKES playwright, not the step that built the
# app -- so setting the flag only on `next build` leaves the server dead, the
# health-check URL unanswered, and the run dies at the webServer timeout having
# executed zero tests. On a continue-on-error job that reads as green. Shipped
# on the first cut of the cross-browser job (#9663) and caught in review.
prod_checked=0
for wf in "$CI_YML" "$CD_YML" "$(dirname "$CI_YML")/quality-gates.yml"; do
  [ -f "$wf" ] || continue
  while IFS=: read -r lineno _; do
    [ -n "$lineno" ] || continue
    logical="$(tail -n "+${lineno}" "$wf" | join_continuations /dev/stdin | head -1)"
    cfg="$(grep -oE -- '--config[= ]+[^ ]+' <<<"$logical" | head -1 | sed -E 's/--config[= ]+//')"
    cfg="$(basename "${cfg:-playwright.config.ts}")"
    cfg_path="$WEB_DIR/$cfg"
    [ -f "$cfg_path" ] || continue
    # Only the webServer stanza counts -- `next start` in a comment is not a
    # server.
    grep -A8 'webServer' "$cfg_path" | grep -q "command:.*next start" || continue
    prod_checked=$((prod_checked + 1))
    # Walk back to the top of the enclosing step (a `- ` list item at step
    # indentation) and look for the flag anywhere in it.
    step_start="$(head -n "$lineno" "$wf" | grep -nE '^[[:space:]]{6}- ' | tail -1 | cut -d: -f1)"
    step_start="${step_start:-1}"
    step="$(sed -n "${step_start},${lineno}p" "$wf")"
    if grep -q 'SKIP_ENV_VALIDATION' <<<"$step"; then
      pass "$(basename "$wf"):${lineno} runs ${cfg} (next start) and sets SKIP_ENV_VALIDATION"
    else
      fail "$(basename "$wf"):${lineno} runs ${cfg}, whose webServer is \`next start\`, without SKIP_ENV_VALIDATION on the step — the server aborts at boot and the job runs ZERO tests (#9610)"
    fi
  done < <(grep -n 'playwright test' "$wf" | grep -vE ':[[:space:]]*#')
done
# The floor is the MEASURED count, not a token non-zero: at 4 or less this
# section still reported green when join_continuations was removed and one
# wrapped invocation went invisible. Adding a playwright job raises this;
# removing one lowers it, and either way the number is checked by a human.
EXPECTED_PROD_WEBSERVER_INVOCATIONS=5
if [ "$prod_checked" -eq "$EXPECTED_PROD_WEBSERVER_INVOCATIONS" ]; then
  pass "checked ${prod_checked} playwright invocations against a production webServer (a walk over zero would pass vacuously)"
else
  fail "found ${prod_checked} playwright invocation(s) against a \`next start\` config, expected ${EXPECTED_PROD_WEBSERVER_INVOCATIONS} — a job was added or removed, or the scan stopped seeing one (update EXPECTED_PROD_WEBSERVER_INVOCATIONS deliberately)"
fi

echo ""
echo "=== a non-blocking e2e job must still be un-disableable in one line (#9610) ==="
# test-e2e-crossbrowser is deliberately continue-on-error for its first landing,
# so it is NOT in ci-success's `needs:` and therefore NOT in check-ci-success.sh's
# check_triggered map -- the anti-tamper pass that makes `if: false` on a mapped
# gate go red. Without a substitute the job could be switched off by one line
# with every required check still green, which is lessons-learned #4's family.
# Deleting the run step is already caught (the executed-projects scan above turns
# firefox/webkit/mobile-* into unexecuted declared projects). What is left is the
# `if:` itself, so pin it here. When the job becomes blocking -- drop
# continue-on-error, add it to ci-success's needs: and to check_triggered -- this
# section becomes redundant, not wrong.
xb_job="$(awk '/^  test-e2e-crossbrowser:/{f=1} f{print} f && /^  [a-z][a-z0-9-]*:$/ && !/test-e2e-crossbrowser/{exit}' "$CI_YML")"
if [ -z "$xb_job" ]; then
  fail "no test-e2e-crossbrowser job in ci.yml — firefox/webkit/mobile specs have no execution site (#9610)"
else
  xb_if="$(grep -E '^    if:' <<<"$xb_job" | head -1)"
  if grep -q 'needs-web' <<<"$xb_if"; then
    pass "test-e2e-crossbrowser is gated on the ci-gate needs-web output, not a literal"
  else
    fail "test-e2e-crossbrowser's job-level if: does not reference needs-web (found: ${xb_if:-none}) — a non-blocking job with an unpinned gate can be disabled in one line (#9610)"
  fi
fi

disabled=""
for wf in "$CI_YML" "$CD_YML" "$(dirname "$CI_YML")/quality-gates.yml"; do
  [ -f "$wf" ] || continue
  hits="$(grep -nE '^    if:[[:space:]]*(false|\$\{\{[[:space:]]*false[[:space:]]*\}\})[[:space:]]*$' "$wf" || true)"
  [ -n "$hits" ] && disabled="${disabled} $(basename "$wf"):$(cut -d: -f1 <<<"$hits" | tr '\n' ',')"
done
if [ -z "${disabled// /}" ]; then
  pass "no job in ci.yml/cd.yml/quality-gates.yml is gated on a literal false"
else
  fail "job(s) gated on a literal false:${disabled} — a disabled job still resolves in needs: and reports as a legitimate skip"
fi

echo ""
echo "=== every per-project testMatch must select at least one spec (#9663) ==="
# The two mobile projects narrow to the compact-layout suite rather than running
# the whole @ui selection, because below 1024px getLayoutConfig() returns
# mode 'compact' and EditorLayout renders no Dockview at all -- the desktop
# editor specs assert markup that deliberately does not exist there.
#
# The cost of that narrowing is a new fail-open: rename or move the spec files
# and the glob matches nothing, the project runs ZERO tests, and it reports
# green. That is #9586's shape exactly -- nothing red, nothing run -- so the
# selection is asserted rather than trusted.
# Emit one effective glob per per-project `testMatch:` in $1. A testMatch whose
# value is a bare identifier is looked up as a top-level `const NAME = '...'` in
# the same file, so hoisting the literal into a named constant does not make the
# entry invisible to this scan -- an invisible entry is an unchecked one.
resolve_test_match_globs() {
  local cfg="$1" raw
  while IFS= read -r raw; do
    [ -n "$raw" ] || continue
    case "$raw" in
      "'"*) sed -E "s/^'(.*)'$/\1/" <<<"$raw" ;;
      *) grep -oE "^const ${raw} = '[^']+'" "$cfg" | sed -E "s/.*= '([^']+)'/\1/" | head -1 ;;
    esac
  done < <(grep -oE "^[[:space:]]{4,}testMatch: ('[^']+'|[A-Za-z_][A-Za-z0-9_]*)" "$cfg" \
    | sed -E 's/.*testMatch: //')
}

match_count=0
empty_globs=""
for cfg in "$WEB_DIR"/playwright*.config.ts; do
  [ -f "$cfg" ] || continue
  while IFS= read -r glob; do
    [ -n "$glob" ] || continue
    match_count=$((match_count + 1))
    # Only the leading `**/` form is used here; anything else is reported so a
    # new shape cannot pass unchecked.
    case "$glob" in
      '**/'*) pattern="${glob#'**/'}" ;;
      *) empty_globs="${empty_globs} $(basename "$cfg"):${glob}(unsupported-shape)"; continue ;;
    esac
    n="$(find "$E2E_DIR" -name "$pattern" -type f 2>/dev/null | grep -c . || true)"
    if [ "${n:-0}" -gt 0 ]; then
      pass "$(basename "$cfg") testMatch '${glob}' selects ${n} spec file(s)"
    else
      empty_globs="${empty_globs} $(basename "$cfg"):${glob}"
    fi
  done < <(resolve_test_match_globs "$cfg")
done
if [ -n "${empty_globs// /}" ]; then
  fail "per-project testMatch selecting NO spec file:${empty_globs} — that project runs zero tests and reports green (#9586's shape)"
fi
# Floor, not a pin: measured at 2 (mobile-iphone, mobile-pixel) when written.
# A walk over zero testMatch entries would report a clean section while every
# narrowed project ran nothing.
EXPECTED_PROJECT_TESTMATCH=2
if [ "$match_count" -ge "$EXPECTED_PROJECT_TESTMATCH" ]; then
  pass "inspected ${match_count} per-project testMatch entrie(s) (a walk over zero would pass vacuously)"
else
  fail "found ${match_count} per-project testMatch entrie(s), expected at least ${EXPECTED_PROJECT_TESTMATCH} — the grep no longer sees them, so this whole section is vacuous"
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
