#!/usr/bin/env bash
# Contract test for the Codex CLI surface generator and its gate:
#   * tools/agentic-sync/port.mjs          — the generator (--check / --write)
#   * scripts/check-codex-port.sh          — the CI drift gate that wraps it
#   * .codex/hooks/run-claude-hook.mjs     — the hook payload adapter
#
# Drives the REAL scripts through their CLI contract against hermetic fixtures
# (a CODEX_PORT_ROOT temp dir), so it needs no network and never touches the
# repository's own generated files. The exit codes ARE the behaviour — 0 in
# sync, 1 drift / dead reference / MCP parity, 2 could-not-run — so the cases
# assert on them directly.
#
# Every assertion here was written against a failure that has actually
# happened to this port (#9745): dead `.Codex/...` references, hooks silently
# left unwired, copied skills drifting, and Edit/Write hooks that pass on
# nothing because Codex sends no file_path. Each negative case asserts the
# CONTENT of the failure (the exact path, the exact event), not merely a
# non-zero exit, so a gate that fails for the wrong reason does not pass here.
#
# Fixture hooks avoid jq on purpose: the suite must run where jq is absent.
#
# Assertions use explicit if/then/else (NOT `A && ok || bad`) so the suite has
# no SC2015 findings — CI's self-defense job lints it with shellcheck.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO_ROOT/tools/agentic-sync/port.mjs"
MANIFEST="$REPO_ROOT/tools/agentic-sync/port.json"
ADAPTER="$REPO_ROOT/.codex/hooks/run-claude-hook.mjs"
WRAPPER="$REPO_ROOT/scripts/check-codex-port.sh"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"

command -v node >/dev/null 2>&1 || { echo "FATAL: node not found on host"; exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "FATAL: mktemp not found on host"; exit 1; }
for f in "$GEN" "$MANIFEST" "$ADAPTER" "$WRAPPER" "$CI_YML"; do
  [ -f "$f" ] || { echo "FATAL: missing subject file $f"; exit 1; }
done

PASS=0; FAIL=0; SKIP=0
ok()   { PASS=$((PASS + 1)); echo "  ok    $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }
skip() { SKIP=$((SKIP + 1)); echo "  skip  $1"; }

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# gen <root> <mode> — run the generator against a fixture; sets RC and OUT.
gen() {
  OUT="$(CODEX_PORT_ROOT="$1" node "$GEN" "$2" 2>&1)"
  RC=$?
}

# expect_rc <want> <label>
expect_rc() {
  if [ "$RC" -eq "$1" ]; then ok "$2 (exit $1)"; else bad "$2 — wanted exit $1, got $RC: $OUT"; fi
}

# expect_out <fixed-string> <label> — the failure must NAME the thing.
expect_out() {
  if grep -qF -- "$1" <<<"$OUT"; then ok "$2"; else bad "$2 — output lacks '$1': $OUT"; fi
}

# mkfix — build a minimal but complete source tree; echoes its path.
mkfix() {
  local d
  d="$(mktemp -d "$TMP_ROOT/fix.XXXXXX")"
  mkdir -p "$d/tools/agentic-sync" "$d/.claude/skills/alpha/scripts" "$d/.claude/skills/kanban" \
           "$d/.claude/agents" "$d/.claude/hooks" "$d/.codex/hooks" "$d/.codex/agents"
  cp "$MANIFEST" "$d/tools/agentic-sync/port.json"
  cp "$ADAPTER" "$d/.codex/hooks/run-claude-hook.mjs"
  printf -- '---\nname: alpha\ndescription: fixture skill\n---\n\n# Alpha\n\nSee `.claude/hooks/ok.sh`.\n' > "$d/.claude/skills/alpha/SKILL.md"
  printf '#!/usr/bin/env bash\necho alpha\n' > "$d/.claude/skills/alpha/scripts/run.sh"
  printf -- '---\nname: kanban\ndescription: independent on both sides\n---\n' > "$d/.claude/skills/kanban/SKILL.md"
  # The body carries a backslash, a double quote and a real path on purpose.
  cat > "$d/.claude/agents/demo.md" <<'AGENT'
---
name: demo
description: Fixture agent with "quotes" in its description
model: sonnet
effort: high
tools: [Read, Bash]
hooks:
  PreToolUse: []
---

# Identity: Demo

Read `.claude/hooks/ok.sh` first. A regex like `\bfoo\b` must survive.
A placeholder such as `.claude/skills/<name>/SKILL.md` is prose, not a path.
AGENT
  printf 'name = "code-architect"\ndescription = "hand authored"\ndeveloper_instructions = "x"\n' > "$d/.codex/agents/code-architect.toml"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/.claude/hooks/ok.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/.claude/hooks/auto-approve-safe-commands.sh"
  cat > "$d/.claude/settings.json" <<'SETTINGS'
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "bash \"$(git rev-parse --show-toplevel)/.claude/hooks/ok.sh\"", "timeout": 5 } ] },
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "bash \"$(git rev-parse --show-toplevel)/.claude/hooks/auto-approve-safe-commands.sh\"", "timeout": 5 } ] }
    ],
    "Stop": [
      { "matcher": "ignored-by-codex", "hooks": [ { "type": "command", "command": "bash .claude/hooks/ok.sh", "timeout": 3 } ] }
    ],
    "TaskCreated": [
      { "hooks": [ { "type": "command", "command": "bash .claude/hooks/ok.sh", "timeout": 3 } ] }
    ]
  }
}
SETTINGS
  echo "$d"
}

# json_get <file> <dotted.path> — jq-free JSON probe. Walks the path; prints a
# string as-is and anything else as JSON. Two suffixes cover what the cases
# need without evaluating code: `.@keys` (sorted, comma-joined) and `.@has:<k>`.
json_get() {
  node -e '
    let v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const seg of process.argv[2].split(".")) {
      if (seg === "@keys") v = Object.keys(v).sort().join(",");
      else if (seg.startsWith("@has:")) v = Object.hasOwn(v, seg.slice(5));
      else v = v == null ? undefined : v[seg];
    }
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v) ?? "undefined");
  ' "$1" "$2"
}

echo "== generator: write, check, idempotence =="
F="$(mkfix)"
gen "$F" --check; expect_rc 1 "a tree that was never generated reports drift, not 'in sync'"
expect_out "missing:  .agents/skills/alpha/SKILL.md" "…and names the missing mirror file"
gen "$F" --write; expect_rc 0 "--write succeeds on a clean fixture"
gen "$F" --check; expect_rc 0 "--check passes immediately after --write"

if cmp -s "$F/.claude/skills/alpha/SKILL.md" "$F/.agents/skills/alpha/SKILL.md" \
   && cmp -s "$F/.claude/skills/alpha/scripts/run.sh" "$F/.agents/skills/alpha/scripts/run.sh"; then
  ok "the skill mirror is byte-identical to its source (nothing is rewritten)"
else
  bad "the skill mirror differs from its source"
fi
if [ -e "$F/.agents/skills/kanban" ]; then
  bad "a skill listed under skills.independent was mirrored anyway"
else
  ok "a skill listed under skills.independent is left alone"
fi

echo "== generator: agents =="
AG="$F/.codex/agents/demo.toml"
if [ -f "$AG" ] && grep -q '^developer_instructions = """$' "$AG" && grep -q '^name = "demo"$' "$AG"; then
  ok "agent TOML carries name and developer_instructions (the keys codex-rs requires)"
else
  bad "agent TOML is missing a required key"
fi
if grep -qE '^(model|tools|hooks|skills|mcpServers) *=' "$AG"; then
  bad "a Claude-only frontmatter key leaked into the Codex agent"
else
  ok "Claude-only frontmatter (model/tools/hooks/skills/mcpServers) is dropped"
fi
if command -v python3 >/dev/null 2>&1 && python3 -c 'import tomllib' >/dev/null 2>&1; then
  ROUND="$(python3 - "$AG" <<'PY'
import sys, tomllib
d = tomllib.load(open(sys.argv[1], "rb"))
body = d["developer_instructions"]
print("OK" if (r"`\bfoo\b`" in body and d["description"].count('"') == 2) else "LOST")
PY
)"
  if [ "$ROUND" = "OK" ]; then
    ok "a real TOML parser reads the agent back with its backslashes and quotes intact"
  else
    bad "TOML round-trip lost content: $ROUND"
  fi
elif [ "${CI:-}" = "true" ]; then
  # Not a legitimate skip in CI: without it, nothing proves the TOML is valid.
  bad "python3 with tomllib is required in CI to prove the generated TOML parses"
else
  skip "python3/tomllib absent locally — TOML round-trip not proven on this host"
fi

echo "== generator: hooks.json =="
HJ="$F/.codex/hooks.json"
if [ "$(json_get "$HJ" 'hooks.PreToolUse.0.matcher')" = "apply_patch" ]; then
  ok "matcher Edit|Write becomes apply_patch (the tool name Codex actually reports)"
else
  bad "Edit|Write was not mapped to apply_patch: $(json_get "$HJ" 'hooks.PreToolUse')"
fi
if grep -qF 'auto-approve-safe-commands.sh' "$HJ"; then
  bad "a script listed under hooks.skipScripts was wired"
else
  ok "a script listed under hooks.skipScripts is not wired"
fi
if [ "$(json_get "$HJ" 'hooks.@keys')" = "PreToolUse,Stop" ]; then
  ok "an event Codex lacks (TaskCreated) is omitted; supported events are kept"
else
  bad "unexpected event set: $(json_get "$HJ" 'hooks.@keys')"
fi
if [ "$(json_get "$HJ" 'hooks.Stop.0.@has:matcher')" = "false" ]; then
  ok "no matcher is emitted for Stop (Codex ignores matchers there)"
else
  bad "a matcher was emitted for Stop"
fi
if [ "$(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0.timeout')" = "5" ] \
   && grep -qF 'run-claude-hook.mjs' "$HJ" && grep -qF '"commandWindows"' "$HJ"; then
  ok "handlers run through the adapter, keep their timeout, and carry a Windows command"
else
  bad "handler shape is wrong: $(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0')"
fi

echo "== generator: drift, orphans, and --check never writes =="
printf '\nA new line.\n' >> "$F/.claude/skills/alpha/SKILL.md"
gen "$F" --check; expect_rc 1 "editing a source skill without regenerating is drift"
expect_out "stale:    .agents/skills/alpha/SKILL.md" "…and names the stale file"
if grep -qF 'A new line.' "$F/.agents/skills/alpha/SKILL.md"; then
  bad "--check WROTE to the mirror — a check must never mutate"
else
  ok "--check left the stale mirror untouched"
fi
gen "$F" --write; gen "$F" --check; expect_rc 0 "--write repairs the drift"

printf 'tampered\n' >> "$F/.codex/agents/demo.toml"
gen "$F" --check; expect_rc 1 "hand-editing a GENERATED file is drift"
expect_out "stale:    .codex/agents/demo.toml" "…and names the hand-edited file"
gen "$F" --write

rm -rf "$F/.claude/skills/alpha"
mkdir -p "$F/.claude/skills/beta"
printf -- '---\nname: beta\ndescription: second fixture skill\n---\n' > "$F/.claude/skills/beta/SKILL.md"
gen "$F" --check; expect_rc 1 "deleting a source skill leaves an orphan, which is drift"
expect_out "orphan:   .agents/skills/alpha/SKILL.md" "…and names the orphan"
gen "$F" --write
if [ -e "$F/.agents/skills/alpha" ]; then
  bad "--write left the orphaned mirror directory behind"
else
  ok "--write removes the orphaned mirror and its emptied directories"
fi
gen "$F" --check; expect_rc 0 "the tree is in sync again after the orphan is removed"

echo "== generator: the #9745 negative scenario — dead references =="
F="$(mkfix)"
printf '\nRead `.Codex/rules/lessons-learned.md` before acting.\n' >> "$F/.claude/agents/demo.md"
gen "$F" --write
gen "$F" --check; expect_rc 1 "a reference to nonexistent .Codex/rules fails validation"
expect_out ".codex/agents/demo.toml: unresolved path .Codex/rules/lessons-learned.md" "…with the exact unresolved path and the file that carries it"

F="$(mkfix)"
# Wrong CASE only. On a case-insensitive filesystem a plain exists() says yes.
printf '\nRun `.claude/Hooks/ok.sh`.\n' >> "$F/.claude/agents/demo.md"
gen "$F" --write
gen "$F" --check; expect_rc 1 "a path that differs only in case is unresolved on every filesystem"
expect_out "unresolved path .claude/Hooks/ok.sh" "…and the case-wrong path is named"

F="$(mkfix)"
gen "$F" --write
gen "$F" --check; expect_rc 0 "a placeholder like .claude/skills/<name>/SKILL.md is not treated as a path"

echo "== generator: an unclassified hook is a hard error, never a silent omission =="
F="$(mkfix)"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.hooks.BrandNewEvent=[{hooks:[{type:"command",command:"bash .claude/hooks/ok.sh"}]}];fs.writeFileSync(p,JSON.stringify(s));' "$F/.claude/settings.json"
gen "$F" --check; expect_rc 2 "an event in neither supportedEvents nor unsupportedEvents stops the generator"
expect_out 'event "BrandNewEvent"' "…naming the event that needs a decision"

F="$(mkfix)"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.hooks.PreToolUse[0].matcher="Edit|NotebookEdit";fs.writeFileSync(p,JSON.stringify(s));' "$F/.claude/settings.json"
gen "$F" --check; expect_rc 2 "a matcher naming a tool with no Codex alias stops the generator"
expect_out 'tool "NotebookEdit"' "…naming the tool"

F="$(mkfix)"
rm "$F/.claude/hooks/ok.sh"
gen "$F" --check; expect_rc 2 "a wired hook whose script is missing stops the generator"
expect_out ".claude/hooks/ok.sh, which does not exist" "…naming the script"

echo "== generator: fail-closed paths =="
F="$(mkfix)"; rm -rf "$F/.claude/skills/alpha" "$F/.claude/skills/kanban"
gen "$F" --check; expect_rc 2 "an empty skill set is refused rather than reported as an in-sync empty mirror"
F="$(mkfix)"; printf '{ not json' > "$F/tools/agentic-sync/port.json"
gen "$F" --check; expect_rc 2 "a malformed manifest is exit 2, not 'in sync'"
F="$(mkfix)"; rm "$F/.codex/agents/code-architect.toml"
gen "$F" --check; expect_rc 2 "a handAuthored agent that is missing is an error"
OUT="$(CODEX_PORT_ROOT="$F" node "$GEN" 2>&1)"; RC=$?
expect_rc 2 "no mode argument is a usage error"

echo "== generator: MCP server parity =="
F="$(mkfix)"; gen "$F" --write
printf '{"mcpServers":{"alpha":{"command":"npx"},"beta":{"command":"npx"}}}\n' > "$F/.mcp.json"
printf 'model = "x"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "a config.toml with no MCP block passes…"
expect_out "declares no [mcp_servers.*]" "…but says so out loud instead of reading as parity"
printf '[mcp_servers.alpha]\ncommand = "npx"\n\n[mcp_servers.alpha.env]\nA = "1"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "a server in .mcp.json that Codex lacks is a failure"
expect_out "beta is in .mcp.json but not in .codex/config.toml" "…naming the missing server"
if grep -qF 'alpha.env' <<<"$OUT" || grep -qF ' env is in' <<<"$OUT"; then
  bad "a sub-table ([mcp_servers.alpha.env]) was mistaken for a server"
else
  ok "a server's sub-table is not counted as a server"
fi
printf '[mcp_servers.alpha]\ncommand = "npx"\n[mcp_servers.beta]\ncommand = "npx"\n[mcp_servers.gamma]\ncommand = "npx"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "a server Codex declares that .mcp.json lacks is a failure too"
expect_out "gamma is in .codex/config.toml but not in .mcp.json" "…naming the extra server"
printf '[mcp_servers.alpha]\ncommand = "npx"\n[mcp_servers.beta]\ncommand = "npx"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "matching server names pass"

echo "== adapter: Codex payload → the shape the shared hook scripts read =="
H="$(mktemp -d "$TMP_ROOT/hooks.XXXXXX")"
LOG="$H/log"
# probe.sh records what it was given: the env path, then its stdin verbatim.
cat > "$H/probe.sh" <<'PROBE'
#!/usr/bin/env bash
printf 'ENV=%s\n' "${TOOL_INPUT_file_path:-<unset>}" >> "$PROBE_LOG"
cat >> "$PROBE_LOG.stdin"
printf '\n' >> "$PROBE_LOG.stdin"
exit 0
PROBE
printf '#!/usr/bin/env bash\necho "blocked: policy says no" >&2\nexit 2\n' > "$H/block.sh"
printf '#!/usr/bin/env bash\necho "boom" >&2\nexit 7\n' > "$H/crash.sh"
cat > "$H/allow.sh" <<'ALLOW'
#!/usr/bin/env bash
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"safe","additionalContext":"remember the rule"},"suppressOutput":true}'
ALLOW

# adapt <script> <payload-json> — sets RC, OUT (stdout) and ERR (stderr).
adapt() {
  ERR_FILE="$H/err"
  OUT="$(printf '%s' "$2" | CODEX_HOOK_SCRIPT_DIR="$H" PROBE_LOG="$LOG" node "$ADAPTER" "$1" 2>"$ERR_FILE")"
  RC=$?
  ERR="$(cat "$ERR_FILE")"
}

PATCH='*** Begin Patch\n*** Add File: web/src/new.ts\n+export const a = 1;\n*** Update File: web/src/old.ts\n@@\n-const b = 1;\n+const b = 2;\n*** Delete File: web/src/gone.ts\n*** End Patch\n'
PAYLOAD="{\"cwd\":\"$TMP_ROOT\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"apply_patch\",\"tool_input\":{\"command\":\"$PATCH\"}}"
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$PAYLOAD"; expect_rc 0 "an apply_patch payload runs the script and succeeds"
if [ "$(grep -c '^ENV=' "$LOG" 2>/dev/null)" = "2" ]; then
  ok "the script runs once per WRITTEN file (Add + Update), not for the Delete"
else
  bad "expected 2 runs, log has: $(cat "$LOG" 2>/dev/null)"
fi
if grep -qE '^ENV=.*/web/src/new\.ts$' "$LOG" && grep -qE '^ENV=.*/web/src/old\.ts$' "$LOG" && ! grep -qF '\' "$LOG"; then
  ok "TOOL_INPUT_file_path is set, absolute, and forward-slashed on every platform"
else
  bad "TOOL_INPUT_file_path is wrong: $(cat "$LOG")"
fi
FIRST="$(sed -n '1p' "$LOG.stdin")"
if [ "$(node -e 'const d=JSON.parse(process.argv[1]);process.stdout.write(d.tool_name+"|"+/\/web\/src\/new\.ts$/.test(d.tool_input.file_path)+"|"+d.tool_input.content)' "$FIRST")" = "Write|true|export const a = 1;" ]; then
  ok "stdin carries tool_name Write, tool_input.file_path and the added content"
else
  bad "stdin payload is wrong: $FIRST"
fi

rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "{\"cwd\":\"$TMP_ROOT\",\"tool_name\":\"apply_patch\",\"tool_input\":{\"command\":\"*** Begin Patch\\n nothing recognisable\\n*** End Patch\"}}"
if [ "$RC" -ne 0 ] && [ "$RC" -ne 2 ] && [ ! -e "$LOG" ] && grep -qF 'could not find a file path' <<<"$ERR"; then
  ok "a patch with no recognisable path FAILS (exit $RC) instead of letting the check pass on nothing"
else
  bad "no-path patch: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi

rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "{\"cwd\":\"$TMP_ROOT\",\"tool_name\":\"apply_patch\",\"tool_input\":{\"command\":\"*** Begin Patch\\n*** Delete File: a.ts\\n*** End Patch\"}}"
if [ "$RC" -eq 0 ] && [ ! -e "$LOG" ]; then
  ok "a delete-only patch writes nothing, so nothing is inspected and it passes"
else
  bad "delete-only patch: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no)"
fi

rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "{\"cwd\":\"$TMP_ROOT\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git status\"}}"
if [ "$RC" -eq 0 ] && [ "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).tool_input.command)' "$(sed -n '1p' "$LOG.stdin")")" = "git status" ]; then
  ok "a Bash payload passes through with tool_input.command intact"
else
  bad "Bash passthrough is wrong: exit $RC, stdin: $(cat "$LOG.stdin" 2>/dev/null)"
fi

adapt block.sh "$PAYLOAD"
if [ "$RC" -eq 2 ] && grep -qF 'blocked: policy says no' <<<"$ERR"; then
  ok "exit 2 and its stderr reason pass through (Codex blocks on exactly that pair)"
else
  bad "block passthrough: exit $RC, stderr: $ERR"
fi
adapt crash.sh "$PAYLOAD"
if [ "$RC" -ne 0 ] && [ "$RC" -ne 2 ] && grep -qF 'boom' <<<"$ERR"; then
  ok "a crashing script is reported as a failure, never as a block and never as a pass"
else
  bad "crash handling: exit $RC, stderr: $ERR"
fi

adapt allow.sh "{\"cwd\":\"$TMP_ROOT\",\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}"
if [ "$RC" -eq 0 ] && ! grep -qF '"allow"' <<<"$OUT" && ! grep -qF 'suppressOutput' <<<"$OUT" \
   && [ "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).hookSpecificOutput.additionalContext)' "$OUT")" = "remember the rule" ]; then
  ok "permissionDecision=allow and suppressOutput are dropped (Codex fails the run on them); additionalContext survives"
else
  bad "output translation is wrong: exit $RC, stdout: $OUT"
fi

adapt ../probe.sh '{}'
if [ "$RC" -ne 0 ] && [ "$RC" -ne 2 ]; then ok "a script name with a path in it is refused"; else bad "path-bearing script name was accepted (exit $RC)"; fi
adapt nope.sh '{}'
if [ "$RC" -ne 0 ] && grep -qF 'does not exist' <<<"$ERR"; then ok "a missing script is a reported failure"; else bad "missing script: exit $RC, $ERR"; fi

echo "== the real manifest classifies every hook the real settings.json wires =="
OUT="$(node "$GEN" --check 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then
  bad "the generator cannot run against this repository: $OUT"
else
  ok "every event and script in .claude/settings.json is ported or explained (exit $RC ≠ 2)"
fi

echo "== CI wiring =="
# Executable lines only: strip whole-line comments before counting.
CI_CODE="$(grep -vE '^[[:space:]]*#' "$CI_YML")"
N="$(grep -cE '^[[:space:]]+run: bash scripts/check-codex-port\.sh[[:space:]]*$' <<<"$CI_CODE")"
if [ "$N" = "1" ]; then
  ok "ci.yml runs the gate on exactly one executable line"
else
  bad "expected exactly 1 executable 'run: bash scripts/check-codex-port.sh' in ci.yml, found $N"
fi
AGENTIC_LINE="$(grep -E "&& agentic=true" <<<"$CI_CODE")"
for pat in '^\.claude/skills/' '^\.claude/agents/' '^\.claude/settings\.json$' '^\.agents/skills/' '^\.codex/' '^\.mcp\.json$' '^scripts/check-codex-port\.sh$'; do
  if grep -qF -- "$pat" <<<"$AGENTIC_LINE"; then
    ok "the ci-gate agentic filter fires on $pat"
  else
    bad "the ci-gate agentic filter does not fire on $pat — a change there would never run the gate"
  fi
done
SEAM_HITS="$(grep -rnE 'CODEX_PORT_ROOT|CODEX_PORT_NODE|CODEX_HOOK_SCRIPT_DIR|CODEX_HOOK_BASH' "$REPO_ROOT/.github/workflows" "$REPO_ROOT/.github/actions" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
if [ -z "$SEAM_HITS" ]; then
  ok "no workflow or composite action sets a test-only seam"
else
  bad "a test-only seam is wired in CI (it would point the gate at an empty tree): $SEAM_HITS"
fi
if grep -qF 'scripts/__tests__/check-codex-port.test.sh' "$CI_YML"; then
  ok "this suite is itself run by a workflow"
else
  bad "this suite is not referenced by ci.yml — it would never execute in CI"
fi

# =============================================================================
echo ""
echo "  PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ] || { echo "SUITE FAILED"; exit 1; }
echo "SUITE PASSED"
