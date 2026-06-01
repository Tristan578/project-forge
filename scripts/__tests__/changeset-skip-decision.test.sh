#!/usr/bin/env bash
# Unit tests for the "skip" decision in .github/workflows/changeset-check.yml.
#
# The skip decision runs BEFORE checkout (so the gate is cheap for PRs it does
# not apply to), which means the logic MUST live inline in the workflow YAML —
# it cannot be factored into a repo-file script the workflow sources. To test it
# without a drifting copy, this suite extracts the real `run:` block of the step
# with `id: skip` straight from the workflow and exercises it under mocked PR
# contexts, in the same `bash -eo pipefail` shell GitHub Actions uses for `run:`.
set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "python3 required"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW="$HERE/../../.github/workflows/changeset-check.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$WORKFLOW" ] || { echo "workflow not found: $WORKFLOW"; exit 1; }

# Extract the bash body of the step whose id is `skip` — the single source of
# truth. No PyYAML dependency: walk indentation from `id: skip` to the next
# `run: |`, capture the block scalar, and dedent it.
SKIP_SCRIPT="$(python3 - "$WORKFLOW" <<'PY'
import sys
lines = open(sys.argv[1]).read().splitlines()
try:
    i = next(idx for idx, l in enumerate(lines) if l.strip() == "id: skip")
    j = next(idx for idx in range(i, len(lines)) if lines[idx].strip().startswith("run: |"))
except StopIteration:
    sys.exit("could not locate the `id: skip` step's run block")
run_indent = len(lines[j]) - len(lines[j].lstrip())
body = []
for l in lines[j + 1:]:
    if l.strip() == "":
        body.append("")
        continue
    if (len(l) - len(l.lstrip())) <= run_indent:
        break
    body.append(l)
nonempty = [l for l in body if l.strip()]
common = min((len(l) - len(l.lstrip()) for l in nonempty), default=0)
print("\n".join(l[common:] if l.strip() else "" for l in body))
PY
)"

if [ -z "${SKIP_SCRIPT// /}" ]; then
  echo "FAILED to extract the skip step's run block"
  exit 1
fi

# Run the extracted decision under the same shell flags GitHub Actions uses for
# `run:` blocks (bash -e -o pipefail), with a throwaway GITHUB_OUTPUT, and echo
# the resulting skip value.
run_decision() {
  local labels="$1" title="$2" actor="$3" head="$4"
  local out
  out="$(mktemp)"
  LABELS="$labels" PR_TITLE="$title" ACTOR="$actor" HEAD_REF="$head" GITHUB_OUTPUT="$out" \
    bash -eo pipefail -c "$SKIP_SCRIPT" >/dev/null 2>&1
  grep -oE 'skip=(true|false)' "$out" | tail -1 | cut -d= -f2
  rm -f "$out"
}

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$desc (skip=$actual)"
  else
    fail "$desc — expected skip=$expected, got '$actual'"
  fi
}

echo "=== changeset-check.yml skip-decision tests ==="

# --- Preserved behavior (label + Version Packages title) -----------------------
check "skip changeset label bypasses" true \
  "$(run_decision '["skip changeset"]' 'fix: a thing' 'human' 'feature/x')"
check "Version Packages PR bypasses" true \
  "$(run_decision '[]' 'chore: version packages' 'github-actions[bot]' 'changeset-release/main')"

# --- New behavior: Dependabot non-npm ecosystems bypass ------------------------
check "dependabot cargo bump bypasses" true \
  "$(run_decision '["dependencies"]' 'chore(deps): bump emath' 'dependabot[bot]' 'dependabot/cargo/engine/emath-0.34.3')"
check "dependabot github_actions bump bypasses" true \
  "$(run_decision '["dependencies"]' 'chore(deps): bump gh-aw' 'dependabot[bot]' 'dependabot/github_actions/github/gh-aw-abc123')"

# --- npm Dependabot is deliberately NOT bypassed (a user-facing runtime bump
#     still needs a changeset decision, or the explicit label) -----------------
check "dependabot npm bump is NOT bypassed" false \
  "$(run_decision '["dependencies"]' 'chore(deps): bump portless' 'dependabot[bot]' 'dependabot/npm_and_yarn/web/minor-and-patch-x')"
check "dependabot npm bump WITH skip label still bypasses (label path intact)" true \
  "$(run_decision '["skip changeset"]' 'chore(deps): bump portless' 'dependabot[bot]' 'dependabot/npm_and_yarn/web/x')"

# --- Actor-gated: a human pushing a dependabot-looking branch is NOT bypassed --
check "non-dependabot actor on a cargo-prefixed branch is NOT bypassed" false \
  "$(run_decision '[]' 'feat: x' 'human' 'dependabot/cargo/engine/x')"

# --- Ordinary PR is not bypassed ----------------------------------------------
check "ordinary feature PR is not bypassed" false \
  "$(run_decision '[]' 'feat: add a feature' 'human' 'feature/add-a-feature')"

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
