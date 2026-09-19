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
  cp "$ADAPTER" "$d/.codex/hooks/run-claude-hook.mjs"
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

echo "== generator: MCP server parity =="
F="$(mkfix)"; gen "$F" --write
printf '{"mcpServers":{"alpha":{"command":"npx"},"beta":{"command":"npx"}}}\n' > "$F/.mcp.json"
printf 'model = "x"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "a config.toml with no MCP block passes…"
expect_out "declares no [mcp_servers.*]" "…but says so out loud instead of reading as parity"
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
printf '[mcp_servers.alpha]\ncommand = "npx"\n[mcp_servers.beta]\ncommand = "npx"\n' > "$F/.codex/config.toml"
gen "$F" --check; expect_rc 0 "matching server names pass"

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
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.if '"Bash(git push *)"'
json_set "$F/.claude/settings.json" hooks.PreToolUse.0.hooks.0.async true
json_set "$F/.claude/settings.json" hooks.PostToolUse '[{"matcher":"Bash","if":"Bash(gh api *)","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]},{"matcher":"Bash","hooks":[{"type":"command","command":"bash .claude/hooks/ok.sh"}]}]'
gen "$F" --write; expect_rc 0 "\`if\` and \`async\` are accepted because both are classified"
CJ="$F/.codex/hook-conditions.json"
if [ "$(json_get "$CJ" 'PreToolUse.ok\.sh.0')" = "Bash(git push *)" ]; then
  ok "a group's \`if\` is written to hook-conditions.json, keyed by event and script"
else
  bad "the if condition was not recorded: $(cat "$CJ" 2>/dev/null)"
fi
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
F="$(mkfix)"; json_set "$F/.claude/settings.json" hooks.PreToolUse.0.if '"Edit(web/**)"'
gen "$F" --check; expect_rc 2 "an \`if\` written for a tool other than Bash stops the generator — it would be silently skipped for a carried patch"
expect_out 'Edit(web/**)' "…naming the condition"

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
  printf '[mcp_servers.alpha]\ncommand = "npx"\n[mcp_servers.beta]\ncommand = "npx"\n' > "$F/.codex/config.toml"
  git -C "$F" add -A; git -C "$F" commit -q -m fixture
  gen "$F" --check; expect_rc 0 "committed config in parity passes"
  printf 'model = "x"\n[mcp_servers.alpha]\ncommand = "npx"\n' > "$F/.codex/config.toml"
  gen "$F" --check; expect_rc 0 "an UNCOMMITTED local edit to config.toml (the taskboard guide suggests one) does not turn a local check red"
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
if [ "$RC" -eq 2 ]; then
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
if [ "$RC" -eq 2 ]; then
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
  if [ "$RC" -eq 0 ] && ! grep -qF "protected" "$LOG"; then
    ok "$NOTWS is not White_Space: that line is not a header to Codex, and is not made one here"
  else
    bad "$NOTWS was trimmed as if it were White_Space: exit $RC (0 wanted), saw: $(cat "$LOG" 2>/dev/null)"
  fi
done

# 3. A PATH may contain anything but a line feed. JavaScript's `.` stops at U+2028,
#    U+2029 and a lone CR, so a header whose path held one did not match at all.
for ODD in '\u2028' '\u2029' '\r'; do
  rm -f "$LOG"
  adapt probe.sh "$(patch_payload PreToolUse "*** Begin Patch\n*** Add File: docs/ok.md\n+fine\n*** Add File: docs/od${ODD}d.md\n+bad\n*** End Patch")"
  if [ "$RC" -eq 0 ] && [ "$(runs ENV)" = "2" ]; then
    ok "a header whose PATH contains $ODD is still a header — both files are shown"
  else
    bad "a path containing $ODD hid its file: exit $RC, $(runs ENV) path(s) shown (2 wanted)"
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
if [ "$RC" -eq 0 ] && [ "$(runs ENV)" = "1" ]; then
  ok "a '*** Move to:' AFTER the first chunk line is a context line, as in Codex"
else
  bad "a late Move line was treated as a move: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt probe.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Update File: docs/a.md\n*** Move to: docs/b.md\n*** Move to: protected/y.ts\n@@\n+z\n*** End Patch')"
if [ "$RC" -eq 0 ] && [ "$(runs ENV)" = "1" ] && ! grep -qF "protected/y.ts" "$LOG"; then
  ok "a SECOND '*** Move to:' is not a move — Codex rejects that patch outright, and the fallback still shows its header path"
else
  bad "a second Move line was treated as a move: exit $RC, saw: $(cat "$LOG" 2>/dev/null)"
fi
rm -f "$LOG"
adapt guard.sh "$(patch_payload PreToolUse '*** Begin Patch\n*** Delete File: protected/x.ts\n*** End Patch')"
if [ "$RC" -eq 2 ]; then
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
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'could not find a file path' <<<"$ERR"; then
  ok "PreToolUse: a patch with no recognisable path BLOCKS (exit 2) with the reason"
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
if [ "$RC" -eq 2 ] && grep -qF 'does not exist' <<<"$ERR"; then
  ok "PreToolUse: a missing script blocks — a check that cannot run has not passed"
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
if [ "$RC" -eq 2 ] && [ "$CHECKED" -ge 1 ] && [ "$CHECKED" -lt 6 ] && grep -qE 'out of time (after checking [0-9]+ of 6 paths|while checking path [0-9]+ of 6)' <<<"$ERR" && ! grep -qF 'settings.json' <<<"$ERR"; then
  ok "PreToolUse: a patch too large for the budget BLOCKS with paths unchecked ($CHECKED of 6 ran) — it does not pass on the ones it skipped"
else
  bad "budget exhaustion: exit $RC (2 wanted), $CHECKED of 6 ran, stderr: $ERR"
fi
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
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'empty' <<<"$ERR"; then
  ok "an EMPTY payload blocks: the event is unknown, so the gating one is assumed, and the script does not run on nothing"
else
  bad "empty payload: exit $RC (2 wanted), ran=$([ -e "$LOG" ] && echo yes || echo no), stderr: $ERR"
fi
adapt probe.sh '[1,2,3]'
if [ "$RC" -eq 2 ]; then ok "a payload that is JSON but not an object blocks too"; else bad "array payload: exit $RC (2 wanted)"; fi
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
CRLF line endings throughout|apply_patch \\\r\n<<'EOF'\r\n*** Begin Patch\r\n*** Update File: protected/x.ts\r\n@@\r\n+evil\r\n*** End Patch\r\nEOF\r\n
blank lines after the closing delimiter|apply_patch <<'EOF'\n@P@\nEOF\n\n
an indented file header after Begin Patch (Codex trims there)|apply_patch <<'EOF'\n*** Begin Patch\n   *** Update File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF
a NEL-prefixed file header (Rust trims it)|apply_patch <<'EOF'\n*** Begin Patch\n\u0085*** Update File: protected/x.ts\n@@\n+evil\n*** End Patch\nEOF
SHAPES_TABLE
# The loop must have walked its table, or 14 shapes read as zero problems.
if [ "$SHAPES" -eq 14 ]; then ok "all 14 accepted shapes were driven"; else bad "the accepted table was not walked: $SHAPES of 14"; fi

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
a body Codex's parser rejects (a stray line in an Add hunk)|apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: protected/new.ts\n+ok\nstray\n*** End Patch\nEOF
COST — a heredoc that only WRITES a patch file|cat > fix.patch <<'EOF'\n@P@\nEOF
COST — a how-to that quotes a patch|cd docs && cat > howto.md <<'DOC'\nUse apply_patch like this:\n@P@\nDOC
COST — a multi-line commit message that quotes one|git commit -m \"fix: apply_patch handling\n\n@P@\"
REFUSED_TABLE
if [ "$REFUSED" -eq 55 ]; then ok "all 55 refused shapes were driven"; else bad "the refused table was not walked: $REFUSED of 55"; fi

# Codex sends the command as a string. If that shape ever changes, a file hook
# that cannot read it must block, not exit 0 over a patch it never looked at.
rm -f "$LOG"
adapt guard.sh "$(printf '{"cwd":"%s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":["apply_patch","*** Begin Patch"]}}' "$CWD_NATIVE")"
if [ "$RC" -eq 2 ] && [ ! -e "$LOG" ] && grep -qF 'no command string' <<<"$ERR"; then
  ok "a Bash payload whose command is not a string BLOCKS in mode edit"
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
COND_FILE="$H/edit-conditions.json"
printf '{"PreToolUse":{"guard.sh":["Bash(git push *)"]}}' > "$COND_FILE"
rm -f "$LOG"
adapt guard.sh "$(carried_payload PreToolUse "$(heredoc '' '*** Update File: protected/x.ts\n@@\n+evil')")"
if [ "$RC" -eq 2 ]; then
  ok "an \`if\` condition does not switch a file hook off for a carried patch"
else
  bad "a Bash condition suppressed the check of a carried patch: exit $RC"
fi
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
if [ "$RC" -eq 2 ] && grep -qF 'could not start bash' <<<"$ERR"; then
  ok "PreToolUse: a bash that cannot be started blocks"
else
  bad "missing bash: exit $RC (2 wanted), stderr: $ERR"
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
rm -f "$LOG" "$LOG.stdin"
adapt probe.sh "$(bash_payload PreToolUse 'git status')"
if [ -e "$LOG" ]; then ok "a condition recorded for one event does not filter another"; else bad "a PostToolUse condition filtered a PreToolUse run"; fi
rm -f "$LOG" "$LOG.stdin"
printf '{"PostToolUse":{"probe.sh":["this is not a condition"]}}' > "$COND_FILE"
adapt probe.sh "$(bash_payload PostToolUse 'git status')"
if [ -e "$LOG" ]; then ok "a condition the adapter cannot parse means RUN, not skip"; else bad "an unparseable condition suppressed the script"; fi
rm -f "$LOG" "$LOG.stdin"
printf '{"PostToolUse":{"probe.sh":["Edit(src/*)"]}}' > "$COND_FILE"
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
  const conditional = lists.length;
  const patterns = new Set(lists.flat()).size;
  const agents = fs.readdirSync(root + "/.codex/agents").filter((f) => f.endsWith(".toml")).length;
  const lock = JSON.parse(fs.readFileSync(root + "/tools/agentic-sync/port.lock.json", "utf8")).generated;
  const skills = new Set(Object.keys(lock).filter((k) => k.startsWith(".agents/skills/")).map((k) => k.split("/")[2])).size;
  const problems = [];
  const want = (re, label) => { if (!re.test(doc)) problems.push(label); };
  want(new RegExp("### Ported \\(" + total + " handlers\\)"), "Ported heading should say " + total);
  want(new RegExp(words[bash] + " of the " + total + " handlers match `Bash`", "i"), "Bash-matched count should be " + words[bash] + " of " + total);
  want(new RegExp(words[conditional] + " hooks carry\\s+one, over " + words[patterns] + " distinct patterns", "i"), "if-condition counts should be " + words[conditional] + " / " + words[patterns]);
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
  process.stdout.write(problems.length ? problems.join("; ") : "OK " + total + "/" + bash + "/" + conditional + "/" + patterns + "/" + agents + "/" + skills);
' "$REPO_ROOT" 2>&1)"
case "$DOC_COUNTS" in
  "OK "*) ok "handler, Bash-matched, if-condition, agent and skill counts in the support matrix match the generated files (${DOC_COUNTS#OK })" ;;
  *) bad "the support matrix states a number the generated files contradict: $DOC_COUNTS" ;;
esac

echo "== CI wiring =="
# Executable lines only: strip whole-line comments before counting.
CI_CODE="$(grep -vE '^[[:space:]]*#' "$CI_YML")"
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

# =============================================================================
echo ""
echo "  PASS=$PASS FAIL=$FAIL SKIP=$SKIP"
[ "$FAIL" -eq 0 ] || { echo "SUITE FAILED"; exit 1; }
echo "SUITE PASSED"
