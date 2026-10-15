#!/usr/bin/env bash
# Pin for engine/.cargo/audit.toml — the cargo-audit ignore list.
#
# WHY THIS SUITE EXISTS
# `cargo audit` reads `.cargo/audit.toml` from its working directory, and the
# Quality Gates job runs it with `working-directory: engine`, so an id in that
# file silences the advisory on every CI run from then on. That is the right
# tool for an advisory no relock can fix (RUSTSEC-2026-0344, ruzstd pinned by
# bevy_image 0.19.1's `^0.8`, #10393) and the wrong tool for everything else.
# A silenced advisory is invisible by construction, so the file has to be the
# loud part: every id must carry, in the comment block directly above it, why
# it is unfixable, what the exposure is, and when it must be lifted with a
# tracking issue — and the list itself is pinned HERE, so adding an id means
# editing this suite in the same change (review sees both).
#
# Exit codes: 0 when every case passes, 1 otherwise. Assertions use explicit
# if/then/else (not `A && ok || bad`) so the suite is SC2015-clean, and grep is
# fed from here-strings, never `echo "$big" | grep` (SIGPIPE under pipefail).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUDIT_TOML="$REPO_ROOT/engine/.cargo/audit.toml"
QUALITY_GATES="$REPO_ROOT/.github/workflows/quality-gates.yml"

# The ONLY advisories allowed in the ignore list. Add one here and in the toml
# together, with the toml's comment block; remove both when the lift condition
# is met.
EXPECTED_IGNORES=("RUSTSEC-2026-0344")

command -v grep   >/dev/null 2>&1 || { echo "FATAL: grep not found on host";   exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "FATAL: mktemp not found on host"; exit 1; }

PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# --- the checker ---------------------------------------------------------------
# check_audit_toml <file> → prints problems, one per line; prints nothing when
# the file is well-formed. Pure text, no toml parser: the shape is narrow.
check_audit_toml() {
  local file="$1"
  local content
  content="$(cat "$file")"

  if ! grep -qE '^\[advisories\]$' <<<"$content"; then
    echo "no [advisories] table"
  fi
  if ! grep -qE '^ignore = \[$' <<<"$content"; then
    echo "no 'ignore = [' list"
  fi

  # Every quoted id inside the list, in order.
  local ids
  ids="$(grep -oE '^  "RUSTSEC-[0-9]{4}-[0-9]{4}",?$' <<<"$content" | tr -d ' ",')"
  if [[ -z "$ids" ]]; then
    echo "ignore list is empty: delete the file instead of keeping an empty list"
  fi

  # Any quoted string in the list that is not a RUSTSEC id is a malformed entry
  # cargo-audit would reject or, worse, silently ignore.
  local stray
  stray="$(grep -E '^  "' <<<"$content" | grep -vE '^  "RUSTSEC-[0-9]{4}-[0-9]{4}",?$' || true)"
  if [[ -n "$stray" ]]; then
    echo "malformed entry: $stray"
  fi

  # Each id's comment block: the contiguous `  #` lines directly above it must
  # name the advisory, and carry unfixable:, exposure:, lift when: and a
  # tracking issue (#NNNN).
  local id
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    local block
    block="$(awk -v id="\"$id\"" '
      index($0, id) == 3 { print buf; exit }
      /^  #/ { buf = buf "\n" $0; next }
      { buf = "" }
    ' "$file")"
    if ! grep -q "$id" <<<"$block"; then
      echo "$id: comment block above it does not name the advisory"
    fi
    for key in "unfixable:" "exposure:" "lift when:"; do
      if ! grep -qF "$key" <<<"$block"; then
        echo "$id: comment block lacks '$key'"
      fi
    done
    if ! grep -qE '#[0-9]{3,6}' <<<"$block"; then
      echo "$id: comment block names no tracking issue (#NNNN)"
    fi
  done <<<"$ids"

  # The list is exactly the pinned set, in any order.
  local expected_sorted actual_sorted
  expected_sorted="$(printf '%s\n' "${EXPECTED_IGNORES[@]}" | sort)"
  actual_sorted="$(sort <<<"$ids" | sed '/^$/d')"
  if [[ "$expected_sorted" != "$actual_sorted" ]]; then
    echo "ignore list differs from the pinned set: expected [$(tr '\n' ' ' <<<"$expected_sorted")] got [$(tr '\n' ' ' <<<"$actual_sorted")]"
  fi
}

# --- 1. the committed file is well-formed ------------------------------------
echo "1. committed engine/.cargo/audit.toml"
if [[ ! -f "$AUDIT_TOML" ]]; then
  bad "engine/.cargo/audit.toml is missing (the pinned set is non-empty)"
else
  problems="$(check_audit_toml "$AUDIT_TOML")"
  if [[ -z "$problems" ]]; then
    ok "well-formed: every id has unfixable/exposure/lift-when/tracking, list equals the pin"
  else
    bad "committed file: $problems"
  fi
fi

# --- 2. the gate actually reads it --------------------------------------------
# cargo-audit resolves .cargo/audit.toml from its working directory. The step
# must run from engine/ for the file to apply; a step that ran `cargo audit`
# from the repo root would ignore the file and the list would be decorative.
echo "2. quality-gates.yml runs cargo audit from engine/"
step="$(awk '/name: cargo audit \(engine\)/{p=1} p{print} p && /run:/{exit}' "$QUALITY_GATES")"
if grep -qE '^\s*working-directory: engine$' <<<"$step" && grep -qE '^\s*run: cargo audit$' <<<"$step"; then
  ok "the 'cargo audit (engine)' step has working-directory: engine and runs plain cargo audit"
else
  bad "the 'cargo audit (engine)' step does not run from engine/ (or runs something other than 'cargo audit'); the ignore file would not be read: $step"
fi

# --- 3. the checker is falsifiable (mutations of a fixture) ------------------
echo "3. checker refuses malformed ignore files"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

write_fixture() { # <file> <comment-lines...> ; writes a one-id list
  local f="$1"; shift
  {
    echo "[advisories]"
    echo "ignore = ["
    for line in "$@"; do echo "  # $line"; done
    echo "  \"RUSTSEC-2026-0344\","
    echo "]"
  } >"$f"
}

good_lines=("RUSTSEC-2026-0344: ruzstd 0.8.2 decompression bomb." "unfixable: bevy_image 0.19.1 pins ^0.8." "exposure: only Bevy's embedded LUT." "lift when: Bevy >= 0.20. Tracking: #10393.")

write_fixture "$tmp/good.toml" "${good_lines[@]}"
if [[ -z "$(check_audit_toml "$tmp/good.toml")" ]]; then ok "accepts a complete entry"; else bad "rejects a complete entry: $(check_audit_toml "$tmp/good.toml")"; fi

write_fixture "$tmp/no-unfixable.toml" "${good_lines[0]}" "${good_lines[2]}" "${good_lines[3]}"
if grep -q "lacks 'unfixable:'" <<<"$(check_audit_toml "$tmp/no-unfixable.toml")"; then ok "refuses an entry without unfixable:"; else bad "accepted an entry without unfixable:"; fi

write_fixture "$tmp/no-exposure.toml" "${good_lines[0]}" "${good_lines[1]}" "${good_lines[3]}"
if grep -q "lacks 'exposure:'" <<<"$(check_audit_toml "$tmp/no-exposure.toml")"; then ok "refuses an entry without exposure:"; else bad "accepted an entry without exposure:"; fi

write_fixture "$tmp/no-lift.toml" "${good_lines[0]}" "${good_lines[1]}" "${good_lines[2]}" "Tracking: #10393."
if grep -q "lacks 'lift when:'" <<<"$(check_audit_toml "$tmp/no-lift.toml")"; then ok "refuses an entry without lift when:"; else bad "accepted an entry without lift when:"; fi

write_fixture "$tmp/no-issue.toml" "${good_lines[0]}" "${good_lines[1]}" "${good_lines[2]}" "lift when: Bevy >= 0.20."
if grep -q "names no tracking issue" <<<"$(check_audit_toml "$tmp/no-issue.toml")"; then ok "refuses an entry without a tracking issue"; else bad "accepted an entry without a tracking issue"; fi

write_fixture "$tmp/no-name.toml" "unfixable: x." "exposure: y." "lift when: z. Tracking: #10393."
if grep -q "does not name the advisory" <<<"$(check_audit_toml "$tmp/no-name.toml")"; then ok "refuses a comment block that does not name its advisory"; else bad "accepted a comment block that does not name its advisory"; fi

# An id separated from its block by a blank line has NO block.
{
  echo "[advisories]"; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo ""
  echo "  \"RUSTSEC-2026-0344\","; echo "]"
} >"$tmp/detached.toml"
if [[ -n "$(check_audit_toml "$tmp/detached.toml")" ]]; then ok "refuses a comment block detached from its id by a blank line"; else bad "accepted a detached comment block"; fi

# An extra id, even fully documented, is refused until the pin here is edited.
{
  echo "[advisories]"; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo "  \"RUSTSEC-2026-0344\","
  echo "  # RUSTSEC-2099-0001: made up."; echo "  # unfixable: a."; echo "  # exposure: b."; echo "  # lift when: c. Tracking: #10393."
  echo "  \"RUSTSEC-2099-0001\","; echo "]"
} >"$tmp/extra.toml"
if grep -q "differs from the pinned set" <<<"$(check_audit_toml "$tmp/extra.toml")"; then ok "refuses an id that is not in the pinned set"; else bad "accepted an unpinned id"; fi

# A non-RUSTSEC string in the list is malformed.
{
  echo "[advisories]"; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo "  \"RUSTSEC-2026-0344\","; echo "  \"ruzstd\","; echo "]"
} >"$tmp/stray.toml"
if grep -q "malformed entry" <<<"$(check_audit_toml "$tmp/stray.toml")"; then ok "refuses a non-advisory string in the list"; else bad "accepted a non-advisory string"; fi

# An empty list is refused: delete the file instead.
printf '[advisories]\nignore = [\n]\n' >"$tmp/empty.toml"
if grep -q "ignore list is empty" <<<"$(check_audit_toml "$tmp/empty.toml")"; then ok "refuses an empty ignore list"; else bad "accepted an empty ignore list"; fi

# --- 4. the step pin is falsifiable --------------------------------------------
echo "4. step pin refuses a root-directory cargo audit"
mutated="$(sed 's/^\(\s*\)working-directory: engine$/\1working-directory: ./' "$QUALITY_GATES")"
mstep="$(awk '/name: cargo audit \(engine\)/{p=1} p{print} p && /run:/{exit}' <<<"$mutated")"
if grep -qE '^\s*working-directory: engine$' <<<"$mstep"; then
  bad "the mutation did not apply (no working-directory: engine line to change?)"
else
  ok "a step moved to the repo root would be caught (mutation applied; case 2 would fail)"
fi

echo
echo "cargo-audit-ignores: $PASS passed, $FAIL failed"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
exit 0
