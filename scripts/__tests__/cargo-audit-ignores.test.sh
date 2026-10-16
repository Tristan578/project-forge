#!/usr/bin/env bash
# Pin for engine/.cargo/audit.toml — the cargo-audit ignore list.
#
# WHY THIS SUITE EXISTS
# `cargo audit` reads `.cargo/audit.toml` from its working directory, and both
# workflows that run it (quality-gates.yml and cd.yml) do so with
# `working-directory: engine`, so an id in that file silences the advisory on
# every CI run from then on. That is the right tool for an advisory no relock
# can fix (RUSTSEC-2026-0344, ruzstd pinned by bevy_image 0.19.1's `^0.8`,
# #10393) and the wrong tool for everything else. A silenced advisory is
# invisible by construction, so the file has to be the loud part: every id must
# carry, in the comment block directly above it, why it is unfixable, what the
# exposure is, and when it must be lifted with a tracking issue — and the list
# itself is pinned HERE, so adding an id means editing this suite in the same
# change (review sees both). The file may hold nothing else: one `[advisories]`
# table whose only key is `ignore`, so a `deny`-style key or a second table
# cannot slip in unreviewed.
#
# Exit codes: 0 when every case passes, 1 otherwise. Assertions use explicit
# if/then/else (not `A && ok || bad`) so the suite is SC2015-clean, and grep is
# fed from here-strings, never `echo "$big" | grep` (SIGPIPE under pipefail).
# Every function is frozen with `readonly -f` on the line after it
# (scripts/check-fn-freeze.sh): a helper rebound later would turn every FAIL
# into silence.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AUDIT_TOML="$REPO_ROOT/engine/.cargo/audit.toml"

# The workflows that carry a `cargo audit (engine)` step TODAY. The list the
# cases below walk is DERIVED from .github/workflows (a step is a `name:` line,
# not a comment), so a third workflow that adds the step is checked at once, and
# this pin makes both a new file and the disappearance of either an explicit
# failure that needs a reviewed edit here.
EXPECTED_AUDIT_WORKFLOWS=("cd.yml" "quality-gates.yml")
WORKFLOW_DIR="$REPO_ROOT/.github/workflows"
AUDIT_STEP_NAME_RE=$'^[[:space:]]*(-[[:space:]]+)?name:[[:space:]]*["\']?cargo audit \\(engine\\)'

# The ONLY advisories allowed in the ignore list. Add one here and in the toml
# together, with the toml's comment block; remove both when the lift condition
# is met.
EXPECTED_IGNORES=("RUSTSEC-2026-0344")

command -v grep   >/dev/null 2>&1 || { echo "FATAL: grep not found on host";   exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "FATAL: mktemp not found on host"; exit 1; }
command -v awk    >/dev/null 2>&1 || { echo "FATAL: awk not found on host";    exit 1; }
command -v sed    >/dev/null 2>&1 || { echo "FATAL: sed not found on host";    exit 1; }
command -v find   >/dev/null 2>&1 || { echo "FATAL: find not found on host";   exit 1; }

PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
readonly -f bad

# --- the checkers --------------------------------------------------------------
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

  # Exactly one table, one list, one closer: a repeated header or list is a
  # second place for entries the comment-block check below never reads.
  local count
  count="$(grep -cE '^\[advisories\]$' <<<"$content" || true)"
  if [[ "$count" -gt 1 ]]; then
    echo "more than one [advisories] table"
  fi
  count="$(grep -cE '^ignore = \[$' <<<"$content" || true)"
  if [[ "$count" -gt 1 ]]; then
    echo "more than one 'ignore = [' list"
  fi

  # Nothing else may live in the file: every line is blank, a comment, the
  # table header, the list opener, an advisory id, or the list closer. A second
  # table (`[output]`), a second key (`unmaintained = "deny"`) or anything after
  # the list lands here.
  local unexpected
  unexpected="$(grep -vE '^[[:space:]]*(#.*)?$|^\[advisories\]$|^ignore = \[$|^  "RUSTSEC-[0-9]{4}-[0-9]{4}",?$|^\]$' <<<"$content" || true)"
  if [[ -n "$unexpected" ]]; then
    echo "unexpected content: only the [advisories] table with its 'ignore' list may be here: $(tr '\n' '|' <<<"$unexpected")"
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
  # tracking issue (#NNNN) INSIDE the lift-when section. That section runs from
  # the `  # lift when:` line to the next keyed line (`unfixable:`/`exposure:`)
  # or the end of the block, so an issue cited only in exposure: does not stand
  # in for the one the lift condition is tracked by. Issue references elsewhere
  # in the block are fine in addition.
  local id
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    local block lift_section
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
    lift_section="$(awk '
      /^  # lift when:/ { p = 1; print; next }
      p && /^  # (unfixable|exposure):/ { p = 0 }
      p { print }
    ' <<<"$block")"
    if ! grep -qE '#[0-9]{3,6}' <<<"$lift_section"; then
      echo "$id: comment block names no tracking issue (#NNNN) inside its 'lift when:' section"
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
readonly -f check_audit_toml

# step_runs_cargo_audit_from_engine <workflow-yaml-text> → exit 0 iff the text
# holds at least one `cargo audit (engine)` step and EVERY such step has
# `working-directory: engine`, runs plain `cargo audit`, and carries neither
# `continue-on-error:` (any value) nor a step-level `if:`: either of those
# leaves the step green without gating the job, so the ignore file would be
# read and nothing would ever fail on what it leaves un-ignored.
# cargo-audit resolves .cargo/audit.toml from its working directory, so a step
# run from the repo root would ignore the file and the list would be decorative.
#
# A step is a `- ` list item and every line indented deeper than it, so its
# keys count wherever they sit in it (`- if: false` BEFORE the name, or after a
# blank line), and a property of a LATER step is never credited to this one. A
# shallower non-item line ends it. Blank and comment lines neither end nor
# belong to a step. POSIX awk only (no gensub, no \s): ubuntu runners ship mawk.
step_runs_cargo_audit_from_engine() {
  local verdict
  verdict="$(awk '
    function flush() {
      if (isaudit) { total++; if (wd && cmd && !ungated) { good++ } }
      isaudit = 0; wd = 0; cmd = 0; ungated = 0
    }
    /^[ \t]*$/ { next }
    /^[ \t]*#/ { next }
    {
      match($0, /^[ \t]*/); ind = RLENGTH
      isitem = ($0 ~ /^[ \t]*- /)
      if (instep && ind <= stepind && !isitem) { flush(); instep = 0 }
      if (isitem && (!instep || ind <= stepind)) { flush(); instep = 1; stepind = ind }
    }
    !instep { next }
    /^[ \t]*(- )?name:[ \t]*["\047]?cargo audit \(engine\)/ { isaudit = 1 }
    /^[ \t]*(- )?working-directory: engine[ \t]*$/ { wd = 1 }
    /^[ \t]*(- )?run: cargo audit[ \t]*$/ { cmd = 1 }
    /^[ \t]*(- )?(if|continue-on-error):/ { ungated = 1 }
    END { flush(); print total + 0, good + 0 }
  ' <<<"$1")"
  local total="${verdict% *}" good="${verdict#* }"
  [[ "$total" -ge 1 && "$total" -eq "$good" ]]
}
readonly -f step_runs_cargo_audit_from_engine

# refuses_mutation <label> <workflow-text> <sed-expression> → ok when the sed
# expression CHANGES the text and the step predicate then FAILS on it. A
# mutation that changes nothing proves nothing, and a predicate that still
# passes on the mutated text is decorative.
refuses_mutation() {
  local label="$1" text="$2" expr="$3" mutated
  mutated="$(sed -e "$expr" <<<"$text")"
  if [[ "$mutated" == "$text" ]]; then
    bad "$label: the mutation changed nothing, so it proves nothing"
  elif step_runs_cargo_audit_from_engine "$mutated"; then
    bad "$label: the step pin still passes on the mutated text"
  else
    ok "$label: the step pin refuses it"
  fi
}
readonly -f refuses_mutation

# --- 1. the committed file is well-formed ------------------------------------
echo "1. committed engine/.cargo/audit.toml"
if [[ ! -f "$AUDIT_TOML" ]]; then
  bad "engine/.cargo/audit.toml is missing (the pinned set is non-empty)"
else
  problems="$(check_audit_toml "$AUDIT_TOML")"
  if [[ -z "$problems" ]]; then
    ok "well-formed: every id has unfixable/exposure/lift-when/tracking, list equals the pin, nothing else in the file"
  else
    bad "committed file: $problems"
  fi
fi

# --- 2. the gates actually read it --------------------------------------------
# cargo-audit resolves .cargo/audit.toml from its working directory. Each step
# must run from engine/ for the file to apply; a step that ran `cargo audit`
# from the repo root would ignore the file and the list would be decorative.
# Both workflows run it (quality-gates.yml on every PR, cd.yml on the deploy
# path). The set is derived from the tree, so a workflow nobody listed here is
# still walked by every case below, and the set itself is pinned.
derived_wf="$(find "$WORKFLOW_DIR" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) -exec grep -lE "$AUDIT_STEP_NAME_RE" {} + | sed 's|.*/||' | sort)"
expected_wf="$(printf '%s\n' "${EXPECTED_AUDIT_WORKFLOWS[@]}" | sort)"
echo "2. every workflow runs cargo audit (engine) from engine/"
if [[ "$derived_wf" == "$expected_wf" ]]; then
  ok "the workflows with a 'cargo audit (engine)' step are exactly [$(tr '\n' ' ' <<<"$derived_wf")]"
else
  bad "the workflows with a 'cargo audit (engine)' step changed: expected [$(tr '\n' ' ' <<<"$expected_wf")] derived [$(tr '\n' ' ' <<<"$derived_wf")]; a new one is checked below but needs EXPECTED_AUDIT_WORKFLOWS edited here, a missing one is a deleted gate"
fi
while IFS= read -r wf; do
  [[ -z "$wf" ]] && continue
  if step_runs_cargo_audit_from_engine "$(cat "$WORKFLOW_DIR/$wf")"; then
    ok "$wf: every 'cargo audit (engine)' step has working-directory: engine, runs plain cargo audit, and is neither continue-on-error nor conditional"
  else
    bad "$wf: a 'cargo audit (engine)' step does not run from engine/, runs something other than 'cargo audit', or is continue-on-error / conditional; the ignore file would not gate the job"
  fi
done <<<"$derived_wf"

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
readonly -f write_fixture

good_lines=("RUSTSEC-2026-0344: ruzstd 0.8.2 decompression bomb." "unfixable: bevy_image 0.19.1 pins ^0.8." "exposure: only editor-side imports." "lift when: a bevy_image release requires ruzstd >= 0.9.1. Tracking: #10393.")

write_fixture "$tmp/good.toml" "${good_lines[@]}"
if [[ -z "$(check_audit_toml "$tmp/good.toml")" ]]; then ok "accepts a complete entry"; else bad "rejects a complete entry: $(check_audit_toml "$tmp/good.toml")"; fi

write_fixture "$tmp/no-unfixable.toml" "${good_lines[0]}" "${good_lines[2]}" "${good_lines[3]}"
if grep -q "lacks 'unfixable:'" <<<"$(check_audit_toml "$tmp/no-unfixable.toml")"; then ok "refuses an entry without unfixable:"; else bad "accepted an entry without unfixable:"; fi

write_fixture "$tmp/no-exposure.toml" "${good_lines[0]}" "${good_lines[1]}" "${good_lines[3]}"
if grep -q "lacks 'exposure:'" <<<"$(check_audit_toml "$tmp/no-exposure.toml")"; then ok "refuses an entry without exposure:"; else bad "accepted an entry without exposure:"; fi

write_fixture "$tmp/no-lift.toml" "${good_lines[0]}" "${good_lines[1]}" "${good_lines[2]}" "Tracking: #10393."
if grep -q "lacks 'lift when:'" <<<"$(check_audit_toml "$tmp/no-lift.toml")"; then ok "refuses an entry without lift when:"; else bad "accepted an entry without lift when:"; fi

write_fixture "$tmp/no-issue.toml" "${good_lines[0]}" "${good_lines[1]}" "${good_lines[2]}" "lift when: a bevy_image release requires ruzstd >= 0.9.1."
if grep -q "names no tracking issue" <<<"$(check_audit_toml "$tmp/no-issue.toml")"; then ok "refuses an entry without a tracking issue"; else bad "accepted an entry without a tracking issue"; fi

# An issue cited only in exposure: is not the lift condition's tracking issue.
write_fixture "$tmp/issue-in-exposure-only.toml" "${good_lines[0]}" "${good_lines[1]}" "exposure: only editor-side imports; narrowed by #10396." "lift when: a bevy_image release requires ruzstd >= 0.9.1."
if grep -q "names no tracking issue" <<<"$(check_audit_toml "$tmp/issue-in-exposure-only.toml")"; then ok "refuses an entry whose only issue is cited in exposure:, none in lift when:"; else bad "accepted an issue cited only in exposure: as the tracking issue"; fi

# The same holds when lift when: comes FIRST and exposure: (with the issue)
# follows: the lift-when section ends at the next keyed line.
write_fixture "$tmp/lift-before-exposure.toml" "${good_lines[0]}" "${good_lines[1]}" "lift when: a bevy_image release requires ruzstd >= 0.9.1." "exposure: only editor-side imports; narrowed by #10396."
if grep -q "names no tracking issue" <<<"$(check_audit_toml "$tmp/lift-before-exposure.toml")"; then ok "refuses an issue in an exposure: that follows a lift when: with none"; else bad "accepted an issue in a later exposure: as the lift condition's tracking issue"; fi

# Issue references elsewhere are fine IN ADDITION, and a continuation line of
# the lift-when section counts as inside it.
write_fixture "$tmp/issue-in-both.toml" "${good_lines[0]}" "${good_lines[1]}" "exposure: only editor-side imports; narrowed by #10396." "lift when: a bevy_image release requires ruzstd >= 0.9.1." "  Tracking: #10393."
if [[ -z "$(check_audit_toml "$tmp/issue-in-both.toml")" ]]; then ok "accepts extra issue references elsewhere and a tracking line continuing lift when:"; else bad "rejects an entry whose lift when: continuation carries the issue: $(check_audit_toml "$tmp/issue-in-both.toml")"; fi

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

# The file is the ignore list and nothing else. A second table, a second key
# beside `ignore`, or a key after the list would change what `cargo audit`
# fails on (`unmaintained = "deny"`, `[output] deny = [...]`) with the
# per-advisory comment check still green.
{
  echo "[advisories]"; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo "  \"RUSTSEC-2026-0344\","; echo "]"
  echo ""; echo "[output]"; echo 'deny = ["warnings"]'
} >"$tmp/extra-table.toml"
if grep -q "unexpected content" <<<"$(check_audit_toml "$tmp/extra-table.toml")"; then ok "refuses a second table"; else bad "accepted a second table"; fi

{
  echo "[advisories]"; echo 'unmaintained = "deny"'; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo "  \"RUSTSEC-2026-0344\","; echo "]"
} >"$tmp/extra-key.toml"
if grep -q "unexpected content" <<<"$(check_audit_toml "$tmp/extra-key.toml")"; then ok "refuses a second key before the list"; else bad "accepted a second key before the list"; fi

{
  echo "[advisories]"; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo "  \"RUSTSEC-2026-0344\","; echo "]"
  echo 'informational_warnings = ["unmaintained"]'
} >"$tmp/key-after-list.toml"
if grep -q "unexpected content" <<<"$(check_audit_toml "$tmp/key-after-list.toml")"; then ok "refuses a key after the list"; else bad "accepted a key after the list"; fi

# A repeated header is a second place for entries.
{
  echo "[advisories]"; echo "[advisories]"; echo "ignore = ["
  for line in "${good_lines[@]}"; do echo "  # $line"; done
  echo "  \"RUSTSEC-2026-0344\","; echo "]"
} >"$tmp/dup-table.toml"
if grep -q "more than one \[advisories\] table" <<<"$(check_audit_toml "$tmp/dup-table.toml")"; then ok "refuses a repeated [advisories] header"; else bad "accepted a repeated [advisories] header"; fi

# --- 4. the step pin is falsifiable --------------------------------------------
# Case 2 only proves the CURRENT workflows satisfy the predicate. Each mutation
# below must change the text and make that same predicate fail, or the pin could
# never fire.
echo "4. step pin refuses a cargo audit that would not read the file or not gate the job"
while IFS= read -r wf; do
  [[ -z "$wf" ]] && continue
  wf_text="$(cat "$WORKFLOW_DIR/$wf")"
  refuses_mutation "$wf with working-directory: ." "$wf_text" 's/^\([[:space:]]*\)working-directory: engine$/\1working-directory: ./'
  refuses_mutation "$wf with run: cargo audit || true" "$wf_text" 's/^\([[:space:]]*\)run: cargo audit$/\1run: cargo audit || true/'
  refuses_mutation "$wf with the step renamed away" "$wf_text" 's/name: cargo audit (engine)/name: cargo audit (renamed)/'
  # Either key leaves the step green without gating the job: the ignore file is
  # still read, and nothing it leaves un-ignored can ever fail the run.
  refuses_mutation "$wf with continue-on-error: true appended" "$wf_text" 's/^\([[:space:]]*\)run: cargo audit$/&\n\1continue-on-error: true/'
  refuses_mutation "$wf with if: false appended" "$wf_text" 's/^\([[:space:]]*\)run: cargo audit$/&\n\1if: false/'

  # A SECOND step that runs from the repo root is not excused by the first.
  extra_step="$wf_text"$'\n\n'"      - name: cargo audit (engine)"$'\n'"        run: cargo audit"
  if step_runs_cargo_audit_from_engine "$extra_step"; then
    bad "$wf plus a second root-directory step: the step pin still passes"
  else
    ok "$wf plus a second root-directory step: the step pin refuses it"
  fi
done <<<"$derived_wf"

# The parse itself, on small synthetic workflows, with a positive control so a
# refusal below is the key's doing and not a shape the parser cannot read.
synth_head=$'jobs:\n  audit:\n    steps:\n'
synth_ok=$'      - name: cargo audit (engine)\n        working-directory: engine\n        run: cargo audit\n'
if step_runs_cargo_audit_from_engine "$synth_head$synth_ok"; then
  ok "synthetic control: a plain step run from engine/ is accepted"
else
  bad "synthetic control: a plain step run from engine/ is refused, so the refusals below prove nothing"
fi
synth_if_first=$'      - if: false\n        name: cargo audit (engine)\n        working-directory: engine\n        run: cargo audit\n'
if step_runs_cargo_audit_from_engine "$synth_head$synth_if_first"; then
  bad "synthetic: an if: written BEFORE the name is not seen"
else
  ok "synthetic: an if: written before the name is refused"
fi
synth_after_gap=$'      - name: cargo audit (engine)\n        working-directory: engine\n        run: cargo audit\n\n        continue-on-error: true\n'
if step_runs_cargo_audit_from_engine "$synth_head$synth_after_gap"; then
  bad "synthetic: a continue-on-error: after a blank line inside the step is not seen"
else
  ok "synthetic: a continue-on-error: after a blank line inside the step is refused"
fi
synth_next_step=$'      - name: cargo audit (engine)\n        working-directory: engine\n        run: cargo audit\n      - name: Upload\n        if: always()\n        continue-on-error: true\n'
if step_runs_cargo_audit_from_engine "$synth_head$synth_next_step"; then
  ok "synthetic: an if: / continue-on-error: on the NEXT step is not charged to the audit step"
else
  bad "synthetic: the next step's if: / continue-on-error: was charged to the audit step"
fi

echo
echo "cargo-audit-ignores: $PASS passed, $FAIL failed"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
exit 0
