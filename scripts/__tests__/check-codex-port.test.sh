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
# One case at the end is NOT part of that contract: it pins the committed
# .mcp.json's `alwaysLoad` allowlist (#8695). That key is Claude Code only and
# the port gate deliberately ignores it, but this is the suite that already
# parses the real .mcp.json and runs in CI, so the pin lives here rather than
# in a one-case suite of its own. Search for "alwaysLoad" to find it.
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

# expect_no_out <fixed-string> <label> — and must NOT say the wrong thing.
expect_no_out() {
  if grep -qF -- "$1" <<<"$OUT"; then bad "$2 — output contains '$1': $OUT"; else ok "$2"; fi
}

# mkfix — build a minimal but complete source tree; echoes its path.
mkfix() {
  local d
  d="$(mktemp -d "$TMP_ROOT/fix.XXXXXX")"
  mkdir -p "$d/tools/agentic-sync" "$d/.claude/skills/alpha/scripts" "$d/.claude/skills/kanban" \
           "$d/.claude/agents" "$d/.claude/hooks" "$d/.codex/hooks" "$d/.codex/agents"
  cp "$MANIFEST" "$d/tools/agentic-sync/port.json"
  # The fixture declares its own independent skill (kanban, created below on
  # both sides) rather than borrowing one from the real manifest, whose
  # `skills.independent` is empty by design since #10131.
  json_set "$d/tools/agentic-sync/port.json" skills.independent.kanban '"fixture: exists on both sides on purpose"'
  cp "$ADAPTER" "$d/.codex/hooks/run-claude-hook.mjs"
  # The real adapter's messages send readers to this file, and the reference
  # validator resolves every path a .codex/ file names — so the fixture has one.
  printf '# Codex instructions (fixture)\n' > "$d/.codex/AGENTS.md"
  # shellcheck disable=SC2016  # the backticks are literal Markdown in fixture text, not a command substitution
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
# A literal dot in a key is written `\.` (e.g. `PreToolUse.ok\.sh.0`).
json_get() {
  node -e '
    let v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const raw of process.argv[2].split(/(?<!\\)\./)) {
      const seg = raw.split("\\.").join(".");
      if (seg === "@keys") v = Object.keys(v).sort().join(",");
      else if (seg.startsWith("@has:")) v = Object.hasOwn(v, seg.slice(5));
      else v = v == null ? undefined : v[seg];
    }
    process.stdout.write(typeof v === "string" ? v : JSON.stringify(v) ?? "undefined");
  ' "$1" "$2"
}

# json_set <file> <dotted.path> <json-value> — jq-free, and evaluates no code.
json_set() {
  node -e '
    const fs = require("fs");
    const [file, path, value] = process.argv.slice(1);
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const segs = path.split(".");
    let v = doc;
    for (const seg of segs.slice(0, -1)) v = v[seg];
    v[segs[segs.length - 1]] = JSON.parse(value);
    fs.writeFileSync(file, JSON.stringify(doc));
  ' "$1" "$2" "$3"
}

# lock_set <fixture> <path> <json-value> — write one entry of the lock's `generated` map.
lock_set() {
  node -e '
    const fs = require("fs");
    const [file, key, value] = process.argv.slice(1);
    const l = JSON.parse(fs.readFileSync(file, "utf8"));
    l.generated[key] = JSON.parse(value);
    fs.writeFileSync(file, JSON.stringify(l));
  ' "$1/tools/agentic-sync/port.lock.json" "$2" "$3"
}

# file_replace <file> <from> <to> — literal, first occurrence; `|` in <to> is a
# newline. (Not sed: BSD sed has no newline in a replacement, and this suite
# runs on macOS as well as Linux and Git Bash.)
file_replace() {
  node -e '
    const fs = require("fs");
    const [file, from, to] = process.argv.slice(1);
    const s = fs.readFileSync(file, "utf8");
    if (!s.includes(from)) { console.error("file_replace: no match for " + from); process.exit(1); }
    fs.writeFileSync(file, s.replace(from, to.split("|").join("\n")));
  ' "$1" "$2" "$3"
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
if [ "$(json_get "$HJ" 'hooks.PreToolUse.0.matcher')" = "apply_patch|Bash" ]; then
  ok "a PreToolUse Edit|Write hook matches apply_patch AND Bash — Codex also applies a patch carried in a shell command"
else
  bad "PreToolUse Edit|Write matcher is wrong: $(json_get "$HJ" 'hooks.PreToolUse')"
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
if [ "$(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0.@has:commandWindows')" = "true" ] \
   && [ "$(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0.type')" = "command" ]; then
  ok "each handler is a command handler with a Windows variant (exact strings are asserted further down)"
else
  bad "handler shape is wrong: $(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0')"
fi

echo "== generator: drift, orphans, and --check never writes =="
printf '\nA new line.\n' >> "$F/.claude/skills/alpha/SKILL.md"
gen "$F" --check; expect_rc 1 "editing a source skill without regenerating is drift"
expect_out "stale:    .agents/skills/alpha/SKILL.md" "…and names the stale file"
# The remediation footer prints a recipe per KIND of problem present, and only those.
expect_out 'port.mjs --write   (then commit the result)' "footer: drift is fixed by regenerating, and says so"
expect_out 'never hand-edit them' "footer: …and says the drifted files are generated"
expect_no_out 'the files named above, THEN run' "footer: no staging advice when nothing needs staging"
expect_no_out 'restate the server in .codex/config.toml' "footer: no mcp recipe when there is no mcp problem"
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
# shellcheck disable=SC2016  # the backticks are literal Markdown in fixture text, not a command substitution
printf '\nRead `.Codex/rules/lessons-learned.md` before acting.\n' >> "$F/.claude/agents/demo.md"
gen "$F" --write
gen "$F" --check; expect_rc 1 "a reference to nonexistent .Codex/rules fails validation"
expect_out ".codex/agents/demo.toml: unresolved path .Codex/rules/lessons-learned.md" "…with the exact unresolved path and the file that carries it"
expect_out ': correct the path in the SOURCE' "footer: a dead reference is fixed in the source, and says so"

F="$(mkfix)"
# Wrong CASE only. On a case-insensitive filesystem a plain exists() says yes.
# shellcheck disable=SC2016  # the backticks are literal Markdown in fixture text, not a command substitution
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


echo "== generator: MCP value types must match the Codex schema =="
F="$(mkfix)"; gen "$F" --write
# shellcheck disable=SC2016  # The fixture must preserve Claude interpolation syntax literally.
printf '%s\n' '{"mcpServers":{"alpha":{"command":"npx","args":["mcp"],"env":{"TOKEN":"${TOKEN}","ORG":"acme"}}}}' > "$F/.mcp.json"
TYPE_OK='[mcp_servers.alpha]
command = "npx"
args = ["mcp"]
env_vars = ["TOKEN"]
default_tools_approval_mode = "prompt"
[mcp_servers.alpha.env]
ORG = "acme"'
for mutation in scalar_args scalar_env array_command array_cwd array_approval array_env numeric_args nested_args missing_comma trailing_value; do
  printf '%s\n' "$TYPE_OK" > "$F/.codex/config.toml"
  node -e '
    const fs=require("fs"),p=process.argv[1],kind=process.argv[2];
    const changes={"scalar_args":["args = [\"mcp\"]","args = \"mcp\""],"scalar_env":["env_vars = [\"TOKEN\"]","env_vars = \"TOKEN\""],"array_command":["command = \"npx\"","command = [\"npx\"]"],"array_cwd":["command = \"npx\"","command = \"npx\"\ncwd = [\"/tmp\"]"],"array_approval":["default_tools_approval_mode = \"prompt\"","default_tools_approval_mode = [\"prompt\"]"],"array_env":["ORG = \"acme\"","ORG = [\"acme\"]"],"numeric_args":["args = [\"mcp\"]","args = [\"mcp\", 1]"],"nested_args":["args = [\"mcp\"]","args = [[\"mcp\"]]"],"missing_comma":["args = [\"mcp\"]","args = [\"mcp\" \"extra\"]"],"trailing_value":["command = \"npx\"","command = \"npx\" true"]};
    const [from,to]=changes[kind];fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace(from,()=>to));
  ' "$F/.codex/config.toml" "$mutation"
  gen "$F" --check; expect_rc 1 "invalid MCP property type/syntax rejected: $mutation"
  expect_out 'expected ' "…reports the required property type: $mutation"
done
printf '%s\n' "$TYPE_OK" > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "string scalars and string arrays remain valid"
rm "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "deleting the entire Codex config cannot bypass parity"
printf '%s\n' "$TYPE_OK" > "$F/.codex/config.toml"
rm "$F/.mcp.json"
gen "$F" --check; expect_rc 1 "deleting the MCP manifest cannot bypass parity"
printf '%s\n' '{"mcpServers":{}}' > "$F/.mcp.json"
printf '%s\n' 'model = "x"' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "two explicitly empty server sets are in parity"

echo "== generator: MCP server parity =="
F="$(mkfix)"; gen "$F" --write
printf '{"mcpServers":{"alpha":{"command":"npx"},"beta":{"command":"npx"}}}\n' > "$F/.mcp.json"
printf 'model = "x"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "removing all MCP tables fails parity"
expect_out "alpha is in .mcp.json but not in .codex/config.toml" "…reports the first missing server"
expect_out "beta is in .mcp.json but not in .codex/config.toml" "…reports every missing server"
printf '[mcp_servers.alpha]\ncommand = "npx"\n\n[mcp_servers.alpha.env]\nA = "1"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "a server in .mcp.json that Codex lacks is a failure"
expect_out "beta is in .mcp.json but not in .codex/config.toml" "…naming the missing server"
expect_out ': restate the server in .codex/config.toml' "footer: an mcp mismatch is fixed in the hand-written config"
expect_out 'take it back out of the commit' "footer: …and names the recovery for a personal block committed by accident"
expect_no_out 'never hand-edit' "footer: …without ALSO being told never to hand-edit (the fix IS a hand edit)"
if grep -qF 'alpha.env' <<<"$OUT" || grep -qF ' env is in' <<<"$OUT"; then
  bad "a sub-table ([mcp_servers.alpha.env]) was mistaken for a server"
else
  ok "a server's sub-table is not counted as a server"
fi
printf '[mcp_servers.alpha]\ncommand = "npx"\n[mcp_servers.beta]\ncommand = "npx"\n[mcp_servers.gamma]\ncommand = "npx"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "a server Codex declares that .mcp.json lacks is a failure too"
expect_out "gamma is in .codex/config.toml but not in .mcp.json" "…naming the extra server"
printf '[mcp_servers.alpha]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n[mcp_servers.beta]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "matching server names pass"
# Quoted table names must be decoded and counted just like bare table names.
# Removing all declarations is now an error rather than a migration exception.
printf '[mcp_servers."alpha"]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n[mcp_servers."beta"]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "QUOTED server table names are read as servers"
expect_out "2 MCP servers declared for Codex, matching .mcp.json" "…counted, not mistaken for 'declares no servers'"
printf '[mcp_servers."alpha"]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "…and a quoted config missing a server is still a failure"
expect_out "beta is in .mcp.json but not in .codex/config.toml" "…naming it"
printf '[mcp_servers.alpha]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n[mcp_servers.beta]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n' > "$F/.codex/config.toml"

# SHAPE, not just names. Comparing names alone let a server be restated with the
# wrong package, the wrong command or a dropped credential NAME and still read as
# parity — Codex would then run something other than what .mcp.json describes, or
# start a server whose secret never reaches it. Each row mutates one field of a
# config that is otherwise in parity.
# shellcheck disable=SC2016  # ${ALPHA_TOKEN} is Claude's interpolation syntax, the literal text under test — it must NOT expand
printf '{"mcpServers":{"alpha":{"command":"npx","args":["-y","@scope/pkg@latest"],"env":{"ALPHA_TOKEN":"${ALPHA_TOKEN}","ALPHA_ORG":"acme"}}}}\n' > "$F/.mcp.json"
MCP_OK='[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n'
# shellcheck disable=SC2059  # the fixtures carry \n escapes that printf must expand
printf "$MCP_OK" > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "a server matching on command, args and env is parity"
expect_out 'name, command, args, secret names, approval mode and launch paths' "…and the note says what was compared, so a name-only check cannot masquerade as this one"
SHAPE_ROWS=0
while IFS='|' read -r LABEL FIXTURE NEEDLE; do
  [ -n "$LABEL" ] || continue
  SHAPE_ROWS=$((SHAPE_ROWS + 1))
  # shellcheck disable=SC2059  # as above
  printf "$FIXTURE" > "$F/.codex/config.toml"
  gen "$F" --check
  if [ "$RC" -eq 1 ] && grep -qF "$NEEDLE" <<<"$OUT"; then
    ok "MCP shape drift is caught: $LABEL"
  else
    bad "MCP shape drift went unreported ($LABEL): exit $RC, output: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-200)"
  fi
done <<'MCP_SHAPE_TABLE'
the wrong package in args|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@0.0.1"]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha args are
the wrong command|[mcp_servers.alpha]\ncommand = "node"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha command is
a dropped credential NAME, so the secret never reaches the server|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha forwards ALPHA_TOKEN
a changed non-secret literal|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "someone-else"\n|alpha sets ALPHA_ORG
an args array that is never closed is REPORTED, not read as empty|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n|could not be read
an EXTRA arg after a continuation line whose COMMENT holds a stray bracket|[mcp_servers.alpha]\ncommand = "npx"\nargs = [\n    "-y", "@scope/pkg@latest", # ] note\n    "--allow-shell-exec",\n]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha args are
MCP_SHAPE_TABLE
if [ "$SHAPE_ROWS" -eq 6 ]; then ok "all 6 MCP shape-drift rows were driven"; else bad "the MCP shape table was not walked: $SHAPE_ROWS of 6"; fi
# …and the SAME shape with no extra argument is parity, so the bracket-in-a-comment
# fix did not simply make every commented array unreadable. A `#` or a bracket
# INSIDE a quoted value is data, not a delimiter, on the same reasoning.
# shellcheck disable=SC2059  # the fixtures carry \n escapes that printf must expand
printf '[mcp_servers.alpha]\ncommand = "npx"\nargs = [\n    "-y", "@scope/pkg@latest", # ] note\n]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "a comment containing a bracket does not close the array early"
# The Codex app rewrites this file with MULTI-LINE arrays. That is the same TOML,
# so it must read as parity — a check that called it drift would go red every time
# the app touched the file.
# shellcheck disable=SC2059  # as above
printf '[mcp_servers.alpha]\ncommand = "npx"\nargs = [\n    "-y",\n    "@scope/pkg@latest",\n]\nenv_vars = [\n    "ALPHA_TOKEN",\n]\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "the multi-line array form the Codex app writes is parity, not drift"

# STRINGS are compared DECODED, the way Codex reads them: a basic string ("…")
# decodes TOML's escapes, and a literal string ('…') has none. The first cut took
# the raw text between the quotes, so a Windows path written the ordinary TOML way,
# "C:\\Users\\…", read as C:\\Users\\… against .mcp.json's decoded C:\Users\… and
# failed parity, and an escaped quote ended the string early (found writing the
# Windows launch-path rows below, board round 3 on #10135). Each row is in parity:
# .mcp.json holds the decoded value as JSON, config.toml the same value as TOML.
# The values go through printf's %s, never its format, so no backslash is eaten.
FS="$(mkfix)"; gen "$FS" --write
STRING_ROWS=0
while IFS='|' read -r LABEL JSON_ARGS TOML_ARGS; do
  [ -n "$LABEL" ] || continue
  STRING_ROWS=$((STRING_ROWS + 1))
  printf '{"mcpServers":{"alpha":{"command":"node","args":%s}}}\n' "$JSON_ARGS" > "$FS/.mcp.json"
  printf '[mcp_servers.alpha]\ncommand = "node"\nargs = %s\ndefault_tools_approval_mode = "prompt"\n' "$TOML_ARGS" > "$FS/.codex/config.toml"
  gen "$FS" --check
  if [ "$RC" -eq 0 ] && ! grep -qF 'mcp:' <<<"$OUT" && grep -qF '1 MCP servers declared for Codex, matching .mcp.json' <<<"$OUT"; then
    ok "a TOML string is compared decoded: $LABEL"
  else
    bad "a TOML string was not read as Codex reads it ($LABEL): exit $RC, output: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)"
  fi
done <<'MCP_STRING_TABLE'
escaped backslashes in a basic string (a Windows path)|["C:\\Users\\fixture\\run.mjs"]|["C:\\Users\\fixture\\run.mjs"]
an escaped double quote, which does not end the string|["-e", "console.log(\"a # [x]\")"]|["-e", "console.log(\"a # [x]\")"]
a \u escape|["x-y"]|["x\u002Dy"]
a \U escape|["x-y"]|["x\U0000002Dy"]
the short escapes \t \n \b \f \r|["a\tb\nc\bd\fe\rf"]|["a\tb\nc\bd\fe\rf"]
a literal string, whose backslashes are not escapes|["C:\\Users\\fixture\\run.mjs"]|['C:\Users\fixture\run.mjs']
MCP_STRING_TABLE
if [ "$STRING_ROWS" -eq 6 ]; then ok "all 6 MCP string rows were driven"; else bad "the MCP string table was not walked: $STRING_ROWS of 6"; fi
# A string the reader cannot decode is REPORTED, never compared as whatever text it
# happened to hold. TOML 1.0 makes an undefined escape and an unclosed string
# errors, and a multi-line string ("""…""" or '''…''') spans lines this
# line-based reader would otherwise take for keys. .mcp.json is in parity with the
# readable spelling of every row, so only the unreadable string can fail it.
printf '{"mcpServers":{"alpha":{"command":"node","args":["x"]}}}\n' > "$FS/.mcp.json"
UNREADABLE_ROWS=0
while IFS='|' read -r LABEL TOML_COMMAND TOML_ARGS NEEDLE; do
  [ -n "$LABEL" ] || continue
  UNREADABLE_ROWS=$((UNREADABLE_ROWS + 1))
  printf '[mcp_servers.alpha]\ncommand = %s\nargs = %s\ndefault_tools_approval_mode = "prompt"\n' "$TOML_COMMAND" "$TOML_ARGS" > "$FS/.codex/config.toml"
  gen "$FS" --check
  if [ "$RC" -eq 1 ] && grep -qF 'alpha could not be read from .codex/config.toml' <<<"$OUT" && grep -qF -- "$NEEDLE" <<<"$OUT"; then
    ok "an unreadable TOML string is reported, not compared: $LABEL"
  else
    bad "an unreadable TOML string was not reported ($LABEL): exit $RC, output: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)"
  fi
done <<'MCP_UNREADABLE_TABLE'
a Windows path in a basic string with single backslashes (\U then non-hex), an error in TOML 1.0|"node"|["C:\Users\x"]|args: invalid escape \U in a basic string
an escape TOML does not define|"node"|["a\qb"]|args: invalid escape \q in a basic string
a \u escape with too few hex digits|"node"|["\u12"]|args: invalid escape \u12 in a basic string
a \u escape naming a surrogate, which is not a Unicode scalar value|"node"|["\uD800"]|args: invalid escape \uD800 in a basic string
an unclosed basic string|"node|["x"]|command: a string is not closed
an unclosed literal string|'node|["x"]|command: a string is not closed
a multi-line basic string|"""node"""|["x"]|command: a multi-line string
a multi-line literal string|'''node'''|["x"]|command: a multi-line string
MCP_UNREADABLE_TABLE
if [ "$UNREADABLE_ROWS" -eq 8 ]; then ok "all 8 unreadable-string rows were driven"; else bad "the unreadable-string table was not walked: $UNREADABLE_ROWS of 8"; fi
# The same holds on a CONTINUATION line of a multi-line array, which is read by the
# array loop rather than as a key.
printf '[mcp_servers.alpha]\ncommand = "node"\nargs = [\n    %s,\n]\ndefault_tools_approval_mode = "prompt"\n' '"a\qb"' > "$FS/.codex/config.toml"
gen "$FS" --check; expect_rc 1 "an invalid escape on an array's continuation line fails the check"
expect_out 'alpha could not be read from .codex/config.toml (args: invalid escape \q in a basic string' "…naming the array and the escape, not 'array is not closed'"
# A multi-line string in a key the check does not compare is still reported: its
# body can hold lines that look like keys. Here the real command is "evil" and the
# decoy inside the string restates the parity values — read line by line, the
# decoy is the LAST command and the server would pass as parity.
printf '[mcp_servers.alpha]\ncommand = "evil"\nnote = """\ncommand = "node"\nargs = ["x"]\n"""\ndefault_tools_approval_mode = "prompt"\n' > "$FS/.codex/config.toml"
gen "$FS" --check; expect_rc 1 "a multi-line string in a key that is not compared still fails the check"
expect_out 'alpha could not be read from .codex/config.toml (note: a multi-line string' "…naming the key that holds it, so its body is never read as keys"
# OUTSIDE every server table the check stops before comparing anything, because
# there a multi-line string's body can pose as a whole server table. Here the only
# [mcp_servers.alpha] is inside a string, so Codex has NO server; read line by
# line, it passed as parity.
printf 'developer_instructions = """\n[mcp_servers.alpha]\ncommand = "node"\nargs = ["x"]\ndefault_tools_approval_mode = "prompt"\n"""\n' > "$FS/.codex/config.toml"
gen "$FS" --check; expect_rc 1 "a multi-line string outside every server table stops the check"
expect_out '.codex/config.toml cannot be read at line 1: a multi-line string' "…naming the line that could not be read"
expect_no_out 'MCP servers declared for Codex' "…and printing no parity note for a server list it could not trust"
# A string it cannot decode outside the server tables is reported the same way,
# even though the servers after it are in parity.
printf '%s\n[mcp_servers.alpha]\ncommand = "node"\nargs = ["x"]\ndefault_tools_approval_mode = "prompt"\n' 'model = "a\qb"' > "$FS/.codex/config.toml"
gen "$FS" --check; expect_rc 1 "an invalid escape outside every server table fails the check"
expect_out '.codex/config.toml cannot be read at line 1: invalid escape \q in a basic string' "…naming the line and the escape"


# Alternate TOML key spellings must not hide servers or launch arguments.
FK="$(mkfix)"; gen "$FK" --write
printf '{"mcpServers":{"alpha":{"command":"node"}}}\n' > "$FK/.mcp.json"
KEY_ROWS=0
while IFS='|' read -r LABEL HEADER KEY VALUE EXPECT NEEDLE; do
  [ -n "$LABEL" ] || continue
  KEY_ROWS=$((KEY_ROWS + 1))
  printf '%s\ncommand = "node"\ndefault_tools_approval_mode = "prompt"\n%s = %s\n' "$HEADER" "$KEY" "$VALUE" > "$FK/.codex/config.toml"
  gen "$FK" --check
  if [ "$RC" -eq "$EXPECT" ] && grep -qF "$NEEDLE" <<<"$OUT"; then
    ok "alternate TOML syntax is checked: $LABEL"
  else
    bad "alternate TOML syntax escaped checking ($LABEL): exit $RC, output: $OUT"
  fi
done <<'MCP_KEY_TABLE'
literal server name|[mcp_servers.'alpha']|args|[]|0|1 MCP servers declared for Codex
spaced table path|[ mcp_servers . alpha ]|args|[]|0|1 MCP servers declared for Codex
escaped namespace and name|["mcp_\u0073ervers"."al\u0070ha"]|args|[]|0|1 MCP servers declared for Codex
literal args key|[mcp_servers.alpha]|'args'|["-e","0"]|1|alpha args are
escaped args key|[mcp_servers.alpha]|"ar\u0067s"|["-e","0"]|1|alpha args are
inline env|[mcp_servers.alpha]|env|{TOKEN="literal"}|1|unsupported MCP property
dotted env|[mcp_servers.alpha]|env.TOKEN|"literal"|1|unsupported MCP property
MCP_KEY_TABLE
if [ "$KEY_ROWS" -eq 7 ]; then ok "all 7 alternate key rows were driven"; else bad "alternate key rows: $KEY_ROWS of 7"; fi

DECL_ROWS=0
while IFS='|' read -r LABEL DECL NEEDLE; do
  [ -n "$LABEL" ] || continue
  DECL_ROWS=$((DECL_ROWS + 1))
  printf '%b\n[mcp_servers.alpha]\ncommand = "node"\ndefault_tools_approval_mode = "prompt"\n' "$DECL" > "$FK/.codex/config.toml"
  gen "$FK" --check
  if [ "$RC" -eq 1 ] && grep -qF "$NEEDLE" <<<"$OUT"; then
    ok "hidden MCP declaration is caught: $LABEL"
  else
    bad "hidden MCP declaration passed ($LABEL): exit $RC, output: $OUT"
  fi
done <<'MCP_DECL_TABLE'
literal extra server|[mcp_servers.'hidden']\ncommand="node"|hidden is in .codex/config.toml but not in .mcp.json
spaced extra server|[mcp_servers . hidden]\ncommand="node"|hidden is in .codex/config.toml but not in .mcp.json
inline server under parent|[mcp_servers]\nhidden={command="node"}|unsupported MCP declaration
root inline namespace|mcp_servers={hidden={command="node"}}|unsupported MCP declaration
root dotted server|mcp_servers.hidden.command="node"|unsupported MCP declaration
literal root namespace|'mcp_servers'.hidden.command="node"|unsupported MCP declaration
array server table|[[mcp_servers.hidden]]\ncommand="node"|unsupported MCP table
implicit server in env sub-table|[mcp_servers.hidden.env]\nTOKEN="literal"|hidden is in .codex/config.toml but not in .mcp.json
MCP_DECL_TABLE
if [ "$DECL_ROWS" -eq 8 ]; then ok "all 8 hidden declaration rows were driven"; else bad "hidden declaration rows: $DECL_ROWS of 8"; fi

printf '[mcp_servers.alpha]\ncommand="node"\nargs=[""]\ndefault_tools_approval_mode="prompt"\n' > "$FK/.codex/config.toml"
gen "$FK" --check; expect_rc 1 "an empty argument differs from no arguments"
expect_out 'alpha args are [""]' "empty argument mismatch preserves array boundaries"
printf '[mcp_servers.alpha]\ncommand="node"\nenabled_tools=[\n "read",\n]\ndefault_tools_approval_mode="prompt"\n' > "$FK/.codex/config.toml"
gen "$FK" --check; expect_rc 0 "uncompared simple-key arrays may span lines"
expect_out '1 MCP servers declared for Codex, matching .mcp.json' "multiline options preserve server discovery"
# shellcheck disable=SC2016  # credential references are fixture data
printf '%s\n' '{"mcpServers":{"alpha":{"command":"node","env":{"API_KEY":"${API_KEY}"}}}}' > "$FK/.mcp.json"
printf '[mcp_servers.alpha]\ncommand="node"\nenv_vars=["API_KEY"]\ndefault_tools_approval_mode="prompt"\n' > "$FK/.codex/config.toml"
gen "$FK" --check; expect_rc 0 "same-name secret forwarding is parity"
expect_out '1 MCP servers declared for Codex, matching .mcp.json' "same-name forwarding is actually compared"
for ENV_KEY in API_KEY api_key; do
  printf '[mcp_servers.alpha]\ncommand="node"\nenv_vars=["API_KEY"]\ndefault_tools_approval_mode="prompt"\n[mcp_servers.alpha.env]\n%s="WRONG"\n' "$ENV_KEY" > "$FK/.codex/config.toml"
  gen "$FK" --check; expect_rc 1 "literal override of forwarded secret is rejected ($ENV_KEY)"
  expect_out 'alpha overrides forwarded secret API_KEY' "override diagnostic names the secret without its value"
done

# shellcheck disable=SC2016  # credential references are fixture data
printf '%s\n' '{"mcpServers":{"alpha":{"command":"node","env":{"API_KEY":"${OTHER_TOKEN}"}}}}' > "$FK/.mcp.json"
printf '[mcp_servers.alpha]\ncommand="node"\nenv_vars=["API_KEY","OTHER_TOKEN"]\ndefault_tools_approval_mode="prompt"\n' > "$FK/.codex/config.toml"
gen "$FK" --check; expect_rc 1 "a secret alias cannot masquerade as same-name forwarding"
expect_out 'alpha aliases OTHER_TOKEN to API_KEY' "the alias diagnostic names source and destination"

# APPROVAL MODE, which has no .mcp.json counterpart, so parity alone never saw it.
# docs/guides/codex-cli-support-matrix.md ("MCP servers") has every server set
# default_tools_approval_mode = "prompt", so its tools stay human-gated if Codex's
# own default moves. Nothing checked that: board round 1 on #10135 found taskboard
# (delete_ticket, move_ticket among its tools) as the one server of eight without
# it. Each row starts from MCP_OK, which is parity, and changes ONLY that setting.
APPROVAL_ROWS=0
while IFS='|' read -r LABEL FIXTURE NEEDLE; do
  [ -n "$LABEL" ] || continue
  APPROVAL_ROWS=$((APPROVAL_ROWS + 1))
  # shellcheck disable=SC2059  # as above
  printf "$FIXTURE" > "$F/.codex/config.toml"
  gen "$F" --check
  if [ "$RC" -eq 1 ] && grep -qF "$NEEDLE" <<<"$OUT"; then
    ok "an unpinned MCP approval mode is caught: $LABEL"
  else
    bad "an unpinned MCP approval mode went unreported ($LABEL): exit $RC, output: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-200)"
  fi
done <<'MCP_APPROVAL_TABLE'
the setting is absent, so the server runs on Codex's unpinned default|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha does not set default_tools_approval_mode = "prompt"
the setting is commented out|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\n# default_tools_approval_mode = "prompt"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha does not set default_tools_approval_mode = "prompt"
the setting sits in the env sub-table, where it is an environment variable, not the setting|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\ndefault_tools_approval_mode = "prompt"\n|alpha does not set default_tools_approval_mode = "prompt"
the setting approves every tool|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "approve"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha sets default_tools_approval_mode = "approve"
the setting is auto|[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\ndefault_tools_approval_mode = "auto"\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n|alpha sets default_tools_approval_mode = "auto"
MCP_APPROVAL_TABLE
if [ "$APPROVAL_ROWS" -eq 5 ]; then ok "all 5 MCP approval-mode rows were driven"; else bad "the MCP approval table was not walked: $APPROVAL_ROWS of 5"; fi
# The message says what to write and why, not merely that something differs.
# shellcheck disable=SC2059  # as above
printf '[mcp_servers.alpha]\ncommand = "npx"\nargs = ["-y", "@scope/pkg@latest"]\nenv_vars = ["ALPHA_TOKEN"]\n\n[mcp_servers.alpha.env]\nALPHA_ORG = "acme"\n' > "$F/.codex/config.toml"
gen "$F" --check
expect_out 'stay human-gated' "…and the approval report says why the setting matters"
expect_out "adding default_tools_approval_mode = \"prompt\" to that server's own table" "footer: …and the recipe says where the setting goes"
# The check is per server: with two declared, only the one that lacks it is named.
printf '{"mcpServers":{"alpha":{"command":"npx"},"beta":{"command":"node"}}}\n' > "$F/.mcp.json"
printf '[mcp_servers.alpha]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n\n[mcp_servers.beta]\ncommand = "node"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 1 "one server of two without the setting fails the check"
expect_out 'beta does not set default_tools_approval_mode = "prompt"' "…naming the server that lacks it"
expect_no_out 'alpha does not set' "…and not the server that has it"
# A literal-string value with a trailing comment is the same TOML as "prompt", so it
# must pass — a check that false-reds on valid spelling gets switched off.
printf "[mcp_servers.alpha]\ncommand = \"npx\"\ndefault_tools_approval_mode = 'prompt' # ask first\n\n[mcp_servers.beta]\ncommand = \"node\"\ndefault_tools_approval_mode = \"prompt\"\n" > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "a literal-string 'prompt' with a trailing comment is read as prompt"

# LAUNCH PATHS. Codex starts a stdio server in the directory the SESSION started
# in, and resolves a relative `cwd` against that same directory — not against
# .codex/ and not against the repository root (observed with codex-cli 0.144.1;
# docs/guides/codex-cli-support-matrix.md, "MCP servers"). So a path written
# relative to the repository root launches only from the root: board round 2 on
# #10135 found taskboard committed as `node .claude/hooks/taskboard-launch.mjs`,
# which fails its handshake in a session started in web/. Each row is otherwise
# in parity and prompt-gated; only the launch path differs. The args are written
# once and used in both files, since a JSON array of strings is also TOML.
F="$(mkfix)"; gen "$F" --write
printf '#!/usr/bin/env node\n' > "$F/.claude/hooks/launch.mjs"
# mcp_launch <command> <args-array-text> <cwd or empty> — write both files.
mcp_launch() {
  local cwd_line=''
  [ -z "$3" ] || cwd_line="cwd = \"$3\""$'\n'
  printf '{"mcpServers":{"alpha":{"command":"%s","args":%s}}}\n' "$1" "$2" > "$F/.mcp.json"
  printf '[mcp_servers.alpha]\ncommand = "%s"\nargs = %s\n%sdefault_tools_approval_mode = "prompt"\n' "$1" "$2" "$cwd_line" > "$F/.codex/config.toml"
}
LAUNCH_ROWS=0
while IFS='|' read -r LABEL COMMAND ARGS CWD NEEDLE; do
  [ -n "$LABEL" ] || continue
  LAUNCH_ROWS=$((LAUNCH_ROWS + 1))
  mcp_launch "$COMMAND" "$ARGS" "$CWD"
  gen "$F" --check
  if [ "$RC" -eq 1 ] && grep -qF -- "$NEEDLE" <<<"$OUT"; then
    ok "a launch path that depends on the start directory is caught: $LABEL"
  else
    bad "a start-directory-dependent launch path went unreported ($LABEL): exit $RC, output: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)"
  fi
done <<'MCP_LAUNCH_TABLE'
a script path relative to the repository root, in args (taskboard's shape before the fix)|node|[".claude/hooks/launch.mjs", "mcp"]||alpha runs ".claude/hooks/launch.mjs", a path relative to the repository root
an explicitly relative ./ path, even one that does not exist|node|["./launch.mjs", "mcp"]||alpha runs "./launch.mjs", a path relative to the repository root
a command that is itself a repo-relative path|.claude/hooks/launch.mjs|["mcp"]||alpha runs ".claude/hooks/launch.mjs", a path relative to the repository root
a relative cwd, which Codex resolves against the start directory, not .codex/|node|["-e", "0"]|..|alpha sets cwd = "..", a relative path
a repo-relative script path written with Windows separators|node|[".claude\\hooks\\launch.mjs", "mcp"]||alpha runs ".claude\\hooks\\launch.mjs", a path relative to the repository root
MCP_LAUNCH_TABLE
if [ "$LAUNCH_ROWS" -eq 5 ]; then ok "all 5 MCP launch-path rows were driven"; else bad "the MCP launch-path table was not walked: $LAUNCH_ROWS of 5"; fi
# ABSOLUTE on either convention is not start-directory relative. isAbs() accepts
# a Windows absolute path as well as a POSIX one, since this config is shared by
# sessions on both, and nothing pinned that half: board round 3 on #10135 dropped
# the win32 branch and this suite stayed green. Every row is in parity and
# prompt-gated, and must pass with no launch-path line.
#   - The cwd rows (a drive letter with either separator, and a UNC share) go red
#     without the win32 branch, because the cwd check flags anything not absolute.
#   - The command and arg rows use `\…`, which win32 reads as the root of the
#     current drive. It is the one Windows-absolute shape that ALSO names a file
#     relative to the repository root, so it is where dropping the branch turns
#     into a false positive on a command or an arg.
#   - A drive-letter arg (`C:\…`) names nothing under the root and passes either
#     way; its row pins the string decoding instead (read raw, "C:\\…" fails
#     parity against .mcp.json).
WIN_ROWS=0
while IFS='|' read -r LABEL COMMAND ARGS CWD; do
  [ -n "$LABEL" ] || continue
  WIN_ROWS=$((WIN_ROWS + 1))
  mcp_launch "$COMMAND" "$ARGS" "$CWD"
  gen "$F" --check
  if [ "$RC" -eq 0 ] && ! grep -qF 'mcp:' <<<"$OUT" && grep -qF 'approval mode and launch paths' <<<"$OUT"; then
    ok "a Windows-absolute launch path is not start-directory relative: $LABEL"
  else
    bad "a Windows-absolute launch path was misreported ($LABEL): exit $RC, output: $(printf '%s' "$OUT" | tr '\n' ' ' | cut -c1-300)"
  fi
done <<'MCP_WINDOWS_ABSOLUTE_TABLE'
a drive-letter cwd written with backslashes|node|["-e", "0"]|C:\\Users\\fixture
a drive-letter cwd written with forward slashes|node|["-e", "0"]|C:/Users/fixture
a UNC cwd|node|["-e", "0"]|\\\\fixture-host\\share
a script path rooted at the current drive, in args|node|["\\.claude\\hooks\\launch.mjs", "mcp"]|
a command rooted at the current drive|\\.claude\\hooks\\launch.mjs|["mcp"]|
a drive-letter script path in args|node|["C:\\Users\\fixture\\.claude\\hooks\\launch.mjs", "mcp"]|
MCP_WINDOWS_ABSOLUTE_TABLE
if [ "$WIN_ROWS" -eq 6 ]; then ok "all 6 Windows-absolute launch rows were driven"; else bad "the Windows-absolute launch table was not walked: $WIN_ROWS of 6"; fi
# The fix taskboard uses: git runs a `!` alias from the repository's top-level
# directory (git-config(1), alias.*), so the SAME relative path resolves from any
# start directory. The path sits inside one argument there, not as one, and must
# not read as a start-directory-dependent path.
mcp_launch git '["-c", "alias.fixture-launch=!node .claude/hooks/launch.mjs", "fixture-launch", "mcp"]' ''
gen "$F" --check; expect_rc 0 "a repo script launched through a git alias is not a start-directory-dependent path"
expect_out 'launch paths' "…and the parity note says launch paths were compared"
mcp_launch node '[".claude/hooks/launch.mjs", "mcp"]' ''
gen "$F" --check
expect_out 'launching it through a git alias' "footer: a launch-path line says how to fix it"

echo "== committed MCP config: taskboard launches from a subdirectory =="
# The property a user depends on (lessons-learned #1), checked on the COMMITTED
# files rather than a fixture: a session started anywhere in the checkout can
# start taskboard, the one server whose launcher is a file in this repository.
# Its committed command runs here from two directories below the root, with the
# final `mcp` swapped for `db-path` — the one runtime command with no side
# effect — so the answer proves the launcher was found, Python ran the runtime,
# and the argument arrived. TASKBOARD_API and TASKBOARD_BIN point at nothing
# usable: were the argument ever dropped, the runtime's default command
# (`doctor`) would try to START a board, and this way it fails fast instead.
TB_SPEC="$(node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).mcpServers.taskboard || {};
  process.stdout.write([s.command || "", ...(s.args || [])].join("\n"));
' "$REPO_ROOT/.mcp.json")"
mapfile -t TB <<<"$TB_SPEC"
TB_N=${#TB[@]}
if command -v python3 >/dev/null 2>&1 && python3 -c 'import tomllib' >/dev/null 2>&1; then
  TB_CODEX="$(python3 - "$REPO_ROOT/.codex/config.toml" <<'PY'
import sys, tomllib
s = tomllib.load(open(sys.argv[1], "rb")).get("mcp_servers", {}).get("taskboard", {})
sys.stdout.buffer.write("\n".join([s.get("command", "")] + list(s.get("args", []))).encode())
PY
)"
  if [ -n "$TB_CODEX" ] && [ "$TB_CODEX" = "$TB_SPEC" ]; then
    ok "the committed .codex/config.toml launches taskboard exactly as .mcp.json does, so the run below covers both"
  else
    bad "taskboard's launch differs between the files, so the run below covers only .mcp.json: codex=[$TB_CODEX] mcp.json=[$TB_SPEC]"
  fi
elif [ "${CI:-}" = "true" ]; then
  bad "python3 with tomllib is required in CI to read the committed .codex/config.toml taskboard launch"
else
  skip "python3/tomllib absent locally — the .codex/config.toml taskboard launch is not compared on this host"
fi
if [ "$TB_N" -lt 2 ] || [ "${TB[$((TB_N - 1))]}" != "mcp" ]; then
  bad "the committed taskboard launch no longer ends in \`mcp\` (got: ${TB[*]}), so swapping in db-path would test something else"
else
  NATIVE_TMP="$(cd "$TMP_ROOT" && { pwd -W 2>/dev/null || pwd; })"
  printf 'not a program\n' > "$TMP_ROOT/not-a-binary"
  TB_OUT="$(cd "$REPO_ROOT/tools/agentic-sync" && TASKBOARD_DB="$NATIVE_TMP/sentinel-taskboard.db" TASKBOARD_API='http://127.0.0.1:9/api' TASKBOARD_BIN="$NATIVE_TMP/not-a-binary" "${TB[@]:0:TB_N-1}" db-path 2>&1)"; TB_RC=$?
  if [ "$TB_RC" -eq 0 ] && grep -qF 'sentinel-taskboard.db' <<<"$TB_OUT"; then
    ok "the committed taskboard command, started in tools/agentic-sync/, finds its launcher and delivers its argument (exit 0, db-path answered)"
  elif grep -qF 'Taskboard requires Python 3' <<<"$TB_OUT" && [ "${CI:-}" != "true" ]; then
    skip "no Python 3 on this host — the launcher was found, but the runtime could not run"
  else
    bad "the committed taskboard command does not start from a subdirectory (exit $TB_RC): $(printf '%s' "$TB_OUT" | tr '\n' ' ' | cut -c1-300)"
  fi
fi

echo "== generator: --write may delete ONLY what it generated =="
# The lock is a committed text file. A bad merge resolution, or an edit, can put
# any path in it — and the first cut of --write deleted whatever it named,
# a SOURCE hook script included (found by the review board).
F="$(mkfix)"; gen "$F" --write
printf 'keep me\n' > "$F/README.md"
lock_set "$F" "README.md" '"0000"'; lock_set "$F" ".claude/hooks/ok.sh" '"0000"'
gen "$F" --write; expect_rc 2 "--write refuses a lock that names a path outside its targets"
expect_out '"README.md"' "…naming the foreign path"
if [ -f "$F/README.md" ] && [ -f "$F/.claude/hooks/ok.sh" ]; then
  ok "…and neither the unrelated file nor the SOURCE hook script was deleted"
else
  bad "--write deleted a file outside its targets"
fi
gen "$F" --check; expect_rc 2 "--check refuses the same tampered lock instead of advising --write"
F="$(mkfix)"; gen "$F" --write
lock_set "$F" ".agents/skills/../../README.md" '"0000"'
printf 'keep me\n' > "$F/README.md"
gen "$F" --write; expect_rc 2 "a lock entry that climbs out of a target with .. is refused too"
if [ -f "$F/README.md" ]; then ok "…and the file it pointed at survives"; else bad "a ..-path in the lock deleted a file"; fi

echo "== generator: the check is two-directional =="
F="$(mkfix)"; gen "$F" --write
printf 'hand added\n' > "$F/.agents/skills/alpha/EXTRA.md"
gen "$F" --check; expect_rc 1 "a hand-added file inside a mirrored skill is drift"
expect_out "extra:    .agents/skills/alpha/EXTRA.md" "…and is named"
expect_out 'never deletes a file it cannot prove it wrote' "footer: an extra file gets its own recipe"
expect_no_out '(then commit the result)' "footer: …and is NOT told that regenerating fixes it (--write never deletes a file it did not write)"
# --write must agree with --check. It used to skip this kind, so the documented
# fix path — run --write, commit — printed "in sync" and the first red was in CI.
gen "$F" --write; expect_rc 1 "--write does not claim success over a tree the next --check rejects"
expect_out "extra:    .agents/skills/alpha/EXTRA.md" "…it names the same extra file"
expect_no_out "in sync with .claude/" "…and does not print the success line"
if [ -f "$F/.agents/skills/alpha/EXTRA.md" ]; then ok "…and still does not delete a file it did not write"; else bad "--write deleted an unowned file"; fi
rm "$F/.agents/skills/alpha/EXTRA.md"
# shellcheck disable=SC2016  # literal Markdown backticks in fixture text
printf 'name = "rogue"\ndescription = "x"\ndeveloper_instructions = "Read `.Codex/rules/x.md`"\n' > "$F/.codex/agents/rogue.toml"
gen "$F" --check; expect_rc 1 "a hand-added agent that is neither generated nor declared handAuthored is drift"
expect_out "extra:    .codex/agents/rogue.toml" "…and is named"
expect_out ".codex/agents/rogue.toml: unresolved path .Codex/rules/x.md" "…and its dead reference is reported too — every .codex file is scanned, not only planned ones"

echo "== generator: the dead-reference validator has no blind spot in this repo's own spellings =="
# Each of these passed the first cut of the validator (found by the review board).
# dead_ref <text appended to the agent body> <expected substring> <label>
dead_ref() {
  F="$(mkfix)"
  printf '\n%s\n' "$1" >> "$F/.claude/agents/demo.md"
  gen "$F" --write
  gen "$F" --check
  if [ "$RC" -eq 1 ] && grep -qF -- "$2" <<<"$OUT"; then ok "$3"; else bad "$3 — exit $RC, wanted '$2' in: $OUT"; fi
}
# live_ref <text> <label> — must NOT be reported.
live_ref() {
  F="$(mkfix)"
  printf '\n%s\n' "$1" >> "$F/.claude/agents/demo.md"
  gen "$F" --write
  gen "$F" --check
  if [ "$RC" -eq 0 ]; then ok "$2"; else bad "$2 — reported a live or non-repo path: $OUT"; fi
}
# shellcheck disable=SC2016  # these are literal fixture text; nothing here should expand
{
  dead_ref 'Run "$ROOT/.Codex/rules/x.md".'                                  'unresolved path .Codex/rules/x.md' 'a dead path after $ROOT/ is caught'
  dead_ref 'Run bash "$(git rev-parse --show-toplevel)/.Codex/tools/y.sh".'  'unresolved path .Codex/tools/y.sh' 'a dead path after $(git rev-parse --show-toplevel)/ is caught'
  dead_ref 'Run "${ROOT}/.Codex/rules/x.md".'                                'unresolved path .Codex/rules/x.md' 'a dead path after ${ROOT}/ is caught'
  dead_ref 'See ./.Codex/rules/x.md.'                                         'unresolved path .Codex/rules/x.md' 'a dead path after ./ is caught'
  dead_ref 'Read every `.Codex/rules/*.md`.'                                  'unresolved path .Codex/rules/'       'a GLOB still has its literal directory checked'
  dead_ref 'See `.Codex/skills/<name>/SKILL.md`.'                             'unresolved path .Codex/skills/'      'a PLACEHOLDER still has its literal directory checked'
  dead_ref 'See `.Codex/rules/{a,b}.md`.'                                     'unresolved path .Codex/rules/'       'a BRACE pattern still has its literal directory checked'
  dead_ref 'See nested/.claude/hooks/ok.sh.'                                  'checked as nested/.claude/hooks/ok.sh' 'a relative prefix is part of the path, not a reason to skip it'
  live_ref 'Read every `.claude/hooks/*.sh` and `.claude/skills/<name>/SKILL.md`.' 'a glob or placeholder under a directory that exists passes'
  live_ref 'Import **@.claude/hooks/ok.sh** first.'                           'Claude @-import syntax and Markdown bold are read as a root path, not a prefix or a glob'
  live_ref 'User memory lives in ~/.claude/projects/x and at https://example.com/org/repo/.github/workflows/ci.yml.' 'a home path and a URL are not repository paths'
  live_ref 'CI checks out to /home/runner/work/x/.claude/hooks/gone.sh.'      'an absolute path on another machine is not a repository path'
}

echo "== generator: every hook KEY is classified, like every event and script =="
F="$(mkfix)"; json_set "$F/.claude/settings.json" hooks.PreToolUse.0.hooks.0.once true
gen "$F" --check; expect_rc 2 "an unknown HANDLER key stops the generator"
expect_out 'key "once"' "…naming the key"
F="$(mkfix)"; json_set "$F/.claude/settings.json" hooks.PreToolUse.0.unless '"x"'
gen "$F" --check; expect_rc 2 "an unknown GROUP key stops the generator"
expect_out 'key "unless"' "…naming the key"
F="$(mkfix)"; json_set "$F/.claude/settings.json" hooks.Stop.0.hooks.0.command '"bash .claude/hooks/ok.sh --flag value"'
gen "$F" --check; expect_rc 2 "arguments after the script name stop the generator — the adapter is called with the name only, so they would vanish"
F="$(mkfix)"; json_set "$F/.claude/settings.json" hooks.Stop.0.hooks.0.command '"echo .claude/hooks/ok.sh"'
gen "$F" --check; expect_rc 2 "a command that merely MENTIONS a script is not mistaken for one that runs it"

F="$(mkfix)"
# (On a Bash-only group: a Bash `if` anywhere else stops the generator — below.)
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.matcher '"Bash"'
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.if '"Bash(git push *)"'
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.hooks.0.async true
json_set "$F/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Bash","if":"Bash(gh api *)","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]},{"matcher":"Bash","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F" --write; expect_rc 0 "\`if\` and \`async\` are accepted because both are classified"
CJ="$F/.codex/hook-conditions.json"
# A PreToolUse `if` is classified and then deliberately NOT emitted: on the
# blocking event the script always starts and routes on the command itself. A
# filter in front of it is a second, weaker router (it skipped `g''it commit`).
if [ "$(json_get "$CJ" '@has:PreToolUse')" = "false" ]; then
  ok "a PreToolUse \`if\` is NOT written to hook-conditions.json — the blocking script always starts"
else
  bad "a PreToolUse condition was emitted, so the adapter would filter a blocking script: $(cat "$CJ" 2>/dev/null)"
fi
F3="$(mkfix)"
json_set "$F3/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Bash","if":"Bash(git push *)","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F3" --write; expect_rc 0 "a PostToolUse \`if\` is accepted"
if [ "$(json_get "$F3/.codex/hook-conditions.json" 'PostToolUse.ok\.sh.0')" = "Bash(git push *)" ]; then
  ok "…and IS written, keyed by event and script: on a non-gating event an unfiltered run costs real work"
else
  bad "the PostToolUse condition was not recorded: $(cat "$F3/.codex/hook-conditions.json" 2>/dev/null)"
fi
# Spellings Claude Code accepts but a whole-word matcher can never satisfy: a word
# glued to the glob. Ported silently, the script would simply never start.
for BADIF in 'Bash(git push:*)' 'Bash(git push*)' 'Bash(*)' 'Bash(git  push *)'; do
  F3="$(mkfix)"
  json_set "$F3/.claude/settings.json" hooks.PostToolUse "[{\"matcher\":\"Bash\",\"if\":\"$BADIF\",\"hooks\":[{\"type\":\"command\",\"command\":\"bash .claude/hooks/ok.sh\"}]}]"
  gen "$F3" --check; expect_rc 2 "an \`if\` spelled $BADIF stops the generator — the adapter's matcher could never honour it"
done
if [ "$(json_get "$CJ" '@has:PostToolUse')" = "false" ]; then
  ok "a script ALSO wired without a condition is never narrowed — it always runs"
else
  bad "an unconditional wiring was narrowed by a conditional one: $(cat "$CJ")"
fi
# The same rule has a SECOND code site: the unconditional group comes FIRST and
# a later conditional one must not turn its `null` back into a list. Only the
# other order was tested, so deleting that guard left the suite green while the
# adapter skipped an always-run hook for every non-matching command.
F2="$(mkfix)"
json_set "$F2/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Bash","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]},{"matcher":"Bash","if":"Bash(gh api *)","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F2" --write; expect_rc 0 "unconditional group first, conditional second: accepted"
if [ "$(json_get "$F2/.codex/hook-conditions.json" '@has:PostToolUse')" = "false" ]; then
  ok "…and in THAT order too the script is never narrowed"
else
  bad "a later conditional group narrowed an unconditional wiring: $(cat "$F2/.codex/hook-conditions.json")"
fi
if [ "$(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0.hooks.0.@has:async')" = "false" ] \
   && [ "$(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0.@has:if')" = "false" ]; then
  ok "neither key reaches hooks.json (Codex skips an async handler outright, and has no \`if\`)"
else
  bad "async or if leaked into hooks.json"
fi

F="$(mkfix)"
printf -- '---\nname: folded\ndescription: >\n  A folded\n  description\n---\n\nbody\n' > "$F/.claude/agents/folded.md"
gen "$F" --check; expect_rc 2 "a YAML block-scalar description is refused rather than emitted as the description \">\""
expect_out "block scalar" "…and the message says why"

F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F" --write
if [ "$(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0.hooks.0.timeout')" = "100" ] \
   && [ "$(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0.matcher')" = "apply_patch" ]; then
  ok "a handler with NO timeout gets the manifest default (10 s per file, x10 for a patch) instead of no bound at all; a PostToolUse edit hook stays apply_patch-only"
else
  bad "default timeout / PostToolUse matcher wrong: $(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0')"
fi
# The x10 has a ceiling (hooks.maxTimeoutSeconds, 600). No fixture reached it, so
# removing the cap could not change any asserted value. 100 s per file x 10 is
# 1000; both what Codex is told and the budget the adapter is handed must say 600.
F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Edit|Write","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh","timeout":100}]}]'
gen "$F" --write
if [ "$(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0.hooks.0.timeout')" = "600" ] \
   && [ "$(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0.hooks.0.commandWindows')" = "node .codex/hooks/run-claude-hook.mjs ok.sh 100 600" ]; then
  ok "a patch hook's budget is CAPPED at maxTimeoutSeconds (100 s x 10 -> 600, not 1000), in the declared timeout and in the adapter's argument"
else
  bad "the timeout cap is wrong: $(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0.hooks.0')"
fi

F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.matcher '"Edit|Write|Bash"'
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.hooks.0.statusMessage '"Checking things"'
gen "$F" --write
if [ "$(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0.matcher')" = "apply_patch|Bash" ] \
   && [ "$(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0.hooks.0.commandWindows')" = "node .codex/hooks/run-claude-hook.mjs ok.sh 5 50" ] \
   && [ "$(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0.hooks.0.statusMessage')" = "Checking things" ]; then
  ok "a hook ALREADY wired for Bash (Edit|Write|Bash) is not put in edit mode — it must see every shell command — and keeps its status line"
else
  bad "mixed matcher handling is wrong: $(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0')"
fi
F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.hooks.0.statusMessage '"Checking sanitization patterns"'
gen "$F" --write
if [ "$(json_get "$F/.codex/hooks.json" 'hooks.PreToolUse.0.hooks.0.@has:statusMessage')" = "false" ]; then
  ok "an edit-ONLY hook drops its status line: it now matches every shell command too, where that line would be false"
else
  bad "statusMessage leaked onto an edit-only handler"
fi
# The same falsehood, second source: a group with an `if`. Codex has no `if`, so
# the handler is matched for EVERY shell command and the adapter exits 0 for
# most of them — "Checking for unreplied review comments" on an `ls`.
F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Bash","if":"Bash(git push *)","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh","statusMessage":"Checking for unreplied review comments"}]},{"matcher":"Bash","hooks":[{"type":"command","command":"bash .claude/hooks/warn.sh","statusMessage":"Always runs"}]}]'
printf '#!/usr/bin/env bash\nexit 0\n' > "$F/.claude/hooks/warn.sh"
git -C "$F" add -A >/dev/null 2>&1 || true
gen "$F" --write
if [ "$(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.0.hooks.0.@has:statusMessage')" = "false" ] \
   && [ "$(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse.1.hooks.0.statusMessage')" = "Always runs" ]; then
  ok "a CONDITIONAL hook drops its status line (it is matched for every command, acts on few); an unconditional one beside it keeps its own"
else
  bad "statusMessage on conditional/unconditional handlers is wrong: $(json_get "$F/.codex/hooks.json" 'hooks.PostToolUse')"
fi
# The conditions file holds ONE of the source's `if` keys today. It has to say why,
# or the rest read as a generator bug and get "fixed" by hand. (Same fixture: its
# only condition is a PostToolUse one, which IS written.)
README_TEXT="$(json_get "$F/.codex/hook-conditions.json" _README)"
if grep -qF 'NON-GATING events only' <<<"$README_TEXT" && grep -qF 'is left out ON PURPOSE' <<<"$README_TEXT" \
   && [ "$(json_get "$F/.codex/hook-conditions.json" 'PostToolUse.ok\.sh.0')" = "Bash(git push *)" ]; then
  ok "the generated conditions file says it carries non-gating events only, and that a PreToolUse \`if\` is absent on purpose"
else
  bad "hook-conditions.json does not explain what it leaves out: $README_TEXT"
fi
F="$(mkfix)"; json_set "$F/.claude/settings.json" hooks.PreToolUse.0.if '"Edit(web/**)"'
gen "$F" --check; expect_rc 2 "an \`if\` written for a tool other than Bash stops the generator — it would be silently skipped for a carried patch"
expect_out 'Edit(web/**)' "…naming the condition"
# A Bash condition belongs on a group Codex matches for Bash ALONE. The adapter
# consults a condition for a shell command and for nothing else, so on a wider
# group the script would also run after every patch (or every tool call) — the
# cost the conditions file exists to prevent — and on an Edit|Write group the
# condition can never hold. Each shape was ported with every gate green.
WIDE=0
while IFS='#' read -r LABEL MATCHER REACHES; do
  WIDE=$((WIDE + 1))
  for EV in PreToolUse PostToolUse; do
    F="$(mkfix)"
    json_set "$F/.claude/settings.json" "hooks.$EV" "[{${MATCHER}\"if\":\"Bash(git push *)\",\"hooks\":[{\"type\":\"command\",\"command\":\"bash .claude/hooks/ok.sh\"}]}]"
    gen "$F" --check; expect_rc 2 "$EV: a Bash \`if\` on a group with $LABEL stops the generator — the condition would not narrow the other tools"
    expect_out "reaches $REACHES under Codex" "…saying which tools the group reaches ($REACHES)"
  done
done <<'WIDE_IF_TABLE'
no matcher##every tool
the matcher Edit|Write|Bash#"matcher":"Edit|Write|Bash",#apply_patch and Bash
the matcher Edit|Write#"matcher":"Edit|Write",#apply_patch
WIDE_IF_TABLE
if [ "$WIDE" -eq 3 ]; then ok "all 3 wide-group shapes were driven, on both tool events"; else bad "the wide-\`if\` table was not walked: $WIDE of 3"; fi
F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Bash","if":"Bash(git push *)","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F" --check; RC_BASH_ONLY=$RC
if [ "$RC_BASH_ONLY" -ne 2 ]; then ok "…control: the same condition on a Bash-only group is accepted (exit $RC_BASH_ONLY ≠ 2)"; else bad "a Bash \`if\` on a Bash-only group stopped the generator: $OUT"; fi

# A PreToolUse group matched for BOTH edit channels is ported, and SAID: a patch
# carried in a shell command reaches such a hook as a plain command, its files not
# shown (the adapter has no mode that does both). A note on every run, so it is
# seen when the group is written.
F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks.PreToolUse '[{"matcher":"Edit|Write|Bash","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F" --write
expect_out 'matched for BOTH apply_patch and Bash: ok.sh' "a PreToolUse group that reaches both edit channels is named in a note"
expect_out '-only group, which is wired for both channels' "…which says where a file-gating check must live instead"
# …and in --check, the mode CI runs (scripts/check-codex-port.sh) and so the only
# mode anyone ever reads the note in. It was asserted under --write alone.
gen "$F" --check
expect_out 'matched for BOTH apply_patch and Bash: ok.sh' "…and the note is printed in --check too, which is the mode CI runs"
F="$(mkfix)"; gen "$F" --write
expect_no_out 'matched for BOTH' "…and an Edit|Write-only group (the default fixture) draws no such note"

echo "== generator: the emitted commands are exactly what Codex must execute =="
F="$(mkfix)"; gen "$F" --write
HJ="$F/.codex/hooks.json"
# shellcheck disable=SC2016  # the $(...) is literal text Codex will hand to a shell
WANT_POSIX='node "$(git rev-parse --show-toplevel)/.codex/hooks/run-claude-hook.mjs" ok.sh 5 50 edit'
# shellcheck disable=SC2016  # as above: literal text for a shell Codex will start
WANT_STOP='node "$(git rev-parse --show-toplevel)/.codex/hooks/run-claude-hook.mjs" ok.sh 3 8'
if [ "$(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0.command')" = "$WANT_POSIX" ] \
   && [ "$(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0.commandWindows')" = "node .codex/hooks/run-claude-hook.mjs ok.sh 5 50 edit" ] \
   && [ "$(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0.timeout')" = "50" ] \
   && [ "$(json_get "$HJ" 'hooks.Stop.0.hooks.0.command')" = "$WANT_STOP" ] \
   && [ "$(json_get "$HJ" 'hooks.Stop.0.hooks.0.timeout')" = "8" ]; then
  ok "commands carry the per-file timeout and the budget: an apply_patch hook gets per-file x factor, any other gets per-file + overhead"
else
  bad "unexpected command strings: $(json_get "$HJ" 'hooks.PreToolUse.0.hooks.0')"
fi
# The patch budget follows the matcher Codex SEES. A tool-event group with no
# matcher (or `*`, or '') is emitted matcher-less, Codex matches it for
# apply_patch like everything else, and the adapter runs it once per touched
# path — read off the source's alias list it got the single-run budget (3 8), and
# a many-file patch ran out of a time sized for one file. It is NOT an edit-only
# hook either: nothing narrows it, so it must keep acting on plain shell commands.
for MATCHER in '' '"matcher":"",' '"matcher":"*",'; do
  for EV in PreToolUse PostToolUse; do
    F="$(mkfix)"
    json_set "$F/.claude/settings.json" "hooks.$EV" "[{${MATCHER}\"hooks\":[{\"type\":\"command\",\"command\":\"bash .claude/hooks/ok.sh\",\"timeout\":3}]}]"
    gen "$F" --write
    GOT="$(json_get "$F/.codex/hooks.json" "hooks.$EV.0.hooks.0.commandWindows")"
    if [ "$GOT" = "node .codex/hooks/run-claude-hook.mjs ok.sh 3 30" ] && [ "$(json_get "$F/.codex/hooks.json" "hooks.$EV.0.hooks.0.timeout")" = "30" ] \
       && [ "$(json_get "$F/.codex/hooks.json" "hooks.$EV.0.@has:matcher")" = "false" ]; then
      ok "$EV group with ${MATCHER:-no matcher}: emitted matcher-less WITH the patch budget (3 30), and not as an edit-only hook"
    else
      bad "$EV group with ${MATCHER:-no matcher} was ported as: $GOT (wanted … ok.sh 3 30, no matcher)"
    fi
  done
done
# (Only on the events that carry a tool call: the matcher-less Stop hook in the
# case above keeps `3 8`, which is what pins the event test in the generator.)
if command -v git >/dev/null 2>&1; then
  # Run the generated POSIX command for real, from a SUBDIRECTORY of a git repo.
  cat > "$F/.claude/hooks/ok.sh" <<'MARK'
#!/usr/bin/env bash
echo ran > "$MARKER"
MARK
  git -C "$F" init -q 2>/dev/null
  mkdir -p "$F/web/src"
  MARKER_FILE="$F/marker"
  if ( cd "$F/web/src" && printf '{"hook_event_name":"Stop"}' | MARKER="$MARKER_FILE" bash -c "$(json_get "$HJ" 'hooks.Stop.0.hooks.0.command')" >/dev/null 2>&1 ) \
     && [ -f "$MARKER_FILE" ]; then
    ok "the generated POSIX command, run from a subdirectory, finds the adapter and runs the script end to end"
  else
    bad "the generated POSIX command did not run the script from a subdirectory"
  fi
else
  bad "git is required to prove the generated command runs end to end"
fi

echo "== generator: a path that leaves the plan is released, orphaned, or modified — only an orphan is deleted =="
# The exact move made for kanban/game-engine/web-accessibility, and a likely
# outcome of #10131: a mirrored skill is declared `independent`. Its .agents copy
# is now hand-maintained and must survive (found by the second review board).
F="$(mkfix)"
# A second mirrored skill, so that handing `alpha` over does not leave an empty
# mirror (which the generator refuses for a different, deliberate reason).
mkdir -p "$F/.claude/skills/gamma"
printf -- '---\nname: gamma\ndescription: stays mirrored\n---\n' > "$F/.claude/skills/gamma/SKILL.md"
gen "$F" --write
json_set "$F/tools/agentic-sync/port.json" skills.independent.alpha '"now maintained by hand on the .agents side"'
gen "$F" --check
if grep -qF 'orphan:' <<<"$OUT"; then
  bad "a skill that became independent was reported as an orphan: $OUT"
else
  ok "a skill that became independent is not called an orphan"
fi
gen "$F" --write; expect_rc 0 "--write succeeds after a skill is handed over"
expect_out "released 2 path(s)" "…and says it released the paths rather than removing them"
if [ -f "$F/.agents/skills/alpha/SKILL.md" ] && [ -f "$F/.agents/skills/alpha/scripts/run.sh" ]; then
  ok "…and the now hand-maintained copy is still there"
else
  bad "--write deleted a skill that had been declared independent"
fi
gen "$F" --check; expect_rc 0 "…and the tree is in sync afterwards, with the paths gone from the lock"

F="$(mkfix)"
# A SECOND agent, so removing demo's source does not leave an empty agent set —
# which the generator refuses with exit 2 before any release logic runs. Without
# it this case "passed" on that early exit and exercised nothing.
printf -- '---\nname: other\ndescription: stays generated\n---\n\nbody\n' > "$F/.claude/agents/other.md"
gen "$F" --write
json_set "$F/tools/agentic-sync/port.json" agents.handAuthored.demo '"taken over by hand"'
rm "$F/.claude/agents/demo.md"
gen "$F" --write
expect_out "released 1 path(s)" "handing an agent over reaches the release logic, and --write reports the release"
if [ -f "$F/.codex/agents/demo.toml" ]; then
  ok "an agent that became handAuthored is released, not deleted"
else
  bad "--write deleted an agent that had been declared handAuthored"
fi
# The released file still opens with "GENERATED from .claude/agents/demo.md" —
# a path that no longer exists, in a file a person now owns. The reference check
# says so, which is the prompt to take the header over too.
expect_rc 1 "…and the released file's stale 'GENERATED from' header is reported, not waved through"
expect_out "unresolved path .claude/agents/demo.md" "…naming the dead source path"
file_replace "$F/.codex/agents/demo.toml" '# GENERATED from .claude/agents/demo.md by tools/agentic-sync/port.mjs' '# HAND-AUTHORED (formerly generated); listed under agents.handAuthored in'
# shellcheck disable=SC2016  # literal Markdown backticks in the text being replaced
file_replace "$F/.codex/agents/demo.toml" 'This role is generated from `.claude/agents/demo.md`.' 'This role is maintained by hand.'
gen "$F" --check; expect_rc 0 "once the person takes the header over, the tree checks clean with the agent hand-authored"

# A lock entry for a file in a target directory that this tool never wrote — a
# third-party skill, say. The prefix test alone accepted it and --write deleted it.
F="$(mkfix)"; gen "$F" --write
mkdir -p "$F/.agents/skills/thirdparty"
printf -- '---\nname: thirdparty\ndescription: not ours\n---\n' > "$F/.agents/skills/thirdparty/SKILL.md"
lock_set "$F" ".agents/skills/thirdparty/SKILL.md" '"0000000000000000000000000000000000000000000000000000000000000000"'
gen "$F" --write; expect_rc 1 "a lock entry whose hash does not match the file is NOT treated as an orphan"
expect_out "modified: .agents/skills/thirdparty/SKILL.md" "…it is reported as modified, naming the file"
expect_out 'never deletes a file it cannot prove it wrote' "footer: a modified file gets its own recipe"
if [ -f "$F/.agents/skills/thirdparty/SKILL.md" ]; then
  ok "…and the file this tool never wrote is still there"
else
  bad "--write deleted a file it did not write because the lock named it"
fi
lock_set "$F" ".agents/skills/thirdparty/SKILL.md" 'null'
gen "$F" --write
if [ -f "$F/.agents/skills/thirdparty/SKILL.md" ]; then
  ok "an entry with NO hash (the first lock format) proves nothing and deletes nothing"
else
  bad "a hashless lock entry caused a deletion"
fi

F="$(mkfix)"; gen "$F" --write
rm -rf "$F/.claude/skills/alpha"
mkdir -p "$F/.claude/skills/beta"
printf -- '---\nname: beta\ndescription: second fixture skill\n---\n' > "$F/.claude/skills/beta/SKILL.md"
printf 'edited after generation\n' >> "$F/.agents/skills/alpha/SKILL.md"
gen "$F" --write
if [ -f "$F/.agents/skills/alpha/SKILL.md" ] && [ ! -e "$F/.agents/skills/alpha/scripts/run.sh" ] && grep -qF 'modified: .agents/skills/alpha/SKILL.md' <<<"$OUT"; then
  ok "of two orphans, the untouched one is deleted and the hand-edited one is kept and reported"
else
  bad "orphan/modified split is wrong: $OUT"
fi
# …and it must KEEP being reported. The first cut rebuilt the lock from the plan
# alone, so one --write forgot the path: the next --check was green with a skill
# deleted from .claude/ still on disk and still discoverable by Codex.
gen "$F" --check; expect_rc 1 "a modified path is still reported by the NEXT --check — it is not forgotten after one --write"
expect_out "modified: .agents/skills/alpha/SKILL.md" "…naming the same file"
gen "$F" --write; gen "$F" --check; expect_rc 1 "…and by the one after that, for as long as the file is there"
rm -rf "$F/.agents/skills/alpha"
gen "$F" --write; gen "$F" --check; expect_rc 0 "once a person removes the file, the entry leaves the lock and the tree is in sync"

# The FIRST lock format: `generated` is an ARRAY of paths, no hashes. Nothing it
# names can be proven to be this tool's work, so nothing it names is deleted.
F="$(mkfix)"; gen "$F" --write
rm -rf "$F/.claude/skills/alpha"
mkdir -p "$F/.claude/skills/beta"
printf -- '---\nname: beta\ndescription: second fixture skill\n---\n' > "$F/.claude/skills/beta/SKILL.md"
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const l = JSON.parse(fs.readFileSync(p, "utf8"));
  l.generated = Object.keys(l.generated);
  fs.writeFileSync(p, JSON.stringify(l));
' "$F/tools/agentic-sync/port.lock.json"
gen "$F" --write; expect_rc 1 "a paths-only (first-format) lock deletes nothing — every departed path is 'modified'"
if [ -f "$F/.agents/skills/alpha/SKILL.md" ] && [ -f "$F/.agents/skills/alpha/scripts/run.sh" ]; then
  ok "…and both departed files are still on disk"
else
  bad "a hashless array lock caused a deletion"
fi
expect_out "modified: .agents/skills/alpha/scripts/run.sh" "…each reported by name"

F="$(mkfix)"
# A directory where a file is expected: readFileSync throws EISDIR, which no
# explicit die() anticipates — it reaches the top-level catch.
rm "$F/.claude/agents/demo.md"; mkdir "$F/.claude/agents/demo.md"
gen "$F" --check; expect_rc 2 "an UNANTICIPATED exception is exit 2 (could not run), never exit 1 (drift)"
expect_out "unexpected error" "…through the top-level catch, which says so"

echo "== generator: fail-closed means exit 2, never an uncaught exception =="
# A structural step that matches NOTHING must fail, not emit an empty result: with
# every wired script skipped by name, hooks.json would be `{}` and Codex would
# enforce nothing while the gate read "in sync".
F="$(mkfix)"
json_set "$F/.claude/settings.json" hooks '{"Stop":[{"hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]}'
json_set "$F/tools/agentic-sync/port.json" hooks.skipScripts '{"ok.sh":"fixture: skip the only wired script"}'
gen "$F" --check; expect_rc 2 "a settings.json whose every hook is skipped by name stops the generator"
expect_out "nothing was ported" "…saying that nothing was ported, rather than emitting an empty hooks.json"
# A lock that is not JSON. Rebuilding it silently would forget every \`modified\`
# entry and every orphan it was tracking.
F="$(mkfix)"; gen "$F" --write
printf '{ broken' > "$F/tools/agentic-sync/port.lock.json"
gen "$F" --check; expect_rc 2 "--check: a lock that is not valid JSON is exit 2"
expect_out "port.lock.json is not valid JSON" "…naming the file"
gen "$F" --write; expect_rc 2 "--write: the same — it does not quietly rebuild the lock"
if [ "$(cat "$F/tools/agentic-sync/port.lock.json")" = '{ broken' ]; then
  ok "…and the broken lock is left exactly as it was, for a person to look at"
else
  bad "--write rewrote an unparseable lock: $(head -c 120 "$F/tools/agentic-sync/port.lock.json")"
fi
F="$(mkfix)"; printf '{"skills":{},"agents":{},"hooks":{}}' > "$F/tools/agentic-sync/port.json"
gen "$F" --check; expect_rc 2 "a valid-JSON manifest missing required keys is exit 2 (it used to be a TypeError and exit 1, which the gate reads as drift)"
expect_out "manifest.skills.source" "…naming the first missing field"
F="$(mkfix)"; json_set "$F/tools/agentic-sync/port.json" hooks.patchTimeoutFactor '"ten"'
gen "$F" --check; expect_rc 2 "a manifest field of the wrong type is exit 2"
F="$(mkfix)"; printf 'not json at all' > "$F/.claude/settings.json"
gen "$F" --check; expect_rc 2 "an unparseable settings.json is exit 2"

echo "== generator: agents — every branch that decides what Codex is told =="
F="$(mkfix)"; gen "$F" --write
if grep -qx 'model_reasoning_effort = "high"' "$F/.codex/agents/demo.toml"; then
  ok "\`effort\` is emitted as model_reasoning_effort"
else
  bad "effort was not carried over: $(grep -n effort "$F/.codex/agents/demo.toml")"
fi
F="$(mkfix)"; file_replace "$F/.claude/agents/demo.md" 'effort: high' 'effort: ludicrous'
gen "$F" --check; expect_rc 2 "an effort Codex does not accept stops the generator"
expect_out '"ludicrous"' "…naming the value"
F="$(mkfix)"; file_replace "$F/.claude/agents/demo.md" 'name: demo' 'name: someone-else'
gen "$F" --check; expect_rc 2 "a frontmatter name that disagrees with the file name stops the generator"
F="$(mkfix)"; printf -- '---\nname: code-architect\ndescription: now has a source\n---\n\nbody\n' > "$F/.claude/agents/code-architect.md"
gen "$F" --check; expect_rc 2 "an agent listed as handAuthored that ALSO has a source is a contradiction, not a silent overwrite"
F="$(mkfix)"; file_replace "$F/.claude/agents/demo.md" 'effort: high' 'effort: high|disallowedTools: [Bash]'
gen "$F" --check; expect_rc 2 "an unclassified frontmatter KEY stops the generator — a future enforcement key must not vanish silently"
expect_out 'key "disallowedTools"' "…naming the key"

if command -v python3 >/dev/null 2>&1 && python3 -c 'import tomllib' >/dev/null 2>&1; then
  TOML_REPORT="$(python3 - "$REPO_ROOT/.codex/agents" <<'PY'
import glob, os, sys, tomllib
files = sorted(glob.glob(os.path.join(sys.argv[1], "*.toml")))
bad = []
for f in files:
    try:
        d = tomllib.load(open(f, "rb"))
        for k in ("name", "description", "developer_instructions"):
            if not str(d.get(k, "")).strip():
                bad.append(f"{os.path.basename(f)}: empty {k}")
        if d.get("name") + ".toml" != os.path.basename(f):
            bad.append(f"{os.path.basename(f)}: name does not match file")
    except Exception as e:
        bad.append(f"{os.path.basename(f)}: {e}")
print(f"{len(files)} {'OK' if not bad else 'BAD ' + '; '.join(bad)}")
PY
)"
  case "$TOML_REPORT" in
    "0 "*) bad "no committed .codex/agents/*.toml found — the parse check ran on nothing" ;;
    *" OK") ok "every COMMITTED .codex/agents/*.toml parses with its required keys, the hand-authored one included (${TOML_REPORT%% *} files)" ;;
    *) bad "a committed Codex agent does not parse: $TOML_REPORT" ;;
  esac
elif [ "${CI:-}" = "true" ]; then
  bad "python3 with tomllib is required in CI to prove the committed agents parse"
else
  skip "python3/tomllib absent locally — committed agents not parsed on this host"
fi

echo "== generator: line endings and binary files =="
F="$(mkfix)"
printf -- '---\r\nname: alpha\r\ndescription: fixture skill\r\n---\r\n\r\n# Alpha with CRLF\r\n' > "$F/.claude/skills/alpha/SKILL.md"
printf '\000\001\002BINARY\r\n\377' > "$F/.claude/skills/alpha/blob.bin"
gen "$F" --write
gen "$F" --check; expect_rc 0 "a CRLF source generates and checks clean"
if grep -q "$(printf '\r')" "$F/.agents/skills/alpha/SKILL.md"; then
  bad "CRLF was written into the mirror — the committed form must be LF"
else
  ok "the mirror of a CRLF text source is written with LF"
fi
if cmp -s "$F/.claude/skills/alpha/blob.bin" "$F/.agents/skills/alpha/blob.bin"; then
  ok "a binary file is copied byte-for-byte (its CR LF bytes are not 'normalised')"
else
  bad "a binary file was altered by line-ending normalisation"
fi
F="$(mkfix)"; gen "$F" --write
# An autocrlf checkout: the mirror on disk has CRLF, the source has LF.
node -e 'const fs=require("fs");const p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,"utf8").split("\n").join("\r\n"));' "$F/.agents/skills/alpha/SKILL.md"
gen "$F" --check; expect_rc 0 "a mirror checked out with CRLF is not phantom drift"

echo "== generator: git-backed behaviour (symlink stubs, executable bits, committed MCP config) =="
if ! command -v git >/dev/null 2>&1; then
  bad "git is required for the symlink-stub, executable-bit and committed-config cases"
else
  # gitfix — a fixture that is a real repository, so the index can be consulted.
  gitfix() {
    local d; d="$(mkfix)"
    git -C "$d" init -q
    git -C "$d" config user.email fixture@example.invalid
    git -C "$d" config user.name fixture
    git -C "$d" config core.autocrlf false
    # The stub cases below record a path as a symlink in the INDEX while the
    # worktree holds a regular file — a `core.symlinks=false` checkout, i.e.
    # Windows. That state only survives a later `git add -A` if git is told the
    # same thing: with core.symlinks=true (the Linux default) the add sees a
    # regular file, re-stages it as 100644, and the premise is gone — which is
    # how one of these cases passed on Windows and went red on the CI runner.
    # With it false, git documents that add/update-index "will not change the
    # recorded type to regular file". Real symlinks are tested separately, in a
    # fixture that is not a repository.
    git -C "$d" config core.symlinks false
    echo "$d"
  }
  # as_symlink <fixture> <path> — record <path> in the index as a symlink whose
  # target is the file's current content. With the worktree file left a regular
  # file this is EXACTLY a `core.symlinks=false` checkout — the Windows branch —
  # and it is reproducible on every host.
  as_symlink() {
    local blob; blob="$(git -C "$1" hash-object -w "$1/$2")"
    git -C "$1" update-index --add --cacheinfo "120000,$blob,$2"
  }

  F="$(gitfix)"
  mkdir -p "$F/.claude/rules"; printf 'TRACKED RULE BODY\n' > "$F/.claude/rules/r.md"
  printf '../../rules/r.md' > "$F/.claude/skills/alpha/ref.md"
  git -C "$F" add -A; as_symlink "$F" ".claude/skills/alpha/ref.md"
  gen "$F" --write; expect_rc 0 "a symlink STUB (core.symlinks=false) to a tracked file is followed"
  if [ "$(cat "$F/.agents/skills/alpha/ref.md" 2>/dev/null)" = "TRACKED RULE BODY" ]; then
    ok "…and the mirror holds the TARGET's content, not the stub's path text"
  else
    bad "stub was not dereferenced: '$(cat "$F/.agents/skills/alpha/ref.md" 2>/dev/null)'"
  fi

  F="$(gitfix)"
  printf 'SECRET=1\n' > "$F/.env.local"
  printf '../../../.env.local' > "$F/.claude/skills/alpha/notes.md"
  git -C "$F" add -A -- . ':!.env.local'; as_symlink "$F" ".claude/skills/alpha/notes.md"
  gen "$F" --write; expect_rc 2 "a stub pointing at an UNTRACKED in-repo file (.env.local) is refused"
  expect_out "not a file git tracks" "…and says why"
  if grep -rqF 'SECRET=1' "$F/.agents" 2>/dev/null; then bad "the secret reached the mirror"; else ok "…and the secret never reaches the mirror"; fi

  F="$(gitfix)"
  printf '/etc/hostname' > "$F/.claude/skills/alpha/abs.md"
  git -C "$F" add -A; as_symlink "$F" ".claude/skills/alpha/abs.md"
  gen "$F" --write; expect_rc 2 "a stub with an ABSOLUTE target is refused"
  F="$(gitfix)"
  printf '../../../../outside.md' > "$F/.claude/skills/alpha/up.md"
  git -C "$F" add -A; as_symlink "$F" ".claude/skills/alpha/up.md"
  gen "$F" --write; expect_rc 2 "a stub that climbs out of the repository is refused"

  # The third way a skill is handed over: `.claude/skills/<name>` is replaced by a
  # link to the .agents side (this repo's layout for third-party skills). The
  # .agents copy is then the CANONICAL one; deleting it as an orphan would
  # delete the only copy.
  F="$(gitfix)"
  mkdir -p "$F/.claude/skills/gamma"
  printf -- '---\nname: gamma\ndescription: stays mirrored\n---\n' > "$F/.claude/skills/gamma/SKILL.md"
  gen "$F" --write
  rm -rf "$F/.claude/skills/alpha"
  printf '../../.agents/skills/alpha' > "$F/.claude/skills/alpha"
  git -C "$F" add -A; as_symlink "$F" ".claude/skills/alpha"
  gen "$F" --write; expect_rc 0 "a skill whose .claude side became a LINK to the .agents side is handed over cleanly"
  if [ -f "$F/.agents/skills/alpha/SKILL.md" ] && [ -f "$F/.agents/skills/alpha/scripts/run.sh" ]; then
    ok "…and the now-canonical .agents copy is released from the lock, not deleted"
  else
    bad "--write deleted the canonical copy of a skill that moved behind a symlink"
  fi
  git -C "$F" add -A
  gen "$F" --check; expect_rc 0 "…and the tree checks clean afterwards"

  # Executable bits: --write mutates the git INDEX, and chmods the file on disk.
  #
  # The source is made executable in BOTH places. The first cut set the bit in
  # the index only, which holds on Windows (core.fileMode=false) and nowhere
  # else: on Linux the next `git add -A` re-reads the 0644 file and stages the
  # SOURCE as 100644 again, so the premise evaporated and the case went red in
  # CI after passing here. `chmod` is a no-op on Windows; `update-index` is
  # redundant on Linux; together they say the same thing on every host.
  F="$(gitfix)"
  chmod +x "$F/.claude/skills/alpha/scripts/run.sh"
  git -C "$F" add -A
  git -C "$F" update-index --chmod=+x .claude/skills/alpha/scripts/run.sh
  if [ "$(git -C "$F" ls-files -s .claude/skills/alpha/scripts/run.sh | cut -c1-6)" != "100755" ]; then
    bad "fixture is broken: the SOURCE script is not 100755 in the index, so nothing below means anything"
  fi
  gen "$F" --write
  # Does this filesystem carry an executable bit at all? (Not on Windows.)
  PROBE_X="$F/.probe-x"; : > "$PROBE_X"; chmod +x "$PROBE_X"
  if [ -x "$PROBE_X" ] && chmod -x "$PROBE_X" && [ ! -x "$PROBE_X" ]; then
    if [ -x "$F/.agents/skills/alpha/scripts/run.sh" ] && [ ! -x "$F/.agents/skills/alpha/SKILL.md" ]; then
      ok "the mirrored script is executable ON DISK before anything is staged, and a plain file is not"
    else
      bad "on-disk mode is wrong: run.sh $([ -x "$F/.agents/skills/alpha/scripts/run.sh" ] && echo +x || echo -x), SKILL.md $([ -x "$F/.agents/skills/alpha/SKILL.md" ] && echo +x || echo -x)"
    fi
  else
    # A genuine platform limit: this filesystem has no executable bit to set.
    skip "this filesystem carries no executable bit — the on-disk chmod is asserted on POSIX hosts; the index is asserted below on every host"
  fi
  rm -f "$PROBE_X"
  git -C "$F" add -A
  gen "$F" --write
  MIRROR_MODE="$(git -C "$F" ls-files -s .agents/skills/alpha/scripts/run.sh | cut -c1-6)"
  if [ "$MIRROR_MODE" = "100755" ]; then
    ok "a mirrored script carries its source's executable bit in the index (core.fileMode on or off)"
  else
    bad "mirror index mode is '$MIRROR_MODE', source is 100755"
  fi
  gen "$F" --check; expect_rc 0 "…and --check is clean once it does"
  git -C "$F" update-index --chmod=-x .agents/skills/alpha/scripts/run.sh
  gen "$F" --check; expect_rc 1 "a mirror whose index mode differs from its source is drift"
  expect_out "mode:     .agents/skills/alpha/scripts/run.sh" "…reported as \`mode:\`, naming the file"
  expect_out "git update-index --chmod=+x" "…with the exact command that fixes it"
  expect_out 'port.mjs --write   (then commit the result)' "footer: mode DRIFT (index differs from source) is fixed by regenerating"
  expect_no_out 'the files named above, THEN run' "footer: …which is not the staging recipe — that one is for a bit that is not staged yet"
  if [ "$(git -C "$F" ls-files -s .agents/skills/alpha/SKILL.md | cut -c1-6)" = "100644" ]; then
    ok "a non-executable source stays non-executable"
  else
    bad "a plain file was marked executable"
  fi

  # Only what git TRACKS is mirrored: a stray file beside a skill script must not
  # ride into a tracked directory reviewers are told not to read line by line.
  F="$(gitfix)"
  git -C "$F" add -A
  printf 'SECRET=1\n' > "$F/.claude/skills/alpha/.env"
  mkdir -p "$F/.claude/skills/alpha/__pycache__"; printf 'bytecode\n' > "$F/.claude/skills/alpha/__pycache__/x.pyc"
  printf '__pycache__/\n' > "$F/.gitignore"; git -C "$F" add .gitignore
  gen "$F" --write; expect_rc 1 "an untracked file that git does NOT ignore is a problem in --write too — it is about to be committed, and the mirror would first be found missing in CI"
  expect_out "untracked: .claude/skills/alpha/.env" "…named as \`untracked:\`"
  expect_out 'the files named above, THEN run' "footer: an untracked source is fixed by staging first"
  expect_no_out '(then commit the result)' "footer: …and it does NOT tell someone who has just run --write to run --write"
  if grep -qF 'untracked: .claude/skills/alpha/__pycache__' <<<"$OUT"; then
    bad "a git-IGNORED file was reported as a problem; it should only be listed"
  else
    ok "a git-ignored file (__pycache__) is listed but is not a problem"
  fi
  expect_out "not tracked by git and were NOT mirrored" "…and says it left files out"
  expect_out ".claude/skills/alpha/.env" "…naming the untracked .env"
  expect_out ".claude/skills/alpha/__pycache__/x.pyc" "…and the untracked bytecode"
  if [ ! -e "$F/.agents/skills/alpha/.env" ] && [ ! -e "$F/.agents/skills/alpha/__pycache__" ] && [ -f "$F/.agents/skills/alpha/SKILL.md" ]; then
    ok "an untracked .env and a __pycache__ are NOT mirrored; the tracked files are"
  else
    bad "an untracked file was mirrored: $(ls -A "$F/.agents/skills/alpha")"
  fi

  # Which mode is the truth depends on core.fileMode, and the two must be told
  # apart: make DISK and INDEX disagree and see which one the mirror follows.
  F="$(gitfix)"
  git -C "$F" add -A
  if [ "$(git -C "$F" config --get core.fileMode)" = "true" ]; then
    FILEMODE_HOST=1
    chmod +x "$F/.claude/skills/alpha/scripts/run.sh"   # disk +x, index still 100644
    gen "$F" --write
    if [ -x "$F/.agents/skills/alpha/scripts/run.sh" ]; then
      ok "core.fileMode=true: the DISK mode wins — a freshly chmod +x'ed source gives an executable mirror before anything is re-staged"
    else
      bad "core.fileMode=true: the mirror followed the stale index mode, not the disk"
    fi
    chmod -x "$F/.claude/skills/alpha/scripts/run.sh"
    git -C "$F" update-index --chmod=+x .claude/skills/alpha/scripts/run.sh   # index +x, disk 0644
    gen "$F" --write
    if [ ! -x "$F/.agents/skills/alpha/scripts/run.sh" ]; then
      ok "core.fileMode=true: an index-only +x that the next git add would revert does NOT make the mirror executable"
    else
      bad "core.fileMode=true: the mirror followed the index against the disk"
    fi
  else
    FILEMODE_HOST=0
  fi

  # The core.fileMode=false branch needs nothing from the filesystem — the bit
  # lives in the index — so it runs on EVERY host, not only where false is the
  # default. Left to the host default it ran on Windows alone, and Linux CI never
  # executed the branch Windows contributors depend on.
  if [ "$FILEMODE_HOST" = 1 ]; then
    F="$(gitfix)"
    git -C "$F" config core.fileMode false
    git -C "$F" add -A
  fi
  if [ "$(git -C "$F" config --get core.fileMode)" != "false" ]; then
    bad "core.fileMode=false fixture: the repository does not report core.fileMode=false"
  else
    git -C "$F" update-index --chmod=+x .claude/skills/alpha/scripts/run.sh   # the only place the bit can live here
    gen "$F" --write
    expect_rc 1 "core.fileMode=false: the FIRST --write does not end by claiming 'in sync'"
    expect_out "must be executable but is not staged" "…it says the mirrored script still needs staging"
    expect_out 'the files named above, THEN run' "footer: the unstaged executable is fixed by staging first"
    expect_no_out '(then commit the result)' "footer: …not by the command that was just run"
    gen "$F" --check; expect_rc 1 "core.fileMode=false: and a local --check is RED until that is done (the drift must not first appear in CI)"
    expect_out "must be executable but is not staged" "…naming the reason"
    git -C "$F" add -A; gen "$F" --write
    if [ "$(git -C "$F" ls-files -s .agents/skills/alpha/scripts/run.sh | cut -c1-6)" = "100755" ]; then
      ok "core.fileMode=false: the INDEX mode wins — after staging, the second --write repairs the mirror's index entry"
    else
      bad "core.fileMode=false: the mirror's index mode was not repaired"
    fi
    gen "$F" --check; expect_rc 0 "…and the check is clean"
  fi

  # A reference that passes THROUGH a symlink stub (core.symlinks=false). On this
  # repository's Windows checkouts `.claude/skills/tdd` is a text file, so
  # `.claude/skills/tdd/SKILL.md` resolves only if the stub is followed by hand.
  F="$(gitfix)"
  mkdir -p "$F/.agents/skills/native"
  printf -- '---\nname: native\ndescription: lives on the agents side\n---\n' > "$F/.agents/skills/native/SKILL.md"
  printf '../../.agents/skills/native' > "$F/.claude/skills/linked"
  # shellcheck disable=SC2016  # literal Markdown backticks in fixture text
  printf '\nRead `.claude/skills/linked/SKILL.md`.\n' >> "$F/.claude/agents/demo.md"
  git -C "$F" add -A; as_symlink "$F" ".claude/skills/linked"
  gen "$F" --write; git -C "$F" add -A
  if [ "$(git -C "$F" ls-files -s .claude/skills/linked | cut -c1-6)" != "120000" ]; then
    bad "fixture is broken: .claude/skills/linked is no longer a symlink in the index after 'git add -A', so the case below tests nothing"
  fi
  gen "$F" --check; expect_rc 0 "a reference THROUGH a symlink stub resolves (it is a real path wherever links are real)"
  # shellcheck disable=SC2016
  printf '\nRead `.claude/skills/linked/NOPE.md`.\n' >> "$F/.claude/agents/demo.md"
  gen "$F" --write
  gen "$F" --check; expect_rc 1 "…and a dead path through the same stub is still caught"
  expect_out "unresolved path .claude/skills/linked/NOPE.md" "…by name"

  # MCP parity reads the COMMITTED config, like check-codex-config-safety.sh.
  F="$(gitfix)"; gen "$F" --write
  printf '{"mcpServers":{"alpha":{"command":"npx"},"beta":{"command":"npx"}}}\n' > "$F/.mcp.json"
  printf '[mcp_servers.alpha]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n[mcp_servers.beta]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n' > "$F/.codex/config.toml"
  git -C "$F" add -A; git -C "$F" commit -q -m fixture
  gen "$F" --check; expect_rc 0 "committed config in parity passes"
  printf 'model = "x"\n[mcp_servers.alpha]\ncommand = "npx"\ndefault_tools_approval_mode = "prompt"\n' > "$F/.codex/config.toml"
  gen "$F" --check; expect_rc 0 "an UNCOMMITTED local edit to config.toml (a contributor trying out a server) does not turn a local check red"
  git -C "$F" add -A; git -C "$F" commit -q -m "commit the partial block"
  gen "$F" --check; expect_rc 1 "…but once COMMITTED, a partial server list is a failure"
  expect_out "beta is in .mcp.json but not in .codex/config.toml" "…naming the missing server"
fi

echo "== generator: a real symlink (POSIX hosts) =="
F="$(mkfix)"
printf 'SECRET=1\n' > "$F/.env.local"
if ln -s ../../../.env.local "$F/.claude/skills/alpha/notes" 2>/dev/null && [ -L "$F/.claude/skills/alpha/notes" ]; then
  gen "$F" --write; expect_rc 2 "a real symlink to an untracked in-repo file is refused"
  if grep -rqF 'SECRET=1' "$F/.agents" 2>/dev/null; then bad "the secret reached the mirror"; else ok "…and its content never reaches the mirror"; fi
else
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      # A genuine platform limit: Git Bash cannot create a symlink without the
      # privilege. The STUB branch above is what this platform actually runs.
      skip "this Windows host cannot create a real symlink — the stub branch above covers what it executes" ;;
    *)
      # Anywhere else, not being able to build the fixture is a broken test, not
      # an inapplicable one (lessons-learned #9).
      bad "could not create a symlink on $(uname -s) — the containment case did not run" ;;
  esac
fi

echo "== the wrapper: exit codes are the contract, and CI ignores the node override =="
# The generator reads CODEX_PORT_ROOT; the wrapper locates node and the generator.
wrap() { OUT="$(env -u CI "$@" bash "$WRAPPER" 2>&1)"; RC=$?; }
F="$(mkfix)"; gen "$F" --write
wrap CODEX_PORT_ROOT="$F"; expect_rc 0 "wrapper: an in-sync tree is exit 0"
printf '\nedit\n' >> "$F/.claude/skills/alpha/SKILL.md"
wrap CODEX_PORT_ROOT="$F"; expect_rc 1 "wrapper: drift is exit 1"
expect_out "never hand-edit" "…with the remediation text (drift IS fixed by regenerating, never by hand)"
# …but the wrapper must add NOTHING of its own after the generator's footer. It
# used to end every failure with "never hand-edit it" — directly under a recipe
# that, for a dead reference or an MCP mismatch, says to edit a hand-written file.
F2="$(mkfix)"; gen "$F2" --write
# shellcheck disable=SC2016  # the backticks are markdown in the fixture file, not a command
printf 'See `.Codex/rules/nowhere.md` for the rules.\n' > "$F2/.codex/AGENTS.md"
wrap CODEX_PORT_ROOT="$F2"; expect_rc 1 "wrapper: a dead reference in a hand-written .codex file is exit 1"
expect_out "unresolved path .Codex/rules/nowhere.md" "…naming it"
expect_no_out "never hand-edit" "…and the LAST thing the log says is not 'never hand-edit' — the fix for this one is a hand edit"
wrap CODEX_PORT_ROOT="$F" CODEX_PORT_NODE="$TMP_ROOT/no-such-node"; expect_rc 2 "wrapper: a node binary that does not exist is exit 2, not a pass"
STUB="$TMP_ROOT/stub-node"; printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB"; chmod +x "$STUB"
wrap CODEX_PORT_ROOT="$F" CODEX_PORT_NODE="$STUB"; expect_rc 0 "wrapper: outside CI the test-only node override is honoured (this is the seam)"
OUT="$(CI=true CODEX_PORT_ROOT="$F" CODEX_PORT_NODE="$STUB" bash "$WRAPPER" 2>&1)"; RC=$?
expect_rc 1 "wrapper: under CI=true the override is IGNORED — a stub that exits 0 cannot turn drift green"
printf '{ broken' > "$F/tools/agentic-sync/port.json"
wrap CODEX_PORT_ROOT="$F"; expect_rc 2 "wrapper: a generator that cannot run is exit 2, never 0"

echo "== adapter: Codex payload → the shape the shared hook scripts read =="
H="$(mktemp -d "$TMP_ROOT/hooks.XXXXXX")"
LOG="$H/log"
# A cwd node can see on every host (an MSYS /tmp path means nothing to node.exe).
# `pwd -W` is Git-for-Windows' "Windows path, forward slashes"; elsewhere it
# fails and plain `pwd` is already what node sees.
CWD_NATIVE="$(cd "$TMP_ROOT" && { pwd -W 2>/dev/null || pwd; })"
# probe.sh records what it was given: the env path, then its stdin verbatim.
cat > "$H/probe.sh" <<'PROBE'
#!/usr/bin/env bash
printf 'ENV=%s\n' "${TOOL_INPUT_file_path:-<unset>}" >> "$PROBE_LOG"
cat >> "$PROBE_LOG.stdin"
printf '\n' >> "$PROBE_LOG.stdin"
exit 0
PROBE
# guard.sh blocks any path containing "protected" — a stand-in for a path policy.
cat > "$H/guard.sh" <<'GUARD'
#!/usr/bin/env bash
printf 'SAW=%s\n' "${TOOL_INPUT_file_path:-<unset>}" >> "$PROBE_LOG"
case "${TOOL_INPUT_file_path:-}" in *protected*) echo "guard: protected path" >&2; exit 2 ;; esac
exit 0
GUARD
printf '#!/usr/bin/env bash\necho "blocked: policy says no" >&2\nexit 2\n' > "$H/block.sh"
printf '#!/usr/bin/env bash\nexit 2\n' > "$H/block-silent.sh"
printf '#!/usr/bin/env bash\necho "boom" >&2\nexit 7\n' > "$H/crash.sh"
printf '#!/usr/bin/env bash\necho "WARNING: db.transaction() detected"\n' > "$H/text.sh"
cat > "$H/ctx.sh" <<'CTX'
#!/usr/bin/env bash
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"ctx for %s"}}' "${TOOL_INPUT_file_path##*/}"
CTX
cat > "$H/allow.sh" <<'ALLOW'
#!/usr/bin/env bash
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"safe","additionalContext":"remember the rule"},"suppressOutput":true}'
ALLOW
cat > "$H/deny.sh" <<'DENY'
#!/usr/bin/env bash
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"not on main"}}'
DENY
cat > "$H/stopblock.sh" <<'STOPB'
#!/usr/bin/env bash
printf '%s' '{"decision":"block","reason":"review is incomplete"}'
STOPB

# adapt <script> <payload-json> — sets RC, OUT (stdout) and ERR (stderr).
adapt() {
  ERR_FILE="$H/err"
  # ADAPT_ARGS is "<per-run-seconds> <budget-seconds>", deliberately unquoted.
  # shellcheck disable=SC2086
  OUT="$(printf '%s' "$2" | CODEX_HOOK_SCRIPT_DIR="$H" CODEX_HOOK_CONDITIONS="${COND_FILE:-$H/no-conditions.json}" PROBE_LOG="$LOG" node "$ADAPTER" "$1" ${ADAPT_ARGS:-} 2>"$ERR_FILE")"
  RC=$?
  ERR="$(cat "$ERR_FILE")"
}
# out_get <dotted.path> — read a field of the adapter's JSON stdout.
out_get() { printf '%s' "$OUT" > "$H/out.json"; json_get "$H/out.json" "$1"; }
# patch_payload <event> <patch-with-\n-escapes> — a Codex apply_patch payload.
patch_payload() {
  printf '{"cwd":"%s","hook_event_name":"%s","tool_name":"apply_patch","tool_input":{"command":"%s"}}' "$CWD_NATIVE" "$1" "$2"
}
# bash_payload <event> <command> — a Codex Bash payload.
bash_payload() { printf '{"hook_event_name":"%s","tool_name":"Bash","tool_input":{"command":"%s"}}' "$1" "$2"; }
runs() { grep -c "^$1=" "$LOG" 2>/dev/null || true; }

PATCH='*** Begin Patch\n*** Add File: web/src/new.ts\n+export const a = 1;\n*** Update File: web/src/old.ts\n@@\n-const b = 1;\n+const b = 2;\n*** Delete File: web/src/gone.ts\n*** End Patch\n'
PAYLOAD="$(patch_payload PreToolUse "$PATCH")"
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$PAYLOAD"; expect_rc 0 "an apply_patch payload runs the script and succeeds"
if [ "$(runs ENV)" = "3" ]; then
  ok "the script runs once per TOUCHED path — added, updated AND deleted"
else
  bad "expected 3 runs, log has: $(cat "$LOG" 2>/dev/null)"
fi
if grep -qxF "ENV=$CWD_NATIVE/web/src/new.ts" "$LOG" && grep -qxF "ENV=$CWD_NATIVE/web/src/old.ts" "$LOG" \
   && grep -qxF "ENV=$CWD_NATIVE/web/src/gone.ts" "$LOG" && ! grep -q '[\\]' "$LOG"; then
  ok "TOOL_INPUT_file_path is set, resolved against the payload cwd, and forward-slashed on every platform"
else
  bad "TOOL_INPUT_file_path is wrong (cwd $CWD_NATIVE): $(cat "$LOG")"
fi
sed -n '1p' "$LOG.stdin" > "$H/first.json"; sed -n '3p' "$LOG.stdin" > "$H/third.json"
if [ "$(json_get "$H/first.json" tool_name)" = "Write" ] && [ "$(json_get "$H/first.json" tool_input.content)" = "export const a = 1;" ] \
   && [ "$(json_get "$H/first.json" tool_input.file_path)" = "$CWD_NATIVE/web/src/new.ts" ]; then
  ok "an added file arrives as tool_name Write with file_path and its content"
else
  bad "Add payload is wrong: $(cat "$H/first.json")"
fi
if [ "$(json_get "$H/third.json" tool_name)" = "Edit" ] && [ "$(json_get "$H/third.json" tool_input.new_string)" = "" ]; then
  ok "a deleted file arrives as tool_name Edit with an empty new_string"
else
  bad "Delete payload is wrong: $(cat "$H/third.json")"
fi

echo "== adapter: nothing a patch touches can be hidden from a hook =="
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: ok/new.ts\n+fine\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qF 'guard: protected path' <<<"$ERR" && [ "$(runs SAW)" = "2" ]; then
  ok "a block on the SECOND file of a patch blocks the patch"
else
  bad "second-file block: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
# Codex's parser matches headers on the TRIMMED line; so must the adapter, or an
# indented header hides its hunk from every hook while Codex still applies it.
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: ok/new.ts\n+fine\n  *** Update File: protected/x.ts\n@@\n+evil\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "an INDENTED file header is still seen (matches Codex's own trim-then-match parser)"
else
  bad "an indented header hid a hunk: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
# "Trimmed" means RUST's trim, which is not JavaScript's. Codex is Rust: `line.trim()`
# strips the Unicode White_Space property, which includes U+0085 (NEL); JS trim()
# does not. With JS trim, a header behind a NEL was a header to Codex and plain
# text to every hook. (\u0085 below is a JSON escape, decoded by the adapter.)
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: ok/new.ts\n+fine\n\u0085*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "a header behind U+0085 (NEL) is still seen — whitespace is trimmed as Rust trims it, not as JavaScript does"
else
  bad "a NEL-prefixed header hid a hunk: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: ok/new.ts\n+fine\n\u3000\u00a0*** Delete File: protected/x.ts\u2028\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "…and behind/before other Unicode spaces (U+3000, U+00A0, U+2028)"
else
  bad "a Unicode-space-wrapped header hid a hunk: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null)"
fi
# The adapter's parser is a PORT of Codex's (parser.rs + streaming_parser.rs at
# rust-v0.144.1), not an approximation, because each approximation disagreed
# with Codex somewhere. The rows below are the disagreements, one per rule.
#
# 1. Codex's OWN fixture (keeps_indented_update_markers_as_context_lines): inside
#    an Update hunk headers are matched on trim_end() only, so an INDENTED header
#    there is a context line of the current file. Reading it as a header invented
#    a second file and handed the hooks the first file's added lines under it.
cat > "$H/newstring.sh" <<'NS'
#!/usr/bin/env bash
payload="$(cat)"
printf 'PATH=%s\n' "$TOOL_INPUT_file_path" >> "$PROBE_LOG"
printf '%s' "$payload" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const i=JSON.parse(s).tool_input;console.log("NEW="+JSON.stringify(i.new_string??i.content))})' >> "$PROBE_LOG"
NS
rm -f "$LOG"
PROBE_LOG="$LOG" adapt newstring.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: a.txt\n@@\n-old a\n+new a\n *** Update File: b.txt\n@@\n-old b\n+new b\n*** End Patch')"
if [ "$RC" -eq 0 ] && [ "$(runs PATH)" = "1" ] && grep -qxF "PATH=$CWD_NATIVE/a.txt" "$LOG" && grep -qxF 'NEW="new a\nnew b"' "$LOG"; then
  ok "Codex's own fixture: an indented header INSIDE an Update hunk is a context line — ONE file, a.txt, carrying both added lines"
else
  bad "the adapter disagrees with Codex on Codex's own fixture: exit $RC, saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
fi
# …while the LAST line ends the patch in any state (Codex's finish() trims it).
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\n   *** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "an indented FINAL '*** End Patch' still ends the patch (finish() trims the last line), so the hunk before it is seen"
else
  bad "an indented final End Patch lost the patch: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
fi

# The rest of the state machine, one row per rule, each asserted on the ADDED
# LINES the hook receives — a path alone cannot tell a rule that works from one
# that was deleted. Inputs are Codex's own fixtures where it has one.
#   @label | @patch (JSON-escaped) | expected NEW= value (JSON)
PORT_RULES=0
while IFS='|' read -r LABEL BODY WANT; do
  PORT_RULES=$((PORT_RULES + 1))
  rm -f "$LOG"
  PROBE_LOG="$LOG" adapt newstring.sh "$(patch_payload PreToolUse "$BODY")"
  if [ "$RC" -eq 0 ] && [ "$(runs PATH)" = "1" ] && grep -qxF "PATH=$CWD_NATIVE/docs/a.md" "$LOG" && grep -qxF "NEW=$WANT" "$LOG"; then
    ok "port rule: $LABEL"
  else
    bad "port rule broken ($LABEL): exit $RC, saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
  fi
done <<'PORT_RULES_TABLE'
lenient mode, the patch wrapped in <<'EOF' … EOF|<<'EOF'\n*** Begin Patch\n*** Update File: docs/a.md\n@@\n+w0\n*** End Patch\nEOF|"w0"
lenient mode, the unquoted <<EOF wrapper|<<EOF\n*** Begin Patch\n*** Update File: docs/a.md\n@@\n+w1\n*** End Patch\nEOF|"w1"
lenient mode, the double-quoted <<"EOF" wrapper|<<\"EOF\"\n*** Begin Patch\n*** Update File: docs/a.md\n@@\n+w2\n*** End Patch\nEOF|"w2"
an Environment ID preamble is accepted (environment_id_mode)|*** Begin Patch\n*** Environment ID: env-1\n*** Update File: docs/a.md\n@@\n+envd\n*** End Patch|"envd"
a bare EMPTY line inside an Update hunk is a context line (preserves_bare_empty_update_lines)|*** Begin Patch\n*** Update File: docs/a.md\n@@\n+before\n\n+after blank\n*** End Patch|"before\nafter blank"
*** End of File closes a chunk and the patch is still valid|*** Begin Patch\n*** Update File: docs/a.md\n@@\n-old\n+new tail\n*** End of File\n*** End Patch|"new tail"
a line that is exactly CR CR is an EMPTY context line — Codex strips a trailing CR twice|*** Begin Patch\n*** Update File: docs/a.md\n@@\n-old\n\r\r\n+new\n*** End Patch|"new"
a + line ending in CR CR carries no CR into the added content|*** Begin Patch\n*** Update File: docs/a.md\n@@\n+x\r\r\n*** End Patch|"x"
an Update hunk with no @@ at all (the first chunk is implicit)|*** Begin Patch\n*** Update File: docs/a.md\n+implicit\n*** End Patch|"implicit"
a BLANK line after *** End of File is ignored (ignores_empty_lines_after_end_of_file)|*** Begin Patch\n*** Update File: docs/a.md\n@@\n+quux\n*** End of File\n\n*** End Patch|"quux"
blank lines after an End Patch in the middle are accepted|*** Begin Patch\n*** Update File: docs/a.md\n@@\n+mid\n*** End Patch\n\n*** End Patch|"mid"
PORT_RULES_TABLE
if [ "$PORT_RULES" -eq 11 ]; then ok "all 11 port-rule rows were driven"; else bad "the port-rule table was not walked: $PORT_RULES of 11"; fi
# The double-CR case again with a MOVE: when the port rejected this patch, the
# old fallback showed the source path alone — the destination, the path a
# protect-this-directory hook most needs, was never shown.
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: docs/a.md\n*** Move to: protected/secret.ts\n@@\n-old\n\r\r\n+new\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/secret.ts" "$LOG"; then
  ok "a Move whose hunk holds a CR CR line is parsed, and its DESTINATION is shown"
else
  bad "double-CR Move: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
fi
# …and the rules by which Codex REJECTS a patch. On the tool channel a rejection
# is a block naming the error; each row is the error text the rule produces.
PORT_REJECTS=0
while IFS='|' read -r LABEL BODY WANT; do
  PORT_REJECTS=$((PORT_REJECTS + 1))
  rm -f "$LOG"
  adapt guard.sh "$(patch_payload PreToolUse "$BODY")"
  if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'does not parse the way Codex parses it' <<<"$ERR" && grep -qF "$WANT" <<<"$ERR"; then
    ok "port rejection: $LABEL"
  else
    bad "port rejection missing ($LABEL): exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
  fi
done <<'PORT_REJECTS_TABLE'
an Update hunk with nothing in it, followed by another header|*** Begin Patch\n*** Update File: docs/a.md\n*** Delete File: protected/x.ts\n*** End Patch|update file hunk for path 'docs/a.md' is empty
@@ directly after an empty chunk|*** Begin Patch\n*** Update File: protected/x.ts\n@@\n@@\n+evil\n*** End Patch|unexpected line found in update hunk
*** End of File on an empty chunk|*** Begin Patch\n*** Update File: protected/x.ts\n@@\n*** End of File\n*** End Patch|update hunk does not contain any lines
text after *** End Patch in the middle of the patch|*** Begin Patch\n*** Update File: docs/a.md\n@@\n+a\n*** End Patch\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch|the last line of the patch must be '*** End Patch'
a second Environment ID|*** Begin Patch\n*** Environment ID: a\n*** Environment ID: b\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch|environment id given more than once
a line after the End of File marker that is not @@|*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+a\n*** End of File\n+b\n*** End Patch|expected update hunk to start with a @@ context marker
a wrapper whose body does not START with Begin Patch|<<'EOF'\njunk\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF|the heredoc body does not start with *** Begin Patch
a wrapper whose body does not END with End Patch|<<'EOF'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\njunk\nEOF|the heredoc body does not start with *** Begin Patch
a wrapper with a mismatched quote|<<\"EOF'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF|the first line of the patch must be '*** Begin Patch'
an EMPTY Environment ID|*** Begin Patch\n*** Environment ID:   \n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch|environment id is empty
an Environment ID after a file header (Codex takes it only straight after Begin Patch)|*** Begin Patch\n*** Add File: protected/new.ts\n*** Environment ID: env-1\n+evil\n*** End Patch|is not a valid hunk header
an Environment ID inside an Update hunk|*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\n*** Environment ID: env-1\n*** End Patch|expected update hunk to start with a @@ context marker
PORT_REJECTS_TABLE
if [ "$PORT_REJECTS" -eq 12 ]; then ok "all 12 port-rejection rows were driven"; else bad "the port-rejection table was not walked: $PORT_REJECTS of 12"; fi
# An adapter-level block is not the verdict of whichever script is in argv: five
# handlers match apply_patch, and "check-vercel-json.sh: this patch does not
# parse" read as if that check had an opinion about it.
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n nothing\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -q '^run-claude-hook: this patch does not parse' <<<"$ERR" && ! grep -qF 'guard.sh' <<<"$ERR"; then
  ok "the parse-error block names the adapter, not the hook script that happened to be running"
else
  bad "the parse-error block is attributed to a hook script: $ERR"
fi

# An ABSOLUTE patch path is normalised like a relative one. Handed over verbatim,
# `<repo>/web/src/./lib/x.ts` matched no `*/web/src/lib/*` glob while the relative
# spelling of the same file did, and `docs/../protected/x.ts` walked past a guard.
for SPELLING in "$CWD_NATIVE/docs/../protected/x.ts" "$CWD_NATIVE/./protected/./x.ts" "docs/../protected/x.ts"; do
  rm -f "$LOG"
  adapt guard.sh "$(patch_payload PreToolUse "*** Begin Patch\n*** Delete File: ${SPELLING}\n*** End Patch")"
  if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
    ok "a path spelled ${SPELLING#"$CWD_NATIVE"/} is shown normalised, absolute or not"
  else
    bad "path not normalised (${SPELLING}): exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null)"
  fi
done

# 2. Every member of Rust's White_Space, in front of a header. A trim set missing
#    ANY of them is a header Codex sees and the hooks do not; five were pinned and
#    a mutant that dropped TAB passed.
WS_MEMBERS=0
for WS in '\t' '\u000b' '\u000c' ' ' '\u0085' '\u00a0' '\u1680' '\u2000' '\u2001' '\u2002' '\u2003' '\u2004' '\u2005' \
          '\u2006' '\u2007' '\u2008' '\u2009' '\u200a' '\u2028' '\u2029' '\u202f' '\u205f' '\u3000'; do
  WS_MEMBERS=$((WS_MEMBERS + 1))
  rm -f "$LOG"
  adapt guard.sh "$(patch_payload PreToolUse "*** Begin Patch\n*** Add File: ok/new.ts\n+fine\n${WS}*** Delete File: protected/x.ts${WS}\n*** End Patch")"
  if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
    ok "a header wrapped in White_Space member $WS is seen"
  else
    bad "White_Space member $WS hid a header: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null)"
  fi
done
if [ "$WS_MEMBERS" -eq 23 ]; then ok "all 23 White_Space members outside CR/LF were driven"; else bad "the White_Space loop ran $WS_MEMBERS of 23 times"; fi
# …and what Rust does NOT trim must not be trimmed either: U+FEFF and U+200B are
# not White_Space (JavaScript's trim() strips U+FEFF). Codex rejects such a patch.
for NOTWS in '\ufeff' '\u200b'; do
  rm -f "$LOG"
  adapt guard.sh "$(patch_payload PreToolUse "*** Begin Patch\n*** Add File: ok/new.ts\n+fine\n${NOTWS}*** Delete File: protected/x.ts\n*** End Patch")"
  if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'does not parse the way Codex parses it' <<<"$ERR" && grep -qF 'not a valid hunk header' <<<"$ERR"; then
    ok "$NOTWS is not White_Space: that line is no header to Codex, which REJECTS the patch — and so does the port, out loud"
  else
    bad "$NOTWS was trimmed as if it were White_Space, or the rejection was silent: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
  fi
done

# 3. A PATH may contain anything but a line feed. JavaScript's `.` stops at U+2028,
#    U+2029 and a lone CR, so a header whose path held one did not match at all.
for ODD in '\u2028' '\u2029' '\r'; do
  rm -f "$LOG"
  adapt probe.sh "$(patch_payload PreToolUse "*** Begin Patch\n*** Add File: docs/ok.md\n+fine\n*** Add File: docs/od${ODD}d.md\n+bad\n*** End Patch")"
  # Counting paths is not enough: a parser that BREAKS THE LINE at that character
  # still shows two — the second one cut short at `docs/od`. So the truncated path
  # must be absent, and the tail of the real one present.
  if [ "$RC" -eq 0 ] && [ "$(runs ENV)" = "2" ] && ! grep -qxF "ENV=$CWD_NATIVE/docs/od" "$LOG" && grep -q 'd\.md' "$LOG"; then
    ok "a header whose PATH contains $ODD is still a header — both files are shown, the second one whole"
  else
    bad "a path containing $ODD hid or truncated its file: exit $RC, saw: $(cat -v "$LOG" 2>/dev/null)"
  fi
done

# 4. `*** Move to:` — trim_end only, directly under its Update header, before any
#    chunk, once (streaming_parser.rs). First the POSITIVE half: trailing space IS
#    trimmed, so the hook must be shown the exact destination Codex writes. guard.sh's
#    containment glob cannot tell, so these use the exact ENV= line.
for TRAIL in '  ' '\u0085' '\t'; do
  rm -f "$LOG"
  adapt probe.sh "$(patch_payload PreToolUse "*** Begin Patch\n*** Update File: docs/a.md\n*** Move to: docs/moved.json${TRAIL}\n@@\n+z\n*** End Patch")"
  if [ "$RC" -eq 0 ] && grep -qxF "ENV=$CWD_NATIVE/docs/moved.json" "$LOG"; then
    ok "a Move destination followed by '$TRAIL' is shown trimmed, as Codex writes it"
  else
    bad "trailing '$TRAIL' stayed on a Move destination: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
  fi
done
rm -f "$LOG"
adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: docs/a.md\n *** Move to: protected/y.ts\n@@\n+z\n*** End Patch')"
if [ "$RC" -eq 0 ] && [ "$(runs ENV)" = "1" ] && grep -qxF "ENV=$CWD_NATIVE/docs/a.md" "$LOG"; then
  ok "an INDENTED '*** Move to:' is a context line, as in Codex (trim_end only) — one path, not two"
else
  bad "an indented Move line was treated as a move: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: docs/a.md\n@@\n+z\n*** Move to: protected/y.ts\n*** End Patch')"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'expected update hunk to start with a @@ context marker' <<<"$ERR"; then
  ok "a '*** Move to:' AFTER the first chunk line is not a move and not context either: Codex REJECTS the patch, and the port says so"
else
  bad "a late Move line: exit $RC (2 wanted, a rejection), saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
fi
rm -f "$LOG"
adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: docs/a.md\n*** Move to: docs/b.md\n*** Move to: protected/y.ts\n@@\n+z\n*** End Patch')"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'unexpected line found in update hunk' <<<"$ERR"; then
  ok "a SECOND '*** Move to:' is not a move: Codex REJECTS that patch, and the port says so"
else
  bad "a second Move line: exit $RC (2 wanted, a rejection), saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
fi
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Delete File: protected/x.ts\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "a delete-only patch is inspected — deleting a protected file is blocked"
else
  bad "delete-only patch was not inspected: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: protected/x.ts\n*** Move to: elsewhere/x.ts\n@@\n+moved\n*** End Patch')"
if [ "$RC" -eq 2 ]; then
  ok "the SOURCE of a move is inspected, not only its destination"
else
  bad "move source was not inspected: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: elsewhere/x.ts\n*** Move to: protected/x.ts\n@@\n+moved\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/elsewhere/x.ts" "$LOG"; then
  ok "the DESTINATION of a move is inspected too"
else
  bad "move destination was not inspected: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi

echo "== adapter: a fault must not read as a pass (Codex blocks ONLY on exit 2) =="
rm -f "$LOG"
adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n nothing recognisable\n*** End Patch')"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'does not parse the way Codex parses it' <<<"$ERR" && grep -qF 'not a valid hunk header' <<<"$ERR"; then
  ok "PreToolUse: a patch the parser port cannot parse BLOCKS (exit 2), naming the parse error"
else
  bad "unparseable patch on PreToolUse: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
# Codex puts the patch text in tool_input.command. The adapter used to fall back
# to two other field names nobody had observed; an unpinned guess is removed, and
# a payload without `command` is a fault rather than a different code path.
for FIELD in input patch; do
  rm -f "$LOG"
  adapt probe.sh "$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"%s":"*** Begin Patch\\n*** Add File: ok/new.ts\\n+x\\n*** End Patch"}}' "$CWD_NATIVE" "$FIELD")"
  if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'no patch text in tool_input.command' <<<"$ERR" && grep -qF 'core/src/tools/hook_names.rs' <<<"$ERR" && ! grep -qF 'probe.sh' <<<"$ERR"; then
    ok "a patch under tool_input.$FIELD (a shape Codex was never seen to send) BLOCKS instead of being guessed at — naming the adapter and the Codex file to re-read, not the hook"
  else
    bad "tool_input.$FIELD: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
  fi
done
rm -f "$LOG"
adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** End Patch')"
# Five handlers reach this for one patch: the text names the adapter, not the
# hook in argv, and gives the cause and the way out rather than "could not find".
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'this patch names no file' <<<"$ERR" && grep -qF 'Add a hunk, or drop the call' <<<"$ERR" && ! grep -qF 'probe.sh' <<<"$ERR"; then
  ok "PreToolUse: a VALID patch that touches no file BLOCKS too (exit 2) — nothing to check is not a pass; the text says why and what to do, and names no hook"
else
  bad "no-path patch on PreToolUse: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
adapt probe.sh "$(patch_payload PostToolUse '*** Begin Patch\n nothing recognisable\n*** End Patch')"
if [ "$RC" -eq 1 ]; then
  ok "PostToolUse: the same fault is a reported failure (exit 1) — the edit already happened, there is nothing to block"
else
  bad "no-path patch on PostToolUse: exit $RC"
fi
adapt probe.sh 'this is not json'
if [ "$RC" -eq 2 ] && grep -qF 'not JSON' <<<"$ERR"; then
  ok "an unreadable payload blocks: the event is unknown, so the gating one is assumed"
else
  bad "non-JSON payload: exit $RC, stderr: $ERR"
fi
adapt nope.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'
if [ "$RC" -eq 2 ] && grep -qF 'does not exist' <<<"$ERR" && grep -qF 'port.mjs --write' <<<"$ERR"; then
  ok "PreToolUse: a missing script blocks — a check that cannot run has not passed — and the message says how to repair it"
else
  bad "missing script on PreToolUse: exit $RC, $ERR"
fi
adapt nope.sh '{"hook_event_name":"Stop"}'
if [ "$RC" -eq 1 ]; then ok "Stop: a missing script is a reported failure, not a block"; else bad "missing script on Stop: exit $RC"; fi
# The target EXISTS (one level above the script dir), so only the name check can
# refuse it. With a nonexistent target the "missing script" branch would exit 2
# as well, and this case would pass with the name check deleted.
cp "$H/probe.sh" "$H/../escaped.sh"
rm -f "$LOG" "$LOG.stdin"
adapt ../escaped.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'expected a script name' <<<"$ERR"; then
  ok "a script name with a path in it is refused by the NAME check, and the script outside the directory never runs"
else
  bad "path-bearing script name: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi

adapt block.sh "$PAYLOAD"
if [ "$RC" -eq 2 ] && grep -qF 'blocked: policy says no' <<<"$ERR"; then
  ok "exit 2 and its stderr reason pass through (Codex blocks on exactly that pair)"
else
  bad "block passthrough: exit $RC, stderr: $ERR"
fi
adapt block-silent.sh "$PAYLOAD"
if [ "$RC" -eq 2 ] && [ -n "$ERR" ]; then
  ok "a script that exits 2 SILENTLY is given a reason — Codex ignores exit 2 with empty stderr"
else
  bad "silent exit 2: exit $RC, stderr: '$ERR'"
fi
# Parity with Claude Code, where a hook that crashes (exit 1) is reported and
# does not block. An ADAPTER fault is the different case asserted above.
adapt crash.sh "$PAYLOAD"
if [ "$RC" -eq 1 ] && grep -qF 'boom' <<<"$ERR"; then
  ok "a crashing SCRIPT is a reported failure with its stderr, as under Claude Code"
else
  bad "crash handling: exit $RC, stderr: $ERR"
fi

echo "== adapter: a crash on one path must not hide a block on another =="
# Under Claude Code each file is its own hook invocation, so a crash on file A
# never suppresses a block on file B. Exiting at the first crash did: Codex
# reports exit 1 as Failed and APPLIES THE WHOLE PATCH (second review board).
cat > "$H/crashy-guard.sh" <<'CG'
#!/usr/bin/env bash
printf 'SAW=%s\n' "${TOOL_INPUT_file_path:-<unset>}" >> "$PROBE_LOG"
case "${TOOL_INPUT_file_path:-}" in
  *crashy*) echo "kaboom" >&2; exit 7 ;;
  *protected*) echo "guard: protected path" >&2; exit 2 ;;
esac
exit 0
CG
rm -f "$LOG"
adapt crashy-guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: crashy/a.ts\n+x\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qF 'guard: protected path' <<<"$ERR" && [ "$(runs SAW)" = "2" ]; then
  ok "a crash on the FIRST path does not stop the SECOND being checked — the block still wins"
else
  bad "crash-then-block: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null) stderr: $ERR"
fi
rm -f "$LOG"
adapt crashy-guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: crashy/a.ts\n+x\n*** Add File: fine/b.ts\n+y\n*** Add File: fine/c.ts\n+z\n*** End Patch')"
if [ "$RC" -eq 1 ] && [ "$(runs SAW)" = "3" ] && grep -qF 'kaboom' <<<"$ERR" && grep -qF 'crashy/a.ts' <<<"$ERR"; then
  ok "with nothing to block, every path is still checked and the crash is then reported, naming the file"
else
  bad "crash-only: exit $RC (1 wanted), runs=$(runs SAW), stderr: $ERR"
fi

echo "== adapter: running out of time is a block, not a silent pass =="
# A hook's timeout in .claude/settings.json bounds ONE file. One Codex invocation
# covers a whole patch; when Codex's own timeout fires the run is merely Failed
# and the edit proceeds. So the adapter carries both numbers and must speak first.
printf '#!/usr/bin/env bash\nsleep 3\n' > "$H/slow.sh"
cat > "$H/steady.sh" <<'ST'
#!/usr/bin/env bash
printf 'SAW=%s\n' "${TOOL_INPUT_file_path:-<unset>}" >> "$PROBE_LOG"
sleep 1
ST
ADAPT_ARGS="1 30"
adapt slow.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: a.ts\n@@\n+x\n*** End Patch')"
if [ "$RC" -eq 2 ] && grep -qF 'timed out' <<<"$ERR" && grep -qF 'NOT checked' <<<"$ERR" && grep -qF '.claude/settings.json' <<<"$ERR" && grep -qF 'port.mjs --write' <<<"$ERR"; then
  ok "PreToolUse: a script that outruns its per-file timeout BLOCKS, saying the file was not checked"
else
  bad "per-file timeout: exit $RC (2 wanted), stderr: $ERR"
fi
rm -f "$LOG"
ADAPT_ARGS="10 3"
adapt steady.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: a.ts\n+1\n*** Add File: b.ts\n+2\n*** Add File: c.ts\n+3\n*** Add File: d.ts\n+4\n*** Add File: e.ts\n+5\n*** Add File: f.ts\n+6\n*** End Patch')"
CHECKED="$(runs SAW)"
if [ "$RC" -eq 2 ] && [ "$CHECKED" -ge 1 ] && [ "$CHECKED" -lt 6 ] && grep -qE 'out of time (after checking [0-9]+ of 6 paths|while checking path [0-9]+ of 6)' <<<"$ERR" && ! grep -qF 'settings.json' <<<"$ERR" && grep -qF 'budget 3s; stopping at 2.4s to report before' <<<"$ERR"; then
  ok "PreToolUse: a patch too large for the budget BLOCKS with paths unchecked ($CHECKED of 6 ran) — it does not pass on the ones it skipped"
else
  bad "budget exhaustion: exit $RC (2 wanted), $CHECKED of 6 ran, stderr: $ERR"
fi
# A budget that is ALREADY spent when the loop starts: the adapter must say so
# before starting a run it has no time for. (Without that guard the run is
# started with a negative timeout, which throws — an exit 2 by accident.)
rm -f "$LOG"
ADAPT_ARGS="5 0.001"
adapt steady.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: a.ts\n+1\n*** End Patch')"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'out of time after checking 0 of 1 paths' <<<"$ERR"; then
  ok "a budget already spent BLOCKS before any run starts, saying that nothing was checked"
else
  bad "spent budget: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
ADAPT_ARGS="10 3"
adapt steady.sh "$(patch_payload PostToolUse '*** Begin Patch\n*** Add File: a.ts\n+1\n*** Add File: b.ts\n+2\n*** Add File: c.ts\n+3\n*** Add File: d.ts\n+4\n*** Add File: e.ts\n+5\n*** Add File: f.ts\n+6\n*** End Patch')"
if [ "$RC" -eq 1 ]; then
  ok "PostToolUse: the same exhaustion is a reported failure — the edit has already happened"
else
  bad "budget exhaustion on PostToolUse: exit $RC (1 wanted)"
fi
ADAPT_ARGS=""
rm -f "$LOG"
adapt steady.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Add File: a.ts\n+1\n*** End Patch')"
if [ "$RC" -eq 0 ] && [ "$(runs SAW)" = "1" ]; then
  ok "with no numbers given the adapter imposes no bound of its own (Codex's still applies)"
else
  bad "unbounded run: exit $RC, runs=$(runs SAW)"
fi

echo "== adapter: it runs however the checkout is reached =="
# An "only when executed directly" guard compared process.argv[1] with the
# module path. Node realpaths the entry module but not argv[1], so through a
# junction or a symlinked checkout they differed, main() never ran, and the
# process exited 0 with no output: every hook passed. Reach the adapter through
# a link and demand the same answer as through its real path.
LINKED="$TMP_ROOT/linked-codex-hooks"
ADAPTER_DIR="$(dirname "$ADAPTER")"
if ! ln -s "$ADAPTER_DIR" "$LINKED" 2>/dev/null || [ ! -L "$LINKED" ]; then
  rm -rf "$LINKED"
  # Git Bash cannot make a symlink without the privilege; a directory junction
  # needs none and is the form this bug was reproduced through.
  cmd //c mklink //J "$(cygpath -w "$LINKED")" "$(cygpath -w "$ADAPTER_DIR")" >/dev/null 2>&1 || true
fi
if [ -f "$LINKED/run-claude-hook.mjs" ]; then
  REAL_ADAPTER="$ADAPTER"; ADAPTER="$LINKED/run-claude-hook.mjs"
  rm -f "$LOG"
  adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n nothing recognisable\n*** End Patch')"
  VIA_LINK_FAULT="$RC"
  adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch')"
  VIA_LINK_BLOCK="$RC"
  ADAPTER="$REAL_ADAPTER"
  if [ "$VIA_LINK_FAULT" -eq 2 ] && [ "$VIA_LINK_BLOCK" -eq 2 ]; then
    ok "reached through a link, the adapter still RUNS: a fault blocks and a guard blocks (it used to exit 0, silently)"
  else
    bad "through a link the adapter answered fault=$VIA_LINK_FAULT block=$VIA_LINK_BLOCK (2 and 2 wanted) — main() did not run"
  fi
else
  bad "could not create a symlink or a junction to the adapter directory — the entry-guard case did not run"
fi

echo "== adapter: an empty payload is a fault, not a free pass =="
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh ''
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'hook payload is empty' <<<"$ERR"; then
  ok "an EMPTY payload blocks: the event is unknown, so the gating one is assumed, and the script does not run on nothing"
else
  bad "empty payload: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
# Pinned on the message: with the guard gone these still exit 2, but through a
# LATER guard ("names no hook_event_name") or the top-level catch — the right exit
# code from the wrong guard.
for NOT_OBJECT in '[1,2,3]' 'null' '"text"' '7'; do
  adapt probe.sh "$NOT_OBJECT"
  if [ "$RC" -eq 2 ] && grep -qF 'hook payload is not a JSON object' <<<"$ERR"; then
    ok "a payload that is JSON but not an object ($NOT_OBJECT) blocks, and says so"
  else
    bad "non-object payload $NOT_OBJECT: exit $RC (2 wanted), stderr: $ERR"
  fi
done
# An OBJECT with no event name. Without the name nothing can tell a gating event
# from an advisory one, so every later fault would exit 1 and the action proceed.
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh '{}'
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'hook_event_name' <<<"$ERR"; then
  ok "an object payload with NO hook_event_name blocks, and the script does not run on it"
else
  bad "payload without an event: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
adapt probe.sh '{"tool_name":"apply_patch","tool_input":{"command":"garbage"}}'
if [ "$RC" -eq 2 ]; then ok "…so a no-path patch with no event name blocks too (it used to exit 1 and proceed)"; else bad "no-event no-path patch: exit $RC (2 wanted)"; fi
adapt probe.sh '{"hook_event_name":42,"tool_name":"Bash","tool_input":{"command":"ls"}}'
if [ "$RC" -eq 2 ]; then ok "a non-string hook_event_name is no name at all"; else bad "numeric event name: exit $RC (2 wanted)"; fi

echo "== adapter: systemMessage and the command convenience variable =="
# A script that prints NOTHING must produce no output at all. On Stop plain text
# becomes a systemMessage, so treating "" as text would emit {"systemMessage":""}.
printf '#!/usr/bin/env bash\nexit 0\n' > "$H/silent.sh"
adapt silent.sh '{"hook_event_name":"Stop"}'
if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then
  ok "a silent script on Stop produces no output — not an empty systemMessage"
else
  bad "a silent script produced output: exit $RC, stdout: $OUT"
fi
cat > "$H/sysmsg.sh" <<'SM'
#!/usr/bin/env bash
printf '%s' '{"systemMessage":"lockfile was re-synced"}'
SM
adapt sysmsg.sh '{"hook_event_name":"Stop"}'
if [ "$(out_get systemMessage)" = "lockfile was re-synced" ] && [ "$(out_get @has:hookSpecificOutput)" = "false" ]; then
  ok "systemMessage passes through, on an event that accepts nothing else"
else
  bad "systemMessage was lost or wrapped: $OUT"
fi
adapt sysmsg.sh "$PAYLOAD"
if [ "$(out_get systemMessage)" = "$(printf 'lockfile was re-synced\nlockfile was re-synced\nlockfile was re-synced')" ]; then
  ok "systemMessage from each per-file run is kept"
else
  bad "systemMessage merge is wrong: $OUT"
fi
cat > "$H/cmdenv.sh" <<'CE'
#!/usr/bin/env bash
printf 'CMDENV=%s\n' "${TOOL_INPUT_command-<unset>}" >> "$PROBE_LOG"
CE
rm -f "$LOG"
adapt cmdenv.sh "$(bash_payload PreToolUse 'git status')"
if grep -qxF 'CMDENV=git status' "$LOG"; then
  ok "TOOL_INPUT_command is set for a Bash payload (hook-utils.sh falls back to it)"
else
  bad "TOOL_INPUT_command missing: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
BIG="$(node -e 'process.stdout.write("x".repeat(40000))')"
adapt cmdenv.sh "$(bash_payload PreToolUse "$BIG")"
if [ "$RC" -eq 0 ] && grep -qxF 'CMDENV=<unset>' "$LOG"; then
  ok "a command too large for an environment string is OMITTED from the variable, and the script still runs (E2BIG would otherwise be a non-blocking failure)"
else
  bad "large command: exit $RC, log: $(cut -c1-60 "$LOG" 2>/dev/null)"
fi

echo "== adapter: Codex's SECOND edit channel — a patch carried in a shell command =="
# Codex's exec tool reports a shell command to hooks as tool `Bash`, and only
# AFTER the PreToolUse hooks have run does it decide whether the command is a
# patch and apply it as one (it intercepts `apply_patch <<'EOF' … EOF` and
# `cd <path> && apply_patch <<'EOF' … EOF`; apply-patch/src/invocation.rs).
# Mode `edit` does NOT try to recognise those shapes. It asks the PATCH: a command
# whose text has a `*** Add|Update|Delete File:` line either has every such path
# inspected or is blocked; a command with none is ordinary. See carriedPatch().
carried_payload() { printf '{"cwd":"%s","hook_event_name":"%s","tool_name":"Bash","tool_input":{"command":"%s"}}' "$CWD_NATIVE" "$1" "$2"; }
# heredoc <prefix> <patch-body-with-\n-escapes> — the plain heredoc form, behind an optional prefix.
heredoc() { printf '%s' "${1}apply_patch <<'EOF'\n*** Begin Patch\n${2}\n*** End Patch\nEOF"; }
# Files the patches below UPDATE must exist: an update of a file that is not
# there is how the adapter detects a base directory it cannot see.
mkdir -p "$TMP_ROOT/protected" "$TMP_ROOT/docs" "$TMP_ROOT/web/src/lib"
: > "$TMP_ROOT/protected/x.ts"; : > "$TMP_ROOT/docs/a.md"; : > "$TMP_ROOT/web/src/lib/x.ts"; : > "$TMP_ROOT/web/vercel.json"
ADAPT_ARGS="5 50 edit"

rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: protected/x.ts\n@@\n+evil')")"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "a patch carried in a shell command is checked path by path, like one sent through the patch tool"
else
  bad "carried patch was not inspected: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null) stderr: $ERR"
fi

# `cd <path> &&` moves the base the hunk paths resolve against, in Codex and here.
# Ignoring it handed the scripts <root>/src/lib/x.ts for an edit to web/src/lib/x.ts,
# which no `*/web/src/lib/*` glob matches — so the check skipped the file.
rm -f "$LOG"
adapt probe.sh "$(carried_payload PreToolUse "$(heredoc 'cd web && ' '*** Update File: src/lib/x.ts\n@@\n+y')")"
if [ "$RC" -eq 0 ] && grep -qxF "ENV=$CWD_NATIVE/web/src/lib/x.ts" "$LOG"; then
  ok "\`cd web && apply_patch\`: paths resolve under web/, the directory Codex applies them in"
else
  bad "cd prefix ignored: exit $RC, saw: $(cat "$LOG" 2>/dev/null) stderr: $ERR"
fi
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc "cd 'protected' && " '*** Update File: x.ts\n@@\n+evil')")"
if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
  ok "…so a guard on a directory still fires when the patch reaches it through cd (quoted path)"
else
  bad "cd into a protected directory was not seen: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi

# THE SHELL IS NOT READ. Codex hands hooks a shell command BEFORE deciding whether
# it is a patch; what it does not intercept goes to a real shell in which
# `apply_patch` is a real executable on PATH. Five attempts to read the shell text
# each failed open somewhere (an identifier-only delimiter, a continuation, an
# earlier `<<` hiding a cd, `env -C`, a decoy heredoc, an unquoted delimiter
# letting `$(…)` rewrite a path). So a command with a line that looks like a file
# header has exactly TWO outcomes — ACCEPTED as the whole-command form, or REFUSED
# unparsed — and "exit 0, script not run" is the one result no row may produce.
# Rows are JSON-escaped text: `\\` is one backslash, `\n` a newline. @P@ is the
# patch (it updates protected/x.ts, which guard.sh blocks).
PATCH='*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch'
SHAPES=0
while IFS='|' read -r LABEL CMD; do
  SHAPES=$((SHAPES + 1))
  rm -f "$LOG"
  adapt guard.sh "$(carried_payload PreToolUse "${CMD//@P@/$PATCH}")"
  if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
    ok "accepted and inspected: $LABEL"
  else
    bad "an accepted form went unchecked ($LABEL): exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
  fi
done <<'SHAPES_TABLE'
the plain form (control)|apply_patch <<'EOF'\n@P@\nEOF
a hyphenated delimiter|apply_patch <<'END-PATCH'\n@P@\nEND-PATCH
a delimiter that starts with a digit|apply_patch <<'1EOF'\n@P@\n1EOF
a dotted delimiter|apply_patch <<'PATCH.END'\n@P@\nPATCH.END
a delimiter with a space in it|apply_patch <<'END PATCH'\n@P@\nEND PATCH
a double-quoted delimiter|apply_patch <<\"EOF\"\n@P@\nEOF
no space before the redirect, one after it|apply_patch<< 'EOF'\n@P@\nEOF
the applypatch alias|applypatch <<'EOF'\n@P@\nEOF
a line continuation before the heredoc|apply_patch \\\n<<'EOF'\n@P@\nEOF
a line continuation with no space before it|apply_patch\\\n<<'EOF'\n@P@\nEOF
CRLF line endings in the patch BODY, as a patch for a CRLF file has (on the opening or closing line they are refused — two bashes read them differently)|apply_patch <<'EOF'\n*** Begin Patch\r\n*** Update File: protected/x.ts\r\n@@\r\n+evil\r\n*** End Patch\r\nEOF
blank lines after the closing delimiter|apply_patch <<'EOF'\n@P@\nEOF\n\n
an indented file header after Begin Patch (Codex trims there)|apply_patch <<'EOF'\n*** Begin Patch\n   *** Update File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF
a NEL-prefixed file header (Rust trims it)|apply_patch <<'EOF'\n*** Begin Patch\n\u0085*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF
an INDENTED final End Patch inside an Update hunk (finish() trims the last line; here a parse failure would be a refusal)|apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+evil\n   *** End Patch\nEOF
SHAPES_TABLE
# The loop must have walked its table, or 15 shapes read as zero problems.
if [ "$SHAPES" -eq 15 ]; then ok "all 15 accepted shapes were driven"; else bad "the accepted table was not walked: $SHAPES of 15"; fi

# `cd <literal path> &&` is the one directory change accepted. @PX@ updates x.ts
# RELATIVE to the cd, i.e. protected/x.ts.
PATCH_X='*** Begin Patch\n*** Update File: x.ts\n@@\n+evil\n*** End Patch'
FOLLOWED=0
while IFS='|' read -r LABEL CMD; do
  FOLLOWED=$((FOLLOWED + 1))
  rm -f "$LOG"
  adapt guard.sh "$(carried_payload PreToolUse "${CMD//@PX@/$PATCH_X}")"
  if [ "$RC" -eq 2 ] && grep -qxF "SAW=$CWD_NATIVE/protected/x.ts" "$LOG"; then
    ok "cd followed: $LABEL"
  else
    bad "cd not followed ($LABEL): exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null), stderr: $ERR"
  fi
done <<'FOLLOWED_TABLE'
a bare literal path|cd protected && apply_patch <<'EOF'\n@PX@\nEOF
a bare path with a dot segment|cd ./protected && apply_patch <<'EOF'\n@PX@\nEOF
a double-quoted literal path|cd \"protected\" && apply_patch <<'EOF'\n@PX@\nEOF
a single-quoted path|cd 'protected' && apply_patch <<'EOF'\n@PX@\nEOF
tabs as separators|cd\tprotected\t&&\tapply_patch\t<<'EOF'\n@PX@\nEOF
a continuation before the &&|cd protected \\\n&& apply_patch <<'EOF'\n@PX@\nEOF
a continuation after the &&|cd protected && \\\napply_patch <<'EOF'\n@PX@\nEOF
FOLLOWED_TABLE
if [ "$FOLLOWED" -eq 7 ]; then ok "all 7 followable cd forms were driven"; else bad "the followed-cd table was not walked: $FOLLOWED of 7"; fi

# EVERYTHING ELSE that is patch-bearing is REFUSED, unparsed — so nothing in it
# can mislead. @PA@ ADDS protected/new.ts relative to the cd: an Add can never be
# caught by the does-not-exist check, so for these rows the refusal is the ONLY
# thing between a wrong base and an exit 0.
PATCH_A='*** Begin Patch\n*** Add File: new.ts\n+evil\n*** End Patch'
REFUSED=0
while IFS='|' read -r LABEL CMD; do
  REFUSED=$((REFUSED + 1))
  rm -f "$LOG"
  CMD="${CMD//@PX@/$PATCH_X}"; CMD="${CMD//@PA@/$PATCH_A}"
  adapt guard.sh "$(carried_payload PreToolUse "${CMD//@P@/$PATCH}")"
  if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'cannot be located or checked' <<<"$ERR" \
     && grep -qF 'apply_patch tool' <<<"$ERR" && grep -qF 'only WRITES text' <<<"$ERR"; then
    ok "REFUSED, with both ways out: $LABEL"
  else
    bad "a patch-bearing command outside the accepted form did not block ($LABEL): exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
  fi
done <<'REFUSED_TABLE'
an UNQUOTED delimiter — the shell would expand the body|apply_patch <<EOF\n@P@\nEOF
an unquoted delimiter rewriting the path with a command substitution|apply_patch <<EOF ; true\n*** Begin Patch\n*** Add File: $(printf web/src/app/api/evil/route.ts)\n+x\n*** End Patch\nEOF
a backslash-escaped delimiter|apply_patch <<\\EOF\n@P@\nEOF
<<- with a tab-indented closing line|apply_patch <<-'EOF'\n@P@\n\tEOF
a second redirect after the heredoc|apply_patch <<'EOF' > out.txt\n@P@\nEOF
a statement joined on the heredoc line|apply_patch <<'EOF' ; true\n@P@\nEOF
a statement after the closing line|apply_patch <<'EOF'\n@P@\nEOF\necho done
a DECOY heredoc first, the real cd and patch after it|apply_patch <<'X'\n*** junk\nX\ncd protected && apply_patch <<'EOF'\n@PA@\nEOF
a heredoc that is never closed|apply_patch <<'EOF'\n@P@
a closing line indented with spaces|apply_patch <<'EOF'\n@P@\n  EOF
an unquoted delimiter that is the word cd|apply_patch << cd\n@P@\ncd
a variable assignment before it|FOO=1 apply_patch <<'EOF'\n@P@\nEOF
an assignment whose value has a space|FOO=\"a b\" apply_patch <<'EOF'\n@P@\nEOF
an assignment from a command substitution|FOO=$(echo a b) apply_patch <<'EOF'\n@P@\nEOF
a redirect before the command name|2>/dev/null apply_patch <<'EOF'\n@P@\nEOF
a comment line before it|# note\napply_patch <<'EOF'\n@P@\nEOF
an argument before the heredoc|apply_patch --x <<'EOF'\n@P@\nEOF
a statement before it|echo start; apply_patch <<'EOF'\n@P@\nEOF
the patch as a quoted argument, no heredoc|apply_patch '@P@'
the command name obfuscated|a\\pply_patch <<'EOF'\n@P@\nEOF
a lookalike script name|./apply_patch.sh <<'EOF'\n@P@\nEOF
a longer identifier|apply_patch_helper <<'EOF'\n@P@\nEOF
a bare cd path with a variable|cd $HOME/protected && apply_patch <<'EOF'\n@PA@\nEOF
a DOUBLE-quoted cd path with a variable|cd \"$HOME/protected\" && apply_patch <<'EOF'\n@PA@\nEOF
a double-quoted cd path with a command substitution|cd \"`pwd`/protected\" && apply_patch <<'EOF'\n@PA@\nEOF
a double-quoted cd path with a backslash|cd \"pro\\tected\" && apply_patch <<'EOF'\n@PA@\nEOF
a bare cd path with an escaped space|cd pro\\ tected && apply_patch <<'EOF'\n@PA@\nEOF
a bare cd path with a * glob|cd prot* && apply_patch <<'EOF'\n@PA@\nEOF
a bare cd path with a ? glob|cd prot?cted && apply_patch <<'EOF'\n@PA@\nEOF
a bare cd path with a [] glob|cd [p]rotected && apply_patch <<'EOF'\n@PA@\nEOF
a bare cd path with a {} expansion|cd {protected,docs} && apply_patch <<'EOF'\n@PA@\nEOF
a tilde cd path|cd ~/protected && apply_patch <<'EOF'\n@PA@\nEOF
cd - (the previous directory)|cd - && apply_patch <<'EOF'\n@PA@\nEOF
a quoted cd - |cd '-' && apply_patch <<'EOF'\n@PA@\nEOF
an empty cd target|cd '' && apply_patch <<'EOF'\n@PA@\nEOF
a NEWLINE between cd and its target (three commands to the shell)|cd\ntrue && apply_patch <<'EOF'\n@PA@\nEOF
a no-break space after the cd target (part of the name, to bash)|cd protected\u00a0&& apply_patch <<'EOF'\n@PA@\nEOF
cd joined with a semicolon|cd protected; apply_patch <<'EOF'\n@PA@\nEOF
cd on its own line|cd protected\napply_patch <<'EOF'\n@PA@\nEOF
two cds|cd . && cd protected && apply_patch <<'EOF'\n@PA@\nEOF
a subshell|(cd protected && apply_patch <<'EOF'\n@PA@\nEOF\n)
pushd|pushd protected && apply_patch <<'EOF'\n@PA@\nEOF
an EARLIER here-string hiding the cd|read v <<< hi; cd protected && apply_patch <<'EOF'\n@PA@\nEOF
an earlier arithmetic << hiding the cd|echo $((1<<2)); cd protected; apply_patch <<'EOF'\n@PA@\nEOF
an earlier heredoc hiding the cd|cat <<X\nhello\nX\ncd protected && apply_patch <<'EOF'\n@PA@\nEOF
a backslash-escaped cd|\\cd protected && apply_patch <<'EOF'\n@PA@\nEOF
a quoted cd|\"cd\" protected && apply_patch <<'EOF'\n@PA@\nEOF
env -C|env -C protected apply_patch <<'EOF'\n@PA@\nEOF
eval of a split cd|eval \"c\"\"d protected\" && apply_patch <<'EOF'\n@PA@\nEOF
cd through a variable|d=cd; $d protected && apply_patch <<'EOF'\n@PA@\nEOF
bash -c with the cd inside the string|bash -c 'cd protected; apply_patch' <<'EOF'\n@PA@\nEOF
a backslash-CR-LF before the heredoc (to POSIX bash the backslash quotes the CR: it is NOT a continuation)|apply_patch \\\r\n<<'EOF'\n@P@\nEOF
a cd target split by a continuation whose halves spell a word already in the head (the old check looked for the joined text ANYWHERE)|cd c\\\nd && apply_patch <<'EOF'\n@PA@\nEOF
a cd target split so that it spells the command name|cd apply_\\\npatch && apply_patch <<'EOF'\n@PA@\nEOF
a cd target split by backslash-CR-LF|cd apply_\\\r\npatch && apply_patch <<'EOF'\n@PA@\nEOF
a command name split by a continuation|apply_\\\npatch <<'EOF'\n@P@\nEOF
a second heredoc on the opening line|apply_patch <<'A' <<'EOF'\n@P@\nEOF\nA
a line continuation INSIDE a single-quoted cd target (two literal bytes to bash; joining made it a different directory)|cd 'prot\\\nected' && apply_patch <<'EOF'\n@PA@\nEOF
a line continuation inside a bare cd target|cd prot\\\nected && apply_patch <<'EOF'\n@PA@\nEOF
a body Codex rejects: an Update hunk with nothing in it|apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: protected/x.ts\n*** Delete File: docs/a.md\n*** End Patch\nEOF
a body Codex rejects: @@ directly after an empty chunk|apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n@@\n+evil\n*** End Patch\nEOF
a body Codex's parser rejects (a stray line in an Add hunk)|apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: protected/new.ts\n+ok\nstray\n*** End Patch\nEOF
a body Codex rejects in finish(): an indented final End Patch straight after @@ leaves an EMPTY chunk (a parser that streams the last line would read it as context and accept)|apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n   *** End Patch\nEOF
a delimiter ENDING in a carriage return — bash closes on the first EOF<CR>, this file once read on to EOF<CR><CR>, and the lines between were shell to one and patch body to the other|apply_patch <<'EOF\r'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n ok\nEOF\r\n apply_patch <<'X'\n+hidden\nEOF\r\r
the same with a double-quoted delimiter|apply_patch <<\"EOF\r\"\n@P@\nEOF\r
a carriage return after the delimiter on the opening line (to bash on Linux the delimiter is then EOF<CR>)|apply_patch <<'EOF'\r\n@P@\nEOF
a whole command with CRLF line endings|apply_patch <<'EOF'\r\n@P@\r\nEOF\r\n
a closing line ending in a carriage return (Git for Windows' bash closes there, bash on Linux does not)|apply_patch <<'EOF'\n@P@\nEOF\r\n
a carriage return in the MIDDLE of a path — Git for Windows' bash deletes it wherever it stands, so the hooks were shown a path no glob matched while bash handed apply_patch the real one|apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: prot\rected/new.ts\n+evil\n*** End Patch\nEOF
a carriage return inside the MARKER, which hides the header from the entry gate while bash hands apply_patch a valid one — read in the raw text alone this command is not refused but IGNORED, exit 0 with no hook run|apply_patch <<'EOF'\n*** Begin Patch\n*** Ad\rd File: protected/new.ts\n+evil\n*** End Patch\nEOF
a carriage return between the marker and its colon|apply_patch <<'EOF'\n*** Begin Patch\n*** Add File\r: protected/new.ts\n+evil\n*** End Patch\nEOF
a carriage return inside a Delete marker|apply_patch <<'EOF'\n*** Begin Patch\n*** Dele\rte File: docs/a.md\n*** End Patch\nEOF
a carriage return inside an Update marker|apply_patch <<'EOF'\n*** Begin Patch\n*** Upda\rte File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF
a carriage return in the middle of an added line|apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: protected/new.ts\n+ev\ril\n*** End Patch\nEOF
a carriage return inside the quoted cd target|cd 'prot\rected' && apply_patch <<'EOF'\n@PA@\nEOF
a no-break space after the closing line — blank to JavaScript's trim(), a second command to bash|apply_patch <<'EOF'\n@P@\nEOF\n\u00a0
a form feed and a vertical tab after the closing line|apply_patch <<'EOF'\n@P@\nEOF\n\f\u000b
a delimiter that is also a valid context line, met first with a carriage return and then byte-exact — read the Linux way alone the body parses, while Git for Windows' bash closes on the first and runs the rest as shell|apply_patch <<' ok'\n*** Begin Patch\n*** Update File: protected/x.ts\n@@\n+a\n ok\r\n+b\n*** End Patch\n ok
COST — a heredoc that only WRITES a patch file|cat > fix.patch <<'EOF'\n@P@\nEOF
COST — a how-to that quotes a patch|cd docs && cat > howto.md <<'DOC'\nUse apply_patch like this:\n@P@\nDOC
COST — a multi-line commit message that quotes one|git commit -m \"fix: apply_patch handling\n\n@P@\"
REFUSED_TABLE
if [ "$REFUSED" -eq 81 ]; then ok "all 81 refused shapes were driven"; else bad "the refused table was not walked: $REFUSED of 81"; fi

# The way out must fit the CAUSE. One remedy for everything told the author of a
# body that would not parse to "make it the WHOLE command" — which it already was.
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: protected/new.ts\n+ok\nstray\n*** End Patch\nEOF")"
if [ "$RC" -eq 2 ] && grep -qF 'correct the patch text' <<<"$ERR" && ! grep -qF 'make it the WHOLE command' <<<"$ERR" && ! grep -qF 'or send it through the apply_patch tool' <<<"$ERR"; then
  ok "refusal for a body that does not parse: says to correct the patch, not to reshape a command that is already the right shape"
else
  bad "body-parse refusal gives the wrong way out: exit $RC, stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "cd - && apply_patch <<'EOF'\n$PATCH_A\nEOF")"
if [ "$RC" -eq 2 ] && grep -qF 'cd to a literal directory' <<<"$ERR" && ! grep -qF 'make it the WHOLE command' <<<"$ERR"; then
  ok "refusal for a cd target of '-': says what to do about the cd"
else
  bad "cd-target refusal gives the wrong way out: exit $RC, stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF' > out.txt\n$PATCH\nEOF")"
if [ "$RC" -eq 2 ] && grep -qF 'something follows the heredoc delimiter on its opening line' <<<"$ERR" && grep -qF 'put nothing after the quoted delimiter' <<<"$ERR" && ! grep -qF 'not a plain QUOTED word' <<<"$ERR"; then
  ok "refusal for text AFTER a quoted delimiter: names that, and does not tell the author to quote a delimiter that is already quoted"
else
  bad "opening-line refusal names the wrong cause: exit $RC, stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "apply_patch '$PATCH'")"
if [ "$RC" -eq 2 ] && grep -qF 'but it has no heredoc' <<<"$ERR"; then
  ok "refusal for a patch passed as an ARGUMENT: says there is no heredoc"
else
  bad "no-heredoc refusal names the wrong cause: exit $RC, stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\n$PATCH")"
if [ "$RC" -eq 2 ] && grep -qF 'its heredoc is never closed by a line reading exactly EOF' <<<"$ERR"; then
  ok "refusal for a heredoc that is never CLOSED: says so, naming the delimiter"
else
  bad "unclosed-heredoc refusal names the wrong cause: exit $RC, stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<EOF\n$PATCH\nEOF")"
if [ "$RC" -eq 2 ] && grep -qF 'not a plain QUOTED word' <<<"$ERR" && grep -qF 'quote the delimiter' <<<"$ERR"; then
  ok "refusal for an UNQUOTED delimiter: says to quote it"
else
  bad "unquoted-delimiter refusal: exit $RC, stderr: $ERR"
fi
# A carriage return where two bashes read it differently. Each cause has its own
# guard, so each is pinned on the words only that guard prints.
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\r\n$PATCH\nEOF")"
if [ "$RC" -eq 2 ] && grep -qF 'the line that opens its heredoc contains a carriage return' <<<"$ERR" && grep -qF 'LF line endings' <<<"$ERR" && ! grep -qF 'make it the WHOLE command' <<<"$ERR"; then
  ok "refusal for a carriage return on the OPENING line: names it, and says to use LF line endings"
else
  bad "opening-line carriage return names the wrong cause: exit $RC, stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\n$PATCH\nEOF\r\n")"
if [ "$RC" -eq 2 ] && grep -qF 'the line that would close its heredoc (EOF) ends in a carriage return' <<<"$ERR" && grep -qF 'LF line endings' <<<"$ERR"; then
  ok "refusal for a carriage return on the CLOSING line: names it, and says to use LF line endings"
else
  bad "closing-line carriage return names the wrong cause: exit $RC, stderr: $ERR"
fi
# The entry gate is asked in the view the WIDEST applier uses: the text with every
# carriage return deleted, which is what Git for Windows' bash runs. A CR inside the
# MARKER hides the header from the RAW text, so gating on that gave a silent THIRD
# outcome — not ACCEPTED, not REFUSED, but IGNORED: exit 0, no hook run, and that
# bash then handed apply_patch a valid header. (Deleting carriage returns can only
# CREATE a header, never destroy one, so this one view covers the raw one too.)
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\n*** Begin Patch\n*** Ad\rd File: protected/new.ts\n+evil\n*** End Patch\nEOF")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'a carriage return that does not end a line' <<<"$ERR"; then
  ok "a carriage return inside the MARKER is REFUSED, not ignored — the gate is asked in the CR-deleted view"
else
  bad "a CR inside the marker was not refused (exit $RC, 2 wanted; ran=$([ -e "$LOG" ] && echo yes || echo no)) — the adapter and Git for Windows' bash disagree about whether this is a patch: $ERR"
fi
# …and the widened gate must not make an ordinary command patch-bearing. A CR that
# spells no marker in EITHER view is nothing to a file hook.
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "printf 'a\rb' && grep -c 'Add File' notes.txt")"
if [ "$RC" -eq 0 ] && [ ! -e "$LOG" ]; then
  ok "…and a command with a carriage return but no header in EITHER view is still an ordinary command (exit 0)"
else
  bad "the CR-deleted view turned an ordinary command into a patch: exit $RC (0 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: ok/ne\rw.ts\n+x\n*** End Patch\nEOF")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'a carriage return that does not end a line' <<<"$ERR" && grep -qF 'LF line endings' <<<"$ERR"; then
  ok "refusal for a carriage return in the MIDDLE of a line: names it (Git for Windows' bash deletes it, bash on Linux keeps it)"
else
  bad "mid-line carriage return names the wrong cause: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
adapt guard.sh "$(carried_payload PreToolUse "apply_patch <<'EOF'\n$PATCH\nEOF\n\f")"
if [ "$RC" -eq 2 ] && grep -qF 'only spaces, tabs and newlines may' <<<"$ERR"; then
  ok "refusal for a form feed after the closing line: blank is bash's idea of blank, not JavaScript's"
else
  bad "a form feed after the closing line: exit $RC, stderr: $ERR"
fi
# (…and only there: the accepted table above carries a patch with a CRLF body.)
#
# REPORTING ONLY — two `note` lines, which can neither pass nor fail. The refusals
# above rest on a claim about BASH, not about the adapter: that two bashes read a
# carriage return differently. This prints what the bash running the suite does
# (through `-c`, the way Codex hands a command over), so the claim in the adapter
# and in the support matrix can be held against a CI log from each platform
# rather than taken on trust (lessons-learned #17). "body AFTER" means the
# heredoc closed on the line in question; anything longer means it did not.
CR_OPEN_CMD="$(printf "cat <<'EOF'\r\nbody\nEOF\necho AFTER")"
CR_CLOSE_CMD="$(printf "cat <<'EOF'\nbody\nEOF\r\necho AFTER\nEOF")"
echo "  note  $(uname -s) bash, heredoc opened as <<'EOF'<CR> and met by a bare EOF line: $(bash -c "$CR_OPEN_CMD" 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
echo "  note  $(uname -s) bash, heredoc opened as <<'EOF' and met by an EOF<CR> line: $(bash -c "$CR_CLOSE_CMD" 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
# …and a CR that is NOT before a line feed: "61 62" means this bash deleted it
# from the middle of a single-quoted word, "61 0d 62" that it kept it.
CR_MID_CMD="$(printf "printf '%%s' 'a\rb'")"
echo "  note  $(uname -s) bash, the bytes of a single-quoted a<CR>b: $(bash -c "$CR_MID_CMD" 2>/dev/null | od -An -tx1 | tr -s ' \n' ' ')"
adapt guard.sh "$(carried_payload PreToolUse "echo start; apply_patch <<'EOF'\n$PATCH\nEOF")"
if [ "$RC" -eq 2 ] && grep -qF 'make it the WHOLE command' <<<"$ERR"; then
  ok "refusal for the wrong SHAPE: says to make it the whole command"
else
  bad "shape refusal lacks its way out: exit $RC, stderr: $ERR"
fi
# Four edit hooks reach the refusal for the same command. The text must be the
# same from each and must not read as the opinion of whichever check was running.
if grep -q '^run-claude-hook (edit hooks): ' <<<"$ERR" && ! grep -qF 'guard.sh' <<<"$ERR"; then
  ok "the refusal names the adapter, not the hook script that happened to be running"
else
  bad "the refusal is attributed to a hook script: $ERR"
fi

# Codex sends the command as a string. If that shape ever changes, a file hook
# that cannot read it must block, not exit 0 over a patch it never looked at.
rm -f "$LOG"
adapt guard.sh "$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":["apply_patch","*** Begin Patch"]}}' "$CWD_NATIVE")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'no command string' <<<"$ERR" && grep -qF 'unified_exec/exec_command.rs' <<<"$ERR" && ! grep -qF 'guard.sh' <<<"$ERR"; then
  ok "a Bash payload whose command is not a string BLOCKS in mode edit — naming the adapter and the Codex file to re-read, not the hook"
else
  bad "a non-string command passed silently: exit $RC (2 wanted), stderr: $ERR"
fi

# The heredoc BODY is the patch. Cutting at the first `*** End Patch` text let an
# added line containing those words hide every file after it.
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: docs/a.md\n@@\n+the envelope ends with *** End Patch\n+*** End Patch\n*** Update File: protected/x.ts\n@@\n+evil')")"
if [ "$RC" -eq 2 ] && [ "$(runs SAW)" = "2" ]; then
  ok "an added line that SAYS '*** End Patch' does not end the patch: the file after it is still checked"
else
  bad "embedded terminator truncated the patch: exit $RC (2 wanted), saw: $(cat "$LOG" 2>/dev/null)"
fi

# The payload never carries the exec tool's `workdir`, which moves the base too.
# An UPDATE of a file that is not where the paths resolve is proof of that.
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: src/lib/x.ts\n@@\n+y')")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'does not exist under' <<<"$ERR" && grep -qF 'working directory this hook cannot see' <<<"$ERR"; then
  ok "an updated file that does not exist where the paths resolve BLOCKS — the base is wrong, so nothing could be checked (the unseen-workdir case)"
else
  bad "unresolvable base: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
rm -f "$LOG"
adapt probe.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Add File: brand/new.ts\n+x')")"
if [ "$RC" -eq 0 ] && grep -qxF "ENV=$CWD_NATIVE/brand/new.ts" "$LOG"; then
  ok "an ADDED file need not exist (it cannot be used to check the base — recorded as a limit)"
else
  bad "Add was blocked or mis-resolved: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt probe.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: docs/a.md\n*** Move to: docs/renamed.md\n@@\n+z')")"
if [ "$RC" -eq 0 ] && [ "$(runs ENV)" = "2" ]; then
  ok "a move's DESTINATION need not exist"
else
  bad "move handling under the existence check: exit $RC, saw: $(cat "$LOG" 2>/dev/null) stderr: $ERR"
fi
# …but its SOURCE must, and so must a deleted file. Both are removed from a
# place a hook may protect; narrowing the existence check to Update alone would
# resolve them against a base this hook cannot see, and nothing else notices.
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: docs/missing.md\n*** Move to: docs/renamed.md\n@@\n+z')")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'this patch moves docs/missing.md, which does not exist under' <<<"$ERR"; then
  ok "a move whose SOURCE does not exist where the paths resolve blocks — and the message says MOVES, which is what the author wrote"
else
  bad "missing move source: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Delete File: docs/missing.md')")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'removes docs/missing.md, which does not exist under' <<<"$ERR"; then
  ok "a DELETE of a file that does not exist where the paths resolve blocks"
else
  bad "missing delete target: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi

# A command with NO file header is an ordinary shell command: a patch that names
# no file edits nothing. (The third row has the envelope markers and no header.)
for CMD in "grep -cF '*** Begin Patch' a.sh; grep -cF '*** End Patch' a.sh" \
           "ls -la protected/" \
           "cat <<'EOF'\n*** Begin Patch\n*** End Patch\nEOF" \
           "apply_patch --help" \
           "apply_patch_helper <<'EOF'\nx\nEOF" \
           "./apply_patch.sh <<'EOF'\nx\nEOF"; do
  rm -f "$LOG"
  adapt guard.sh "$(carried_payload PreToolUse "$CMD")"
  if [ "$RC" -eq 0 ] && [ ! -e "$LOG" ]; then
    ok "no file header anywhere in it, so an ordinary command (exit 0, script not run): $(printf '%s' "$CMD" | cut -c1-44)…"
  else
    bad "a non-invocation was treated as a patch: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no): $(printf '%s' "$CMD" | cut -c1-60)"
  fi
done

# A file hook looking at a carried patch is not gated by an `if` written for
# shell commands — otherwise the two edit channels disagree and this one fails open.
#
# Driven on PostToolUse, the only place a condition is applied at all: on
# PreToolUse this case passes whatever the adapter does with a carried patch,
# because no condition is consulted there in the first place. (Codex sends no
# command on PostToolUse for this channel today; the adapter does not rely on
# that, and this is the rule it follows if one ever arrives.)
COND_FILE="$H/edit-conditions.json"
printf '{"PostToolUse":{"guard.sh":["Bash(git push *)"]}}' > "$COND_FILE"
rm -f "$LOG"
adapt guard.sh "$(carried_payload PostToolUse "$(heredoc '' '*** Update File: protected/x.ts\n@@\n+evil')")"
if [ "$RC" -eq 2 ] && grep -qF 'protected/x.ts' "$LOG" 2>/dev/null; then
  ok "an \`if\` condition does not switch a file hook off for a carried patch (PostToolUse, condition not matching: the script still ran)"
else
  bad "a Bash condition suppressed the check of a carried patch: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no)"
fi
# The control: the same condition DOES filter that event when no patch is carried,
# so the case above is the carried patch at work and not a condition that never fires.
rm -f "$LOG"
ADAPT_ARGS="5 50"
adapt guard.sh "$(bash_payload PostToolUse 'ls protected')"
if [ "$RC" -eq 0 ] && [ ! -e "$LOG" ]; then
  ok "…control: without a carried patch the same condition filters the same event (script not run)"
else
  bad "the carried-patch case has no control — the condition did not filter a plain command: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no)"
fi
ADAPT_ARGS="5 50 edit"
unset COND_FILE

ADAPT_ARGS="5 50"
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: protected/x.ts\n@@\n+evil')")"
if [ "$RC" -eq 0 ] && grep -qxF 'SAW=<unset>' "$LOG"; then
  ok "WITHOUT mode edit the same payload is just a command (so the generator's \`edit\` argument is what closes the channel)"
else
  bad "non-edit hook on a carried patch: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
ADAPT_ARGS=""

echo "== adapter: a block must carry its reason, wherever the script wrote it =="
printf '#!/usr/bin/env bash\necho "REVIEW INCOMPLETE: end with VERDICT: PASS or FAIL"\nexit 2\n' > "$H/block-stdout.sh"
adapt block-stdout.sh '{"hook_event_name":"SubagentStop"}'
if [ "$RC" -eq 2 ] && grep -qF 'REVIEW INCOMPLETE: end with VERDICT' <<<"$ERR"; then
  ok "exit 2 with the reason on STDOUT: the reason is forwarded on stderr (reject-incomplete-review.sh does exactly this)"
else
  bad "stdout reason was lost: exit $RC, stderr: $ERR"
fi

echo "== adapter: faults that were never driven =="
# The top-level catch. A NUL byte in a patch path makes spawnSync throw
# ERR_INVALID_ARG_VALUE — an exception nothing anticipates. Without the catch
# node exits 1, Codex marks the run Failed, and the edit proceeds.
NUL_PAYLOAD='{"cwd":"'"$CWD_NATIVE"'","hook_event_name":"PreToolUse","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Add File: a\u0000b.ts\n+x\n*** End Patch"}}'
adapt probe.sh "$NUL_PAYLOAD"
if [ "$RC" -eq 2 ] && grep -qF 'unexpected error' <<<"$ERR"; then
  ok "an UNANTICIPATED adapter exception blocks on PreToolUse, through the top-level catch"
else
  bad "uncaught adapter exception: exit $RC (2 wanted), stderr: $ERR"
fi
adapt probe.sh "${NUL_PAYLOAD/PreToolUse/PostToolUse}"
if [ "$RC" -eq 1 ]; then ok "…and is a reported failure on PostToolUse"; else bad "uncaught exception on PostToolUse: exit $RC (1 wanted)"; fi
ERR_FILE="$H/err"
OUT="$(printf '%s' "$(bash_payload PreToolUse 'ls')" | CODEX_HOOK_BASH="$TMP_ROOT/no-such-bash" CODEX_HOOK_SCRIPT_DIR="$H" CODEX_HOOK_CONDITIONS="$H/no-conditions.json" PROBE_LOG="$LOG" node "$ADAPTER" probe.sh 2>"$ERR_FILE")"; RC=$?
ERR="$(cat "$ERR_FILE")"
if [ "$RC" -eq 2 ] && grep -qF 'could not start bash' <<<"$ERR" && grep -qF 'Requirements on PATH' <<<"$ERR" && ! grep -qF 'probe.sh' <<<"$ERR"; then
  ok "PreToolUse: a bash that cannot be started blocks, says what must be on PATH, and names the adapter rather than the hook"
else
  bad "missing bash: exit $RC (2 wanted), stderr: $ERR"
fi
# 126 and 127 mean "found but not executable" and "command not found" — of the
# script OR of anything it calls, so no verdict was reached. Read as a script
# crash they exit 1, Codex marks the run Failed, and the action proceeds with the
# check never having run.
for CODE in 126 127; do
  printf '#!/usr/bin/env bash\necho "cannot execute" >&2\nexit %s\n' "$CODE" > "$H/interp.sh"
  adapt interp.sh "$(bash_payload PreToolUse 'ls')"
  if [ "$RC" -eq 2 ] && grep -qF "interp.sh exited $CODE" <<<"$ERR" && grep -qF 'the check did not run' <<<"$ERR" && grep -qF 'cannot execute' <<<"$ERR"; then
    ok "PreToolUse: exit $CODE from the run is not a verdict — it BLOCKS, with the script's stderr, instead of being read as a crash the action may outlive"
  else
    bad "exit $CODE was read as a script crash: adapter exit $RC (2 wanted), stderr: $ERR"
  fi
done
# …and the message may not blame bash. Under `set -e` a tool the SCRIPT calls and
# cannot find ends it with 127 too, usually with its stderr thrown away — the
# opening of pre-push-quality-gate.sh, with a tool that does not exist for jq.
cat > "$H/missing-tool.sh" <<'MISSING'
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | no-such-tool-for-this-suite -r '.tool_input.command // empty' 2>/dev/null)
exit 0
MISSING
adapt missing-tool.sh "$(bash_payload PreToolUse 'ls')"
if [ "$RC" -eq 2 ] && grep -qF 'missing-tool.sh exited 127 (command not found)' <<<"$ERR" && grep -qF 'called a tool that is not on PATH' <<<"$ERR" \
   && grep -qF 'bash and jq both answered a moment ago' <<<"$ERR" && grep -qF 'bash -x .claude/hooks/missing-tool.sh' <<<"$ERR" \
   && ! grep -qF 'Requirements on PATH' <<<"$ERR" && ! grep -qF 'could not execute the script' <<<"$ERR"; then
  ok "exit 127 from a tool the SCRIPT could not find: says bash and jq are NOT the cause (both just answered) and how to find the one that is — not a list of four tools that are all present"
else
  bad "a script-level 127 is misattributed: exit $RC (2 wanted), stderr: $ERR"
fi

# jq is asked for BEFORE any script starts. Without it the real scripts split two
# ways, both wrong: the ones under `set -e` end 127 with no message (their own
# 2>/dev/null swallows bash's), the rest read nothing and pass. adapt_path runs
# the adapter with PATH replaced, so the bash it uses must be named explicitly.
NODE_BIN="$(command -v node)"
BASH_NATIVE="$(command -v bash)"
if command -v cygpath >/dev/null 2>&1; then BASH_NATIVE="$(cygpath -w "$BASH_NATIVE")"; fi
mkdir -p "$H/nobin"
adapt_path() {
  ERR_FILE="$H/err"
  OUT="$(printf '%s' "$3" | env PATH="$1" CODEX_HOOK_BASH="$BASH_NATIVE" CODEX_HOOK_SCRIPT_DIR="$H" CODEX_HOOK_CONDITIONS="$H/no-conditions.json" PROBE_LOG="$LOG" "$NODE_BIN" "$ADAPTER" "$2" 2>"$ERR_FILE")"
  RC=$?
  ERR="$(cat "$ERR_FILE")"
}
# The control first: the same call with the PATH left alone runs the script, so a
# block below is the missing jq and not a bash this helper failed to start.
rm -f "$LOG"
adapt_path "$PATH" probe.sh "$(bash_payload PreToolUse 'ls')"
if [ "$RC" -eq 0 ] && [ -e "$LOG" ]; then
  ok "control: with jq reachable, the explicit-bash helper runs the script (exit 0)"
else
  bad "the jq cases below cannot be trusted — their control failed: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
cat > "$H/sete.sh" <<'SETE'
#!/usr/bin/env bash
set -euo pipefail
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
printf 'RAN\n' >> "$PROBE_LOG"
exit 0
SETE
for SCRIPT in sete.sh probe.sh; do
  rm -f "$LOG"
  adapt_path "$H/nobin" "$SCRIPT" "$(bash_payload PreToolUse 'ls')"
  if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'jq is not on the PATH that bash sees' <<<"$ERR" && grep -qF 'Requirements on PATH' <<<"$ERR" \
     && ! grep -qF "$SCRIPT" <<<"$ERR" && ! grep -qF 'exited 127' <<<"$ERR"; then
    ok "PreToolUse without jq ($SCRIPT): BLOCKS before the script starts, naming jq and the requirements — not an unexplained 127, not a silent pass"
  else
    bad "a run without jq ($SCRIPT): exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
  fi
done
adapt_path "$H/nobin" probe.sh "$(bash_payload PostToolUse 'ls')"
if [ "$RC" -eq 1 ] && grep -qF 'jq is not on the PATH that bash sees' <<<"$ERR"; then
  ok "…and on PostToolUse it is a reported failure (exit 1)"
else
  bad "a PostToolUse run without jq: exit $RC (1 wanted), stderr: $ERR"
fi

# findBash() on Windows. A bare `bash` there is the WSL launcher: it starts, cannot
# see this checkout, the script "exits 1", Codex reads Failed and the action goes
# through. So when Git's bash is not found the adapter must SAY so — and the old
# `return 'bash'` fallback also blocks under this PATH ("could not start bash"),
# which is why the text is asserted and not only the exit code. CODEX_HOOK_BASH,
# which every other case sets or inherits, bypasses findBash entirely.
case "$(uname -s)" in
  MINGW*|MSYS*)
    rm -f "$LOG"
    OUT="$(printf '%s' "$(bash_payload PreToolUse 'ls')" | env -u CODEX_HOOK_BASH PATH="$(dirname "$NODE_BIN")" CODEX_HOOK_SCRIPT_DIR="$H" CODEX_HOOK_CONDITIONS="$H/no-conditions.json" PROBE_LOG="$LOG" "$NODE_BIN" "$ADAPTER" probe.sh 2>"$ERR_FILE")"; RC=$?
    ERR="$(cat "$ERR_FILE")"
    if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'no usable bash' <<<"$ERR" && grep -qF 'Requirements on PATH' <<<"$ERR" && ! grep -qF 'could not start bash' <<<"$ERR"; then
      ok "Windows: with Git's bash not findable the adapter BLOCKS saying 'no usable bash' — it does not fall back to a bare bash (the WSL launcher)"
    else
      bad "findBash without git on PATH: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
    fi
    ;;
  *)
    skip "findBash's 'no usable bash' fault — Windows-only by construction: on $(uname -s) findBash returns the bare name, and there is no WSL launcher for it to be"
    ;;
esac

# A run that cannot be COMPLETED is not "could not start bash": bash started a
# moment ago, for the jq probe. Output past the adapter's buffer is the drivable case.
printf '#!/usr/bin/env bash\nhead -c 68000000 /dev/zero | tr "\\0" x\n' > "$H/flood.sh"
adapt flood.sh "$(bash_payload PreToolUse 'ls')"
if [ "$RC" -eq 2 ] && grep -qF 'the run could not be completed' <<<"$ERR" && grep -qF 'ENOBUFS' <<<"$ERR" && grep -qF '64 MiB' <<<"$ERR"; then
  ok "a script that floods stdout past the buffer BLOCKS as a run that could not be completed, naming the limit"
else
  bad "a flooding script: exit $RC (2 wanted), stderr: $(printf '%s' "$ERR" | cut -c1-300)"
fi
# …EXCEPT a payload the script chose not to read. With one larger than the pipe
# buffer node reports the unfinished WRITE as the error (EOF on Windows, EPIPE
# elsewhere) although the script ran to its own exit code, which is the verdict:
# read as a failed run, an `exit 0` became a block and a PostToolUse `exit 2` a
# mere failure. (Where the platform reports no error for it, these two pass
# through the ordinary path — the outcome asserted is the same.)
node -e 'process.stdout.write(JSON.stringify({ hook_event_name: process.argv[1], tool_name: "Bash", tool_input: { command: "echo " + "x".repeat(400000) } }))' PreToolUse > "$H/big-pre.json"
node -e 'process.stdout.write(JSON.stringify({ hook_event_name: process.argv[1], tool_name: "Bash", tool_input: { command: "echo " + "x".repeat(400000) } }))' PostToolUse > "$H/big-post.json"
printf '#!/usr/bin/env bash\nexit 0\n' > "$H/unread-ok.sh"
printf '#!/usr/bin/env bash\necho "blocked without reading the payload" >&2\nexit 2\n' > "$H/unread-block.sh"
adapt unread-ok.sh "$(cat "$H/big-pre.json")"
if [ "$RC" -eq 0 ]; then
  ok "a script that exits 0 WITHOUT reading a large payload is a pass — the unfinished write is not a failed run"
else
  bad "an unread large payload turned exit 0 into: exit $RC, stderr: $(printf '%s' "$ERR" | cut -c1-300)"
fi
adapt unread-block.sh "$(cat "$H/big-post.json")"
if [ "$RC" -eq 2 ] && grep -qF 'blocked without reading the payload' <<<"$ERR"; then
  ok "…and one that exits 2 without reading it still BLOCKS on PostToolUse, with its own reason (read as a failed run it would exit 1)"
else
  bad "an unread large payload lost a block: exit $RC (2 wanted), stderr: $(printf '%s' "$ERR" | cut -c1-300)"
fi

echo "== adapter: its own text handling is linear — it runs outside its own deadline =="
# The deadline is consulted between script runs, so time spent INSIDE the adapter
# is never pre-empted: past Codex's timeout the run is merely Failed and the action
# proceeds. End-anchored regexes (`[ws]+$`, `\r+$`) restart at every position of a
# long run that is not at the end — 300000 interior spaces in a command with no
# patch in it took 55 s against a declared budget of 30 (100000 took 6 s, measured
# here). Each case below finishes in well under a second when the work is linear;
# ten seconds is the line between linear and not, not a performance target.
LONG_RUN=300000
node -e '
  const [n, dir] = [Number(process.argv[1]), process.argv[2]];
  const w = (f, o) => require("fs").writeFileSync(dir + "/" + f, JSON.stringify(o));
  w("long-cmd.json", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo a" + " ".repeat(n) + "b" } });
  w("long-patch.json", { hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: ok/long.ts\n+a" + " ".repeat(n) + "b\n*** End Patch" } });
  w("long-cond.json", { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git ".repeat(n / 4) } });
' "$LONG_RUN" "$H"
COND_FILE="$H/long-conditions.json"
printf '{"PostToolUse":{"probe.sh":["Bash(git push *)"]}}' > "$COND_FILE"
while IFS='|' read -r LABEL FILE ARGS WANT_RAN; do
  rm -f "$LOG" "$LOG.stdin"
  ADAPT_ARGS="$ARGS"
  T0=$SECONDS
  adapt probe.sh "$(cat "$H/$FILE")"
  TOOK=$((SECONDS - T0))
  RAN="$([ -e "$LOG" ] && echo yes || echo no)"
  if [ "$RC" -eq 0 ] && [ "$RAN" = "$WANT_RAN" ] && [ "$TOOK" -lt 10 ]; then
    ok "linear on a $LONG_RUN-character interior run (${TOOK}s): $LABEL"
  else
    bad "$LABEL: exit $RC (0 wanted), ran=$RAN ($WANT_RAN wanted), took ${TOOK}s (under 10 wanted), stderr: $(printf '%s' "$ERR" | cut -c1-200)"
  fi
done <<'LINEAR_TABLE'
an edit hook reading a plain shell command (the header scan trims every line)|long-cmd.json|5 50 edit|no
the patch tool, one added line (the parser port trims every line)|long-patch.json|5 50|yes
a condition whose first word repeats and whose second never comes|long-cond.json|5 50|no
LINEAR_TABLE
ADAPT_ARGS=""
unset COND_FILE

echo "== adapter: the jq probe spends the hook's budget, not its own =="
# A bash that starts and then does not answer. Unbounded, the probe fails OPEN:
# past Codex's timeout the run is Failed and the action proceeds. The stub sleeps
# 8 s; the budget is 4.5 s, so the adapter must speak at 3.6 s (80 %). A probe with
# its own fixed bound, or none, returns after the full 8 s — and then "finds" jq,
# because the stub exits 0. SECONDS counts whole seconds, so the line is drawn at
# 7: more than three seconds of slack for a loaded runner, and still short of 8.
case "$(uname -s)" in
  MINGW*|MSYS*)
    skip "the probe's time bound — needs a stand-in for bash that node can start, and on Windows node cannot start a shell script as a program; Linux CI drives it"
    ;;
  *)
    printf '#!/bin/sh\nexec sleep 8\n' > "$H/slow-bash"
    chmod +x "$H/slow-bash"
    for EV in PreToolUse PostToolUse; do
      rm -f "$LOG"
      T0=$SECONDS
      OUT="$(printf '%s' "$(bash_payload "$EV" 'ls')" | CODEX_HOOK_BASH="$H/slow-bash" CODEX_HOOK_SCRIPT_DIR="$H" CODEX_HOOK_CONDITIONS="$H/no-conditions.json" PROBE_LOG="$LOG" node "$ADAPTER" probe.sh 1 4.5 2>"$ERR_FILE")"; RC=$?
      TOOK=$((SECONDS - T0))
      ERR="$(cat "$ERR_FILE")"
      WANT=2; [ "$EV" = "PostToolUse" ] && WANT=1
      if [ "$RC" -eq "$WANT" ] && [ ! -e "$LOG" ] && grep -qE 'did not answer within 3\.[0-9]+s' <<<"$ERR" && [ "$TOOK" -lt 7 ]; then
        ok "$EV: a bash that does not answer is cut off INSIDE the budget (${TOOK}s of 4.5) and reported (exit $WANT) — the probe does not outlive Codex's timeout"
      else
        bad "$EV: a bash that does not answer: exit $RC ($WANT wanted), took ${TOOK}s (under 7 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
      fi
    done
    ;;
esac

echo "== adapter: a fractional number of seconds is still a whole number of milliseconds =="
# node rejects a fractional `timeout` outright ("must be an unsigned integer"), and
# the top-level catch turns that into a block on every hook. It was first seen as
# a Linux-only failure of the spent-budget case: that runner reached the probe
# inside the first millisecond, with 0.8 ms of a 0.001 s budget left. These two are
# deterministic: whatever has elapsed is a whole number, so 80 % of 3.0005 s leaves
# a fraction, and so does a per-run bound of 1.5 ms.
rm -f "$LOG"
ADAPT_ARGS="10 3.0005"
adapt probe.sh "$(bash_payload PreToolUse 'ls')"
if [ "$RC" -eq 0 ] && [ -e "$LOG" ] && ! grep -qF 'unexpected error' <<<"$ERR"; then
  ok "a fractional BUDGET runs the script (the deadline is rounded down to whole milliseconds)"
else
  bad "a fractional budget: exit $RC (0 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
ADAPT_ARGS="0.0015 50"
adapt slow.sh "$(bash_payload PreToolUse 'ls')"
if [ "$RC" -eq 2 ] && grep -qF 'timed out' <<<"$ERR" && ! grep -qF 'unexpected error' <<<"$ERR"; then
  ok "a fractional PER-RUN bound is a timeout like any other, not an adapter exception"
else
  bad "a fractional per-run bound: exit $RC (2 wanted), stderr: $ERR"
fi
ADAPT_ARGS=""

echo "== adapter: out of time on a PLAIN command does not say 'split the patch' =="
# There is no patch to split. The time went on starting up — node, a cold bash, the
# jq probe — so the message says how much, and that the way out is to try again.
rm -f "$LOG"
ADAPT_ARGS="5 0.001"
adapt probe.sh "$(bash_payload PreToolUse 'git commit -m x')"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'out of time before the check could start' <<<"$ERR" && grep -qE '[0-9.]+s of it went on starting up' <<<"$ERR" \
   && grep -qF 'Run it again' <<<"$ERR" && ! grep -qF 'Split the patch' <<<"$ERR" && ! grep -qF 'paths' <<<"$ERR"; then
  ok "a plain command with no budget left: says the time went on starting up and to run it again — not to split a patch that does not exist"
else
  bad "out of time on a plain command: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
ADAPT_ARGS="10 2"
adapt slow.sh "$(bash_payload PreToolUse 'git commit -m x')"
if [ "$RC" -eq 2 ] && grep -qF 'out of time while the check was running' <<<"$ERR" && ! grep -qF 'Split the patch' <<<"$ERR"; then
  ok "…and the same when the budget runs out DURING the one run"
else
  bad "out of time during a plain command: exit $RC (2 wanted), stderr: $ERR"
fi
ADAPT_ARGS=""
# The payload's cwd may name a directory that no longer exists (a removed
# worktree). spawnSync would fail ENOENT there and every hook would block with
# "could not start bash"; the adapter falls back to the repository root instead.
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$(printf '{"cwd":"%s/no-such-dir","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}' "$CWD_NATIVE")"
if [ "$RC" -eq 0 ] && [ -e "$LOG" ]; then
  ok "a payload cwd that does not exist falls back to the repository root — the script still runs"
else
  bad "a nonexistent cwd broke the run: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi

echo "== adapter: output is translated per event (each Codex wire type is deny_unknown_fields) =="
adapt text.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: a.ts\n@@\n+x\n*** End Patch')"
if [ "$RC" -eq 0 ] && [ "$(out_get hookSpecificOutput.additionalContext)" = "WARNING: db.transaction() detected" ] \
   && [ "$(out_get hookSpecificOutput.hookEventName)" = "PreToolUse" ]; then
  ok "PLAIN-TEXT stdout is wrapped as additionalContext — Codex drops plain text, so a warning would warn nobody"
else
  bad "plain text was not wrapped: exit $RC, stdout: $OUT"
fi
for EV in PostCompact PreCompact Stop SubagentStop; do
  adapt text.sh "{\"hook_event_name\":\"$EV\"}"
  if [ "$RC" -eq 0 ] && [ "$(out_get systemMessage)" = "WARNING: db.transaction() detected" ] \
     && [ "$(out_get @has:hookSpecificOutput)" = "false" ] && [ "$(out_get @keys)" = "systemMessage" ]; then
    ok "$EV: plain text becomes a systemMessage (the only field that event accepts) — shown to the person rather than reaching nobody"
  else
    bad "$EV: plain-text handling is wrong: exit $RC, stdout: $OUT"
  fi
done
adapt ctx.sh "$PAYLOAD"
CTX_OUT="$(out_get hookSpecificOutput.additionalContext)"
if grep -qF 'ctx for new.ts' <<<"$CTX_OUT" && grep -qF 'ctx for old.ts' <<<"$CTX_OUT" && grep -qF 'ctx for gone.ts' <<<"$CTX_OUT"; then
  ok "additionalContext from every per-file run is merged into one output"
else
  bad "context was not merged: $OUT"
fi
adapt allow.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'
if [ "$RC" -eq 0 ] && [ "$(out_get hookSpecificOutput.@has:permissionDecision)" = "false" ] && [ "$(out_get @has:suppressOutput)" = "false" ] \
   && [ "$(out_get hookSpecificOutput.additionalContext)" = "remember the rule" ]; then
  ok "permissionDecision=allow and suppressOutput are dropped (Codex fails the run on them); additionalContext survives"
else
  bad "allow translation is wrong: exit $RC, stdout: $OUT"
fi
adapt deny.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'
if [ "$(out_get hookSpecificOutput.permissionDecision)" = "deny" ] && [ "$(out_get hookSpecificOutput.permissionDecisionReason)" = "not on main" ]; then
  ok "PreToolUse: a JSON deny is passed on as permissionDecision=deny with its reason"
else
  bad "deny translation is wrong: $OUT"
fi
adapt stopblock.sh '{"hook_event_name":"Stop"}'
if [ "$(out_get decision)" = "block" ] && [ "$(out_get reason)" = "review is incomplete" ] && [ "$(out_get @has:hookSpecificOutput)" = "false" ]; then
  ok "Stop: a JSON block stays TOP-LEVEL decision/reason — Stop rejects hookSpecificOutput outright"
else
  bad "Stop block translation is wrong: $OUT"
fi
adapt stopblock.sh '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}'
if [ "$(out_get hookSpecificOutput.permissionDecision)" = "deny" ] && [ "$(out_get @has:decision)" = "false" ]; then
  ok "PreToolUse: the same JSON block becomes permissionDecision=deny"
else
  bad "PreToolUse block translation is wrong: $OUT"
fi

cat > "$H/jsonctx.sh" <<'JC'
#!/usr/bin/env bash
printf '%s' '{"hookSpecificOutput":{"hookEventName":"whatever-the-script-says","additionalContext":"lint: 2 problems"}}'
JC
for EV in PostToolUse SessionStart UserPromptSubmit SubagentStart; do
  adapt jsonctx.sh "{\"hook_event_name\":\"$EV\"}"
  if [ "$(out_get hookSpecificOutput.additionalContext)" = "lint: 2 problems" ] && [ "$(out_get hookSpecificOutput.hookEventName)" = "$EV" ]; then
    ok "$EV: JSON context is forwarded under hookEventName=$EV (the wire type is const per event, whatever the script wrote)"
  else
    bad "$EV: context translation is wrong: $OUT"
  fi
  adapt text.sh "{\"hook_event_name\":\"$EV\"}"
  if [ "$(out_get hookSpecificOutput.additionalContext)" = "WARNING: db.transaction() detected" ] && [ "$(out_get @has:systemMessage)" = "false" ]; then
    ok "$EV: plain text becomes additionalContext (not a systemMessage) — this event can reach the model"
  else
    bad "$EV: plain-text routing is wrong: $OUT"
  fi
done
for EV in UserPromptSubmit PostToolUse SubagentStop; do
  adapt stopblock.sh "{\"hook_event_name\":\"$EV\"}"
  if [ "$(out_get decision)" = "block" ] && [ "$(out_get reason)" = "review is incomplete" ] && [ "$(out_get @has:hookSpecificOutput)" = "false" ]; then
    ok "$EV: a JSON block is top-level decision/reason"
  else
    bad "$EV: block translation is wrong: $OUT"
  fi
done
adapt stopblock.sh '{"hook_event_name":"SessionStart"}'
if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then
  ok "SessionStart cannot block: a JSON block there is dropped rather than sent in a shape Codex would reject"
else
  bad "SessionStart emitted a block: $OUT"
fi

echo "== adapter: \`if\` conditions from .claude/settings.json =="
COND_FILE="$H/conditions.json"
printf '{"PostToolUse":{"probe.sh":["Bash(git push *)"]}}' > "$COND_FILE"
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$(bash_payload PostToolUse 'git status')"
if [ "$RC" -eq 0 ] && [ ! -e "$LOG" ]; then
  ok "a command that does not match the condition does not run the script"
else
  bad "condition did not filter: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no)"
fi
adapt probe.sh "$(bash_payload PostToolUse 'cd web && git push origin HEAD')"
if [ -e "$LOG" ]; then
  ok "the literal is matched ANYWHERE in the command — a compound command still runs the script"
else
  bad "a compound 'cd x && git push' did not run the script"
fi
# GENEROUS means the pattern's WORDS in order, with anything between them. One
# substring test never started block-main-commits.sh for `git -C . commit`,
# `git  commit` or `git \<LF>commit` — the spellings that script exists to catch.
printf '{"PostToolUse":{"probe.sh":["Bash(git commit *)"]}}' > "$COND_FILE"
SPELLED_COND=0
while IFS='|' read -r LABEL CMD; do
  SPELLED_COND=$((SPELLED_COND + 1))
  rm -f "$LOG" "$LOG.stdin"
  adapt probe.sh "$(bash_payload PostToolUse "$CMD")"
  if [ -e "$LOG" ]; then ok "condition 'git commit' still runs the script for: $LABEL"; else bad "a spelling of git commit skipped the script: $LABEL"; fi
done <<'COND_SPELLINGS'
the plain form|git commit -m x
git -C <dir> commit|git -C . commit -m x
two spaces|git  commit -m x
git -c k=v commit|git -c user.name=x commit -m x
a line continuation between the words|git \\\ncommit -m x
COND_SPELLINGS
if [ "$SPELLED_COND" -eq 5 ]; then ok "all 5 commit spellings were driven"; else bad "the condition table was not walked: $SPELLED_COND of 5"; fi
# …and still a filter: the words must be WORDS, in ORDER.
for CMD in 'git status' 'commit git' 'gitx commit' 'git recommit' 'echo git-commit'; do
  rm -f "$LOG" "$LOG.stdin"
  adapt probe.sh "$(bash_payload PostToolUse "$CMD")"
  if [ "$RC" -eq 0 ] && [ ! -e "$LOG" ]; then ok "condition 'git commit' does not match: $CMD"; else bad "condition 'git commit' matched '$CMD'"; fi
done
# A condition belongs to the EVENT it was recorded under. Driven with the pairing
# that can tell: a condition keyed under PreToolUse and a non-matching PostToolUse
# command. (The other way round — a PostToolUse condition, a PreToolUse payload —
# passes whatever conditionsFor() does with the key, because PreToolUse consults
# no condition at all; that is the NEVER_FILTERED table below.)
printf '{"PreToolUse":{"probe.sh":["Bash(git push *)"]}}' > "$COND_FILE"
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$(bash_payload PostToolUse 'git status')"
if [ -e "$LOG" ]; then ok "a condition recorded for one event does not filter another (PreToolUse-keyed, PostToolUse payload: the script ran)"; else bad "a PreToolUse condition filtered a PostToolUse run"; fi
# A condition is consulted for a SHELL COMMAND and for nothing else: a patch on
# the same event runs the script whatever the condition says. That is why the
# generator refuses a Bash `if` on any group Codex matches for more than Bash —
# here is the behaviour that refusal keeps from being reached by accident.
printf '{"PostToolUse":{"probe.sh":["Bash(git push *)"]}}' > "$COND_FILE"
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$(patch_payload PostToolUse '*** Begin Patch\n*** Add File: ok/new.ts\n+x\n*** End Patch')"
if [ "$RC" -eq 0 ] && [ -e "$LOG" ]; then
  ok "a Bash condition does not filter an apply_patch payload — the script runs (so the generator keeps such a condition on Bash-only groups)"
else
  bad "a Bash condition was applied to a patch: exit $RC, ran=$([ -e "$LOG" ] && echo yes || echo no)"
fi
# On PreToolUse a condition is NEVER applied, even if one is present in the file:
# the blocking script always starts and routes on the command itself. A filter in
# front of it skipped spellings block-main-commits.sh is hardened to catch, and
# the source's `Bash(git commit *)` never started it for merge/cherry-pick/revert.
printf '{"PreToolUse":{"probe.sh":["Bash(git commit *)"]}}' > "$COND_FILE"
NEVER_FILTERED=0
while IFS='|' read -r LABEL CMD; do
  NEVER_FILTERED=$((NEVER_FILTERED + 1))
  rm -f "$LOG" "$LOG.stdin"
  adapt probe.sh "$(bash_payload PreToolUse "$CMD")"
  if [ -e "$LOG" ]; then ok "PreToolUse: the script is started regardless of a condition — $LABEL"; else bad "a PreToolUse condition kept a blocking script from starting: $LABEL"; fi
done <<'NEVER_FILTERED_TABLE'
empty quotes inside the command word|g''it commit -m x
empty quotes inside the subcommand|git c''ommit -m x
a continuation INSIDE the subcommand|git com\\\nmit -m x
a different commit-creating subcommand|git merge --no-ff topic
cherry-pick|git cherry-pick abc123
a command the condition plainly does not name|git status
NEVER_FILTERED_TABLE
if [ "$NEVER_FILTERED" -eq 6 ]; then ok "all 6 never-filtered commands were driven"; else bad "the never-filtered table was not walked: $NEVER_FILTERED of 6"; fi
printf '{"PostToolUse":{"probe.sh":["Bash(git push *)"]}}' > "$COND_FILE"
rm -f "$LOG" "$LOG.stdin"
printf '{"PostToolUse":{"probe.sh":["this is not a condition"]}}' > "$COND_FILE"
adapt probe.sh "$(bash_payload PostToolUse 'git status')"
if [ -e "$LOG" ]; then ok "a condition the adapter cannot parse means RUN, not skip"; else bad "an unparseable condition suppressed the script"; fi
rm -f "$LOG" "$LOG.stdin"
# `Edit(git status *)`: the words DO appear in the command, so only the tool-name
# check can keep the script from running. (`Edit(src/*)` never matched `git status`
# anyway, so that fixture passed with the check deleted.)
printf '{"PostToolUse":{"probe.sh":["Edit(git status *)"]}}' > "$COND_FILE"
adapt probe.sh "$(bash_payload PostToolUse 'git status')"
if [ ! -e "$LOG" ]; then ok "a well-formed condition written for ANOTHER tool does not match a Bash payload"; else bad "a condition for another tool matched Bash"; fi
rm -f "$LOG" "$LOG.stdin"
printf '{ broken' > "$COND_FILE"
adapt probe.sh "$(bash_payload PostToolUse 'git status')"
if [ -e "$LOG" ]; then ok "an unreadable conditions file means RUN — the failure direction is enforcement"; else bad "an unreadable conditions file suppressed the script"; fi
rm -f "$LOG" "$LOG.stdin"
unset COND_FILE
adapt probe.sh "$(bash_payload PreToolUse 'git status')"
sed -n '1p' "$LOG.stdin" > "$H/bash.json"
if [ "$RC" -eq 0 ] && [ "$(json_get "$H/bash.json" tool_input.command)" = "git status" ]; then
  ok "a Bash payload passes through with tool_input.command intact"
else
  bad "Bash passthrough is wrong: exit $RC, stdin: $(cat "$LOG.stdin" 2>/dev/null)"
fi

echo "== the real manifest classifies every hook the real settings.json wires =="
OUT="$(node "$GEN" --check 2>&1)"; RC=$?
if [ "$RC" -eq 2 ]; then
  bad "the generator cannot run against this repository: $OUT"
else
  ok "every event and script in .claude/settings.json is ported or explained (exit $RC ≠ 2)"
fi
# Kept for DOC_COUNTS below, which holds the matrix against it. Empty when no hook
# has that shape — which is a state the comparison there must handle, not a skip.
BOTH_NOTE="$(printf '%s\n' "$OUT" | grep -F 'are matched for BOTH apply_patch and Bash: ' || true)"

echo "== every real PreToolUse hook with an \`if\` filters for ITSELF =="
# Not applying a PreToolUse condition is sound only while each such script routes
# on the command it is handed. Under Claude Code the `if` may do the narrowing;
# under Codex nothing does, so a script that relied on it would block — or do its
# heavy work — on EVERY shell command, with every gate green. The list is derived
# from the real settings.json and each REAL script is run through the real adapter
# (no CODEX_HOOK_SCRIPT_DIR) with a command none of them is about.
# shellcheck disable=SC2016  # a node program: the $ is JavaScript, not shell
SELF_FILTER_NAMES="$(node -e '
  const fs = require("fs");
  const root = process.argv[1];
  const src = JSON.parse(fs.readFileSync(root + "/.claude/settings.json", "utf8")).hooks;
  const ported = JSON.stringify(JSON.parse(fs.readFileSync(root + "/.codex/hooks.json", "utf8")).hooks);
  const names = new Set();
  for (const g of src.PreToolUse || []) {
    if (typeof g.if !== "string" || !g.if) continue;
    for (const h of g.hooks || []) {
      const m = /([\w.-]+\.sh)"?$/.exec(h.command || "");
      if (m && ported.includes(" " + m[1] + " ")) names.add(m[1]);
    }
  }
  process.stdout.write([...names].join("\n"));
' "$REPO_ROOT")"
REPO_NATIVE="$(cd "$REPO_ROOT" && { pwd -W 2>/dev/null || pwd; })"
SELF_FILTERED=0
while IFS= read -r NAME; do
  [ -n "$NAME" ] || continue
  SELF_FILTERED=$((SELF_FILTERED + 1))
  OUT="$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"true"}}' "$REPO_NATIVE" | node "$ADAPTER" "$NAME" 10 15 2>"$H/err")"; RC=$?
  if [ "$RC" -eq 0 ] && ! grep -qE '"(permissionDecision|decision)"' <<<"$OUT"; then
    ok "$NAME starts for \`true\`, decides it is not its business and allows it (exit 0, no deny) — it does not lean on its \`if\`"
  else
    bad "$NAME does not filter for itself: for the command \`true\` the adapter exited $RC (0 wanted) — under Codex its \`if\` is not applied, so it would do this on every shell command. stdout: $OUT stderr: $(cat "$H/err")"
  fi
done <<<"$SELF_FILTER_NAMES"
if [ "$SELF_FILTERED" -ge 1 ]; then
  ok "$SELF_FILTERED real PreToolUse hook(s) carrying an \`if\` were driven"
else
  bad "no PreToolUse hook with an \`if\` was found in .claude/settings.json — the derivation matched nothing, so nothing above was checked"
fi

echo "== the support matrix's numbers are re-derived, not remembered =="
# Twice a review found a count in docs/guides/codex-cli-support-matrix.md that no
# longer matched the generated files. The document's whole claim is that it says
# only what is true of this tree, so its numbers are computed here.
# shellcheck disable=SC2016  # a node program: the backticks and $ are JavaScript, not shell
DOC_COUNTS="$(node -e '
  const fs = require("fs");
  const root = process.argv[1];
  const doc = fs.readFileSync(root + "/docs/guides/codex-cli-support-matrix.md", "utf8");
  const hooks = JSON.parse(fs.readFileSync(root + "/.codex/hooks.json", "utf8")).hooks;
  const conds = JSON.parse(fs.readFileSync(root + "/.codex/hook-conditions.json", "utf8"));
  const words = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];
  const groups = Object.values(hooks).flat();
  const total = groups.reduce((n, g) => n + g.hooks.length, 0);
  const bash = groups.filter((g) => String(g.matcher || "").split("|").includes("Bash")).reduce((n, g) => n + g.hooks.length, 0);
  const lists = Object.entries(conds).filter(([k]) => k !== "_README").flatMap(([, v]) => Object.values(v));
  const applied = lists.length;
  const srcIfs = Object.values(JSON.parse(fs.readFileSync(root + "/.claude/settings.json", "utf8")).hooks).flat()
    .filter((g) => typeof g.if === "string" && g.if).flatMap((g) => (g.hooks || []).map(() => g.if));
  const conditional = srcIfs.length;
  const patterns = new Set(srcIfs).size;
  const agents = fs.readdirSync(root + "/.codex/agents").filter((f) => f.endsWith(".toml")).length;
  const lock = JSON.parse(fs.readFileSync(root + "/tools/agentic-sync/port.lock.json", "utf8")).generated;
  const skills = new Set(Object.keys(lock).filter((k) => k.startsWith(".agents/skills/")).map((k) => k.split("/")[2])).size;
  const problems = [];
  const want = (re, label) => { if (!re.test(doc)) problems.push(label); };
  want(new RegExp("### Ported \\(" + total + " handlers\\)"), "Ported heading should say " + total);
  want(new RegExp(words[bash] + " of the " + total + " handlers match `Bash`", "i"), "Bash-matched count should be " + words[bash] + " of " + total);
  want(new RegExp(words[conditional] + " hooks carry\\s+one, over " + words[patterns] + " distinct patterns", "i"), "if-condition counts should be " + words[conditional] + " / " + words[patterns]);
  want(new RegExp("Only " + words[applied] + " of them (is|are) applied", "i"), "applied if-condition count should be " + words[applied]);
  if (Object.keys(conds).some((k) => k === "PreToolUse")) problems.push("hook-conditions.json carries a PreToolUse condition, which the matrix says is never applied");
  // The block messages of the adapter send readers to this document and this heading.
  // The reference validator does not resolve docs/ paths, so nothing else notices a rename.
  // (No apostrophes in this program: it sits inside a single-quoted shell string.)
  const adapter = fs.readFileSync(root + "/.codex/hooks/run-claude-hook.mjs", "utf8");
  const pointer = /Details: (docs\/guides\/[\w.-]+\.md), "([^"]+)"/.exec(adapter);
  if (!pointer) problems.push("the adapter no longer points its refusal at a document and heading");
  else if (pointer[1] !== "docs/guides/codex-cli-support-matrix.md" || !new RegExp("^#+ " + pointer[2] + "$", "m").test(doc)) problems.push("the adapter points at " + pointer[1] + " / " + pointer[2] + ", which this document does not have");
  // The same for the PATH pointer, which every "needs a person" fault carries. It is
  // read off the ONE constant that spells it, and held against a real heading.
  const onPath = /const ON_PATH = `[^`]*— (\.codex\/[\w.-]+\.md), "([^"]+)"\.`;/.exec(adapter);
  if (!onPath) problems.push("the adapter no longer spells its PATH pointer in one ON_PATH constant");
  else {
    const target = fs.readFileSync(root + "/" + onPath[1], "utf8");
    if (!new RegExp("^#+ " + onPath[2] + "$", "m").test(target)) problems.push("the adapter points at " + onPath[1] + " / " + onPath[2] + ", and that file has no such heading");
    if ((adapter.match(/Requirements on PATH/g) || []).length !== 1) problems.push("the PATH pointer is spelled somewhere other than ON_PATH, where this check cannot see it");
  }
  // REPORTING ON A COUPLING, not on behaviour: the jq taxonomy was stated in four
  // places and a review found it corrected in one. Anything that says a script ends
  // 127 without jq must also carry the caveat that `set -e` alone does not decide it
  // (a jq call in a command substitution does not end the script).
  //
  // The SUBJECT IS DERIVED, not listed. A hardcoded list was the first cut, and it
  // shipped green over a copy it did not name: the comment in the adapter itself, a
  // `.mjs` the list could not contain. So every file that could carry the claim is
  // WALKED: the agent-instruction and doc trees plus the Codex surface, matched
  // case-insensitively, because "Exit 127" is the same claim. Each file is
  // NORMALISED first — line-leading comment markers dropped, then whitespace
  // collapsed — because the phrase wraps, and in a source file it wraps across a
  // `//`, which a plain whitespace collapse leaves sitting between the two words.
  const skipDir = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "target"]);
  const walk = (d, acc) => {
    let entries = [];
    try { entries = fs.readdirSync(root + "/" + d, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = d ? d + "/" + e.name : e.name;
      if (e.isDirectory()) { if (!skipDir.has(e.name)) walk(rel, acc); }
      else if (/\.(md|mjs|js|sh|toml|json|mdc|cursorrules)$/.test(e.name) || /^\.?[\w.-]*(rules|instructions)[\w.-]*$/i.test(e.name)) acc.push(rel);
    }
    return acc;
  };
  const jqCandidates = [...new Set([
    ...walk(".claude", []), ...walk(".codex", []), ...walk(".agents", []), ...walk("docs", []), ...walk(".github", []),
    ...fs.readdirSync(root).filter((f) => { try { return fs.statSync(root + "/" + f).isFile(); } catch { return false; } }),
  ])].filter((f) => !/\.lock\.yml$/.test(f));
  const jqClaimFiles = jqCandidates
    .map((f) => { try { return [f, fs.readFileSync(root + "/" + f, "utf8").replace(/^[ \t]*(?:\/\/+|#+|\*)[ \t]?/gm, " ").replace(/\s+/g, " ")]; } catch { return null; } })
    .filter(Boolean)
    .filter(([, t]) => /(?:exit|status)\s+127/i.test(t) && /\bjq\b/.test(t));
  // The vacuity guard names the copies that MUST be found, not a count. A bare
  // floor could be lowered without any test noticing, because nothing observes it
  // while the walk is healthy — and lowering it plus breaking the walk is green in
  // combination, which is the shape lessons-learned #19 warns about. A missing
  // path cannot be compensated for that way.
  const jqFound = jqClaimFiles.map(([f]) => f);
  for (const known of ["docs/guides/codex-cli-support-matrix.md", ".codex/AGENTS.md", ".claude/rules/gotchas-codex-port.md", ".codex/hooks/run-claude-hook.mjs"]) {
    if (!jqFound.includes(known)) problems.push(known + " states what happens to a hook script without jq and the walk did not find it — the walk is looking in the wrong place (found: " + (jqFound.join(", ") || "nothing") + ")");
  }
  for (const [f, t] of jqClaimFiles) {
    if (!/command substitution/i.test(t)) problems.push(f + " says a script ends 127 without jq but not that `set -e` alone does not decide it (check-pr-metadata.sh has `set -e` and exits 0)");
  }
  // Both files explain why an `if` hook loses its status line; twice that prose
  // kept saying the adapter applies every condition after it stopped doing so.
  const gen = fs.readFileSync(root + "/tools/agentic-sync/port.mjs", "utf8");
  for (const [label, text] of [["the support matrix", doc], ["port.mjs", gen]]) {
    if (/has that condition applied inside the\s+(\/\/\s+)?adapter|which moved into the adapter|; the adapter applies them\./.test(text)) problems.push(label + " still says every `if` is applied by the adapter — on PreToolUse none is");
  }
  if (!/NON-GATING events only/.test(String(conds._README)) || !/PreToolUse/.test(String(conds._README))) problems.push("hook-conditions.json does not say that PreToolUse conditions are left out on purpose");
  // That _README sends its reader to a section of this document, which is a bold
  // lead-in rather than a heading. Read out of the generated file, held against the text.
  const readmePointer = /see (docs\/guides\/[\w.-]+\.md), "([^"]+)"/.exec(String(conds._README));
  if (!readmePointer) problems.push("hook-conditions.json no longer points at a document and section");
  else if (readmePointer[1] !== "docs/guides/codex-cli-support-matrix.md" || !(doc.includes("\n**" + readmePointer[2] + ".**") || new RegExp("^#+ " + readmePointer[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m").test(doc))) problems.push("hook-conditions.json points at " + readmePointer[1] + " / " + readmePointer[2] + ", and this document has no section of that name");
  want(new RegExp(words[agents - 1] + " of the " + words[agents], "i"), "generated-agent count should be " + words[agents - 1] + " of the " + words[agents]);
  want(new RegExp("list " + total + " handlers"), "first-run checklist should expect " + total + " handlers");
  want(new RegExp("The " + skills + " project skills"), "mirrored-skill count should be " + skills);
  // Status lines: how many the SOURCE sets, how many survive into hooks.json, and
  // so how many ported ones were dropped. The matrix states all three.
  const settings = JSON.parse(fs.readFileSync(root + "/.claude/settings.json", "utf8")).hooks;
  const manifest = JSON.parse(fs.readFileSync(root + "/tools/agentic-sync/port.json", "utf8")).hooks;
  const srcHandlers = Object.values(settings).flat().flatMap((g) => g.hooks || []);
  const withStatus = srcHandlers.filter((h) => h.statusMessage);
  const skipped = Object.keys(manifest.skipScripts || {});
  const statusOnSkipped = withStatus.filter((h) => skipped.some((s) => String(h.command).includes(s))).length;
  const statusPorted = groups.flatMap((g) => g.hooks).filter((h) => h.statusMessage).length;
  want(new RegExp("`statusMessage` on " + words[withStatus.length] + " handlers", "i"), "source status-line count should be " + words[withStatus.length]);
  want(new RegExp("The other\\s+" + words[withStatus.length - statusOnSkipped] + " are dropped", "i"), "dropped status-line count should be " + words[withStatus.length - statusOnSkipped]);
  if (statusPorted === 0) want(/\*\*No ported hook shows a status line\.\*\*/, "the matrix should say no ported hook shows a status line");
  else problems.push("hooks.json now carries " + statusPorted + " statusMessage key(s) but the matrix says no ported hook shows one");
  // The hooks matched for BOTH edit channels are named in the matrix. The
  // generator computes that set on every run, so the document is held against ITS
  // output (argv[2] is the note from the real --check above), in both directions:
  // a hook it names and the matrix does not, and a hook the matrix names and it
  // does not. The limit paragraph is cut out by its own heading text.
  const note = process.argv[2] || "";
  // Cut at the SENTENCE end (dot-space), not at the first dot — that one is in `.sh`.
  const noted = (/are matched for BOTH apply_patch and Bash: (.*?)\. /.exec(note) || [, ""])[1]
    .split(",").map((s) => s.trim()).filter(Boolean);
  const limitPara = (/\n- \*\*A `PreToolUse` check that gates on file paths[\s\S]*?(?=\n- \*\*|\n## )/.exec(doc) || [""])[0];
  if (!limitPara) problems.push("the matrix has no both-channels limit entry to hold against the generator");
  else {
    const named = [...limitPara.matchAll(/`([\w.-]+\.sh)`/g)].map((m) => m[1]);
    for (const n of noted) if (!named.includes(n)) problems.push("the generator reports " + n + " as matched for both edit channels and the matrix does not name it");
    for (const n of named) if (!noted.includes(n)) problems.push("the matrix names " + n + " as matched for both edit channels and the generator does not");
  }
  process.stdout.write(problems.length ? problems.join("; ") : "OK " + total + "/" + bash + "/" + conditional + "/" + patterns + "/" + agents + "/" + skills);
' "$REPO_ROOT" "$BOTH_NOTE" 2>&1)"
case "$DOC_COUNTS" in
  "OK "*) ok "handler, Bash-matched, if-condition, agent and skill counts in the support matrix match the generated files (${DOC_COUNTS#OK })" ;;
  *) bad "the support matrix states a number the generated files contradict: $DOC_COUNTS" ;;
esac

echo "== CI wiring =="
# Executable lines only: strip whole-line comments before counting.
CI_CODE="$(grep -vE '^[[:space:]]*#' "$CI_YML")"
# The JOB that runs the gate. A step pin is not enough: job-level
# `continue-on-error: true` lets the job report success over a red gate, and a
# second job-level `if:` replaces the first (YAML: last key wins).
JOB="$(awk '/^  agentic-sync:[[:space:]]*$/{j=1;next} j && /^  [A-Za-z0-9_-]+:/{exit} j{print}' <<<"$CI_CODE")"
JOB_KEYS="$(grep -E '^    [A-Za-z_-]+:' <<<"$JOB" | sed -E 's/^    ([A-Za-z_-]+):.*/\1/' | tr '\n' ' ')"
if [ -n "$JOB" ] && [ "$JOB_KEYS" = "name needs if runs-on timeout-minutes permissions steps " ]; then
  ok "the agentic-sync job has exactly its seven job-level keys — no continue-on-error, no second if:"
else
  bad "the agentic-sync job's job-level keys changed: '$JOB_KEYS'"
fi
WANT_IF="    if: \${{ needs.ci-gate.outputs.needs-agentic == 'true' }}"
if grep -qxF "$WANT_IF" <<<"$JOB"; then
  ok "…and its if: is the needs-agentic gate, nothing weaker"
else
  bad "the agentic-sync job's if: is not the needs-agentic gate: $(grep -E '^    if:' <<<"$JOB")"
fi
N="$(grep -cE '^[[:space:]]+run: bash scripts/check-codex-port\.sh[[:space:]]*$' <<<"$CI_CODE")"
if [ "$N" = "1" ]; then
  ok "ci.yml runs the gate on exactly one executable line"
else
  bad "expected exactly 1 executable 'run: bash scripts/check-codex-port.sh' in ci.yml, found $N"
fi
# A containment check is not enough. YAML's last-key-wins means a SECOND `run:`
# appended to the step replaces the command while the original line stays
# byte-present (.claude/rules/gotchas-build-ci.md → duplicate YAML keys). Cut the
# step out and require exactly one `run:` key in it, no `if:`, and no
# `continue-on-error:` — each of which would leave the line above untouched and
# the gate dead or advisory.
STEP="$(awk '
  /^      - name: Check the generated Codex CLI surface/ { f = 1; print; next }
  f && (/^      - / || /^  [A-Za-z0-9_-]+:/ || /^[^ ]/) { exit }
  f { print }
' <<<"$CI_CODE")"
if [ -z "$STEP" ]; then
  bad "could not find the gate step in ci.yml by name — the step-level pins below would pass on nothing"
else
  RUNS="$(grep -cE '^        run:' <<<"$STEP")"
  if [ "$RUNS" = "1" ] && grep -qxF '        run: bash scripts/check-codex-port.sh' <<<"$STEP"; then
    ok "the gate step has exactly one run: key, and it is the gate"
  else
    bad "the gate step has $RUNS run: key(s) or the wrong command: $STEP"
  fi
  if grep -qE '^        (if|continue-on-error|shell|working-directory|env):' <<<"$STEP"; then
    bad "the gate step carries a key that can skip, soften or redirect it: $STEP"
  else
    ok "the gate step has no if:, continue-on-error:, shell:, working-directory: or env:"
  fi
fi
# Text containment only — it proves the pattern is WRITTEN, not that it works.
# The executable proof (the real step body run against synthetic paths, with
# near-misses) is scripts/__tests__/ci-gate-path-filters.test.sh → "#9745".
AGENTIC_LINE="$(grep -E "&& agentic=true" <<<"$CI_CODE")"
for pat in '^\.claude/rules/' '^\.claude/hooks/' '^\.claude/tools/' '^\.claude/CLAUDE\.md$' '^\.github/' '^\.claude/skills/' '^\.claude/agents/' '^\.claude/settings\.json$' '^\.agents/skills/' '^\.codex/' '^\.mcp\.json$' '^scripts/check-codex-port\.sh$'; do
  if grep -qF -- "$pat" <<<"$AGENTIC_LINE"; then
    ok "the ci-gate agentic filter fires on $pat"
  else
    bad "the ci-gate agentic filter does not fire on $pat — a change there would never run the gate"
  fi
done
SEAM_HITS="$(grep -rnE 'CODEX_PORT_ROOT|CODEX_PORT_NODE|CODEX_HOOK_SCRIPT_DIR|CODEX_HOOK_CONDITIONS|CODEX_HOOK_BASH' "$REPO_ROOT/.github/workflows" "$REPO_ROOT/.github/actions" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true)"
if [ -z "$SEAM_HITS" ]; then
  ok "no workflow or composite action sets a test-only seam (all five, CODEX_HOOK_CONDITIONS included — that one fails OPEN)"
else
  bad "a test-only seam is wired in CI (it would point the gate at an empty tree): $SEAM_HITS"
fi
# An executable `run:` line, counted — NOT "the path appears somewhere". The
# path also appears in the shellcheck list, so a containment check stayed green
# when the run step itself was replaced with `run: 'true'` (measured by mutation
# while writing this suite): linted, never executed.
N="$(grep -cE '^        run: bash scripts/__tests__/check-codex-port\.test\.sh[[:space:]]*$' <<<"$CI_CODE")"
if [ "$N" = "1" ]; then
  ok "this suite is itself RUN by ci.yml, on exactly one executable line"
else
  bad "expected exactly 1 executable run of this suite in ci.yml, found $N — it would be linted but never executed"
fi

# -----------------------------------------------------------------------------
# alwaysLoad stays on credential-free, read-only servers (#8695, board round 2).
# `alwaysLoad` exempts a server from Tool Search deferral, so its tools are in
# every context from session start, reviewer seats included, whose write block
# covers Bash only. A server that reads credentials or can write to the
# repository (github) must stay deferred. Codex never reads .mcp.json, so the
# port gate above does not look at this key; this is the only pin on it.
# The allowlist is exact: a server added to it needs the same argument made in
# claude-platform-reference/SKILL.md. Any value other than false counts as set.
ALWAYS_LOAD_ALLOWED="context7"
ALWAYS_LOAD="$(node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).mcpServers || {};
const names = Object.keys(m);
if (names.length === 0) { console.log("!EMPTY"); process.exit(0); }
for (const n of names) if (Object.prototype.hasOwnProperty.call(m[n], "alwaysLoad") && m[n].alwaysLoad !== false) console.log(n);
' "$REPO_ROOT/.mcp.json")" || ALWAYS_LOAD="!PARSE"
case "$ALWAYS_LOAD" in
  '!PARSE'|'!EMPTY') bad ".mcp.json could not be read as a server map ($ALWAYS_LOAD), so the alwaysLoad pin checked nothing" ;;
  *)
    STRAY="$(grep -vxF "$ALWAYS_LOAD_ALLOWED" <<<"$ALWAYS_LOAD" | grep -v '^$' || true)"
    if [ -n "$STRAY" ]; then
      bad "alwaysLoad is set on a server outside the credential-free allowlist ($ALWAYS_LOAD_ALLOWED): $(tr '\n' ' ' <<<"$STRAY")"
    elif [ "$ALWAYS_LOAD" != "$ALWAYS_LOAD_ALLOWED" ]; then
      bad "the alwaysLoad allowlist names $ALWAYS_LOAD_ALLOWED but .mcp.json always-loads '$ALWAYS_LOAD' — update the allowlist and the skill together"
    else
      ok "only $ALWAYS_LOAD_ALLOWED sets alwaysLoad in .mcp.json (credentialed and write-capable servers stay deferred)"
    fi ;;
esac

# =============================================================================
echo ""
echo "  PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ] || { echo "SUITE FAILED"; exit 1; }
echo "SUITE PASSED"
