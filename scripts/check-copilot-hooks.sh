#!/usr/bin/env bash
# check-copilot-hooks.sh — keep the GitHub Copilot CLI hook files honest.
#
# WHAT IT GUARDS (#8769)
# `.github/hooks/*.json` is Copilot CLI's repository hook config. It is
# hand-authored, and it drifted: `on-stop.sh` (a worktree-safety commit plus a
# GitHub taskboard sync, meant to run ONCE when the agent finishes) was wired to
# `postToolUse`, which fires after EVERY tool call. Nothing noticed, because a
# hook on the wrong event still runs and exits 0. This gate fails a PR when:
#   1. a hook file is not valid JSON, lacks `"version": 1` (this repo's files
#      all declare it), or lacks a `hooks` object whose values are arrays;
#   2. it names an event that is neither a documented Copilot event nor one of
#      its documented PascalCase aliases — an unknown name is silently ignored;
#   3. an end-of-turn script is wired to anything but an end-of-turn event, OR
#      is not wired to an end-of-turn event at all — unwiring or renaming it
#      would otherwise leave rule 3 matching nothing and passing (#9, #18);
#   4. a hook command runs a relative `*.sh` that does not exist, resolved
#      against the handler's `cwd` (repository-relative, default `.`).
# Every documented way a handler names what it runs is read: `bash`,
# `powershell`, `command` (the cross-platform fallback) and `exec` + `args`.
#
# SOURCE: docs.github.com/en/copilot/reference/hooks-configuration (read
# 2026-09-26). Events: sessionStart, sessionEnd, userPromptSubmitted,
# userPromptTransformed, preToolUse, postToolUse, postToolUseFailure, agentStop,
# subagentStart, subagentStop, errorOccurred, preCompact, permissionRequest,
# notification. PascalCase aliases ("VS Code compatible"): SessionStart,
# SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
# Stop (= agentStop), SubagentStop, ErrorOccurred, PreCompact, Notification.
# Add a name only after it appears in that reference.
#
# TEST SEAMS (hermetic): COPILOT_HOOKS_DIR=<dir> scans that directory instead of
# .github/hooks; COPILOT_HOOKS_REPO_ROOT=<dir> resolves referenced scripts
# against it. Exit 0 = clean, 1 = a violation (each printed once), 2 = no node.
set -uo pipefail

ROOT="${COPILOT_HOOKS_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
DIR="${COPILOT_HOOKS_DIR:-$ROOT/.github/hooks}"

if ! command -v node >/dev/null 2>&1; then
  echo "::error::node not found — cannot check the Copilot hook files"
  exit 2
fi

node - "$DIR" "$ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [dir, root] = process.argv.slice(2);

const EVENTS = new Set([
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'userPromptTransformed',
  'preToolUse', 'postToolUse', 'postToolUseFailure', 'agentStop', 'subagentStart',
  'subagentStop', 'errorOccurred', 'preCompact', 'permissionRequest', 'notification',
  // Documented PascalCase aliases.
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'Stop', 'SubagentStop', 'ErrorOccurred', 'PreCompact', 'Notification',
]);
// Scripts with end-of-turn semantics, and the events that mean "end of turn".
const END_OF_TURN_SCRIPTS = ['on-stop.sh'];
const END_OF_TURN_EVENTS = new Set(['agentStop', 'Stop', 'sessionEnd', 'SessionEnd']);
// A repository-relative shell script: `.claude/hooks/x.sh`, `./scripts/x.sh`.
// Absolute paths and anything with a variable in it are not ours to resolve.
const SCRIPT_REF = /(?:^|[\s'"=(])((?:\.\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.sh)(?=$|[\s'");])/g;

function commandsOf(h) {
  if (!h || typeof h !== 'object') return [];
  const out = ['bash', 'powershell', 'command'].map((k) => h[k]).filter((c) => typeof c === 'string');
  if (typeof h.exec === 'string') {
    out.push([h.exec, ...(Array.isArray(h.args) ? h.args.filter((a) => typeof a === 'string') : [])].join(' '));
  }
  return out;
}

const problems = [];
let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
} catch {
  problems.push(`${dir}: cannot read the hook directory`);
}
// A gate that scans nothing passes vacuously (lessons-learned #9).
if (files.length === 0 && problems.length === 0) problems.push(`${dir}: no hook files found`);

let handlers = 0;
// End-of-turn scripts seen on an end-of-turn event, across every file.
const wiredAtEnd = new Set();
for (const file of files) {
  const where = path.join(path.basename(dir), file);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    problems.push(`${where}: not valid JSON (${e.message})`);
    continue;
  }
  if (doc.version !== 1) problems.push(`${where}: "version" must be 1`);
  if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)) {
    problems.push(`${where}: missing a "hooks" object`);
    continue;
  }
  for (const [event, list] of Object.entries(doc.hooks)) {
    if (!EVENTS.has(event)) {
      problems.push(`${where}: "${event}" is not a documented Copilot hook event or alias, so it never runs`);
    }
    if (!Array.isArray(list)) {
      problems.push(`${where}: "${event}" must be an array of handlers`);
      continue;
    }
    for (const h of list) {
      handlers += 1;
      // A handler's commands run in its `cwd`, which is repository-relative.
      const base = path.resolve(root, h && typeof h.cwd === 'string' ? h.cwd : '.');
      const commands = commandsOf(h);
      if (commands.length === 0) problems.push(`${where}: a "${event}" handler names nothing to run`);
      for (const cmd of commands) {
        for (const script of END_OF_TURN_SCRIPTS) {
          if (!cmd.includes(script)) continue;
          if (END_OF_TURN_EVENTS.has(event)) {
            wiredAtEnd.add(script);
          } else {
            problems.push(
              `${where}: ${script} runs at the end of a turn, but is wired to "${event}"` +
                ` — use one of: ${[...END_OF_TURN_EVENTS].join(', ')}`,
            );
          }
        }
        for (const m of cmd.matchAll(SCRIPT_REF)) {
          if (!fs.existsSync(path.resolve(base, m[1]))) {
            problems.push(`${where}: "${event}" runs ${m[1]}, which does not exist`);
          }
        }
      }
    }
  }
}

// Rule 3 checks only the handlers that name an end-of-turn script. If none
// does — the script was unwired, or renamed along with its hook entry — that
// rule matched nothing, so fail rather than pass having checked nothing.
if (files.length > 0) {
  for (const script of END_OF_TURN_SCRIPTS) {
    if (!wiredAtEnd.has(script)) {
      problems.push(
        `${path.basename(dir)}: no hook runs ${script} on an end-of-turn event (${[...END_OF_TURN_EVENTS].join(', ')})` +
          ' — wire it, or if it was renamed, update END_OF_TURN_SCRIPTS in scripts/check-copilot-hooks.sh',
      );
    }
  }
}

if (problems.length) {
  // A handler's bash and powershell commands usually match; report each once.
  for (const p of new Set(problems)) console.log(`::error::${p}`);
  process.exit(1);
}
console.log(`✓ Copilot hook files are valid: ${files.length} file(s), ${handlers} handler(s).`);
NODE
