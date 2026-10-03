#!/usr/bin/env bash
# check-copilot-hooks.sh — keep the GitHub Copilot hook files honest.
#
# WHAT IT GUARDS (#8769)
# `.github/hooks/*.json` is the repository hook config for BOTH Copilot CLI and
# the Copilot cloud agent. It is hand-authored, and it drifted: `on-stop.sh` (a
# worktree-safety commit plus a GitHub taskboard sync, meant for the end of a
# turn) was wired to `postToolUse`, which fires after EVERY tool call. Nothing
# noticed, because a hook on the wrong event still runs and exits 0.
#
# WHO OWNS EACH EVENT (the double-run rule)
# Copilot CLI ALSO reads the `hooks` block of `.claude/settings.json` and
# `.claude/settings.local.json`, and when one event appears in several sources
# it runs the entries from ALL of them (hooks-reference.md, "Hooks locations";
# cli-config-dir-reference.md:439). The Copilot cloud agent reads ONLY
# `.github/hooks/*.json`. The rule is per SCRIPT, not per event:
#   - When one script is wired to the same event in both files, Copilot CLI
#     uses the `.claude/settings.json` entry (the same one Claude Code runs, so
#     Claude Code behaviour is unchanged) and the `.github/hooks` handler for
#     it must be cloud-agent-only, or Copilot CLI runs the script twice.
#   - A `.github/hooks` handler whose script `.claude/settings.json` does not
#     wire to that event runs on BOTH surfaces, even when settings.json wires
#     other scripts to the same event: session-setup.json (`npm ci` on
#     sessionStart) and validation.json (copilot-arch-check.sh on postToolUse).
# Cloud-agent-only means: only a `bash` field (the cloud agent ignores
# `powershell`, `exec` is CLI-only, and `command` is copied to PowerShell on
# Windows), and that field starts with CLOUD_ONLY_GUARD, which exits 0 unless
# COPILOT_AGENT_PROMPT is set. The guard ends at its `;`, so what follows it
# may start with any whitespace or none (`exit 0;bash`, `exit 0; bash`, or a
# newline). The cloud agent sets that variable for hook scripts
# (hooks-reference.md, "Cloud agent execution environment"); Copilot CLI's
# references do not list it.
#
# This gate fails a PR when:
#   1. a hook file is not valid JSON, lacks `"version": 1` (this repo's files
#      all declare it), or lacks a `hooks` object whose values are arrays;
#   2. it names an event that is neither a documented Copilot event nor one of
#      its documented PascalCase aliases — an unknown name is silently ignored;
#   3. an end-of-turn script is wired to anything but an end-of-turn event, OR
#      no handler runs it on an end-of-turn event at all. "Runs it" means a
#      script reference whose file name is exactly the script, that exists, and
#      that no `#` comment precedes: `on-stop.sh.disabled` or
#      `true # bash on-stop.sh` would otherwise count (#9, #18);
#   4. a hook command runs a relative `*.sh` that does not exist, resolved
#      against the handler's `cwd` (repository-relative, default `.`);
#   5. a handler runs a script that `.claude/settings.json` also wires to the
#      same event (aliases folded, so `Stop` = `agentStop`) and is not
#      cloud-agent-only as defined above — or, the other direction, a handler
#      IS cloud-agent-only but runs a script `.claude/settings.json` does not
#      wire to that event, so Copilot CLI would never run it (and rule 3 would
#      count an end-of-turn handler that always exits 0 under the CLI). If
#      `.claude/settings.json` has hook commands but none of them yields a
#      script path, the cross-check would compare against nothing, so that
#      fails too.
# Every documented way a command handler names what it runs is read: `bash`,
# `powershell`, `command` (the cross-platform fallback) and `exec` + `args`.
# `http` and `prompt` handlers run no script and are not cross-checked.
# NOT SEEN: `.claude/settings.local.json` (gitignored, per-machine);
# `.github/copilot/settings.json` and `.github/copilot/settings.local.json`,
# whose top-level `hooks` Copilot CLI also reads (hooks-reference.md, "Hooks
# locations"; cli-config-dir-reference.md:436) — the first is committed, and
# none exists in this repository today; user-level `~/.copilot` hooks and
# plugins. A double run wired there is outside this gate.
#
# SOURCE: github/docs at 0b8c768 (2026-10-01; docs.github.com is not reachable
# from this repo's agent sandboxes), content/copilot/reference/hooks-reference.md
# — "Hooks locations", "Cloud agent execution environment", "Hook events" and
# the `### event / Alias` headings. Events: sessionStart, sessionEnd,
# userPromptSubmitted, userPromptTransformed, preToolUse, postToolUse,
# postToolUseFailure, agentStop, subagentStart, subagentStop, errorOccurred,
# preCompact, permissionRequest, notification. PascalCase aliases ("VS Code
# compatible"): SessionStart, SessionEnd, UserPromptSubmit, PreToolUse,
# PostToolUse, PostToolUseFailure, Stop (= agentStop), SubagentStop,
# ErrorOccurred, PreCompact, Notification, PermissionRequest. Add a name only
# after it appears in that reference.
#
# TEST SEAMS (hermetic): COPILOT_HOOKS_DIR=<dir> scans that directory instead of
# .github/hooks; COPILOT_HOOKS_REPO_ROOT=<dir> resolves referenced scripts and
# `.claude/settings.json` against it. Exit 0 = clean, 1 = a violation (each
# printed once, as a GitHub `::error file=…::` annotation when it names a
# file), 2 = no node.
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

// Documented PascalCase alias -> the camelCase event it names.
const ALIASES = {
  SessionStart: 'sessionStart', SessionEnd: 'sessionEnd', UserPromptSubmit: 'userPromptSubmitted',
  PreToolUse: 'preToolUse', PostToolUse: 'postToolUse', PostToolUseFailure: 'postToolUseFailure',
  Stop: 'agentStop', SubagentStop: 'subagentStop', ErrorOccurred: 'errorOccurred',
  PreCompact: 'preCompact', Notification: 'notification', PermissionRequest: 'permissionRequest',
};
const CANONICAL = [
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'userPromptTransformed',
  'preToolUse', 'postToolUse', 'postToolUseFailure', 'agentStop', 'subagentStart',
  'subagentStop', 'errorOccurred', 'preCompact', 'permissionRequest', 'notification',
];
const EVENTS = new Set([...CANONICAL, ...Object.keys(ALIASES)]);
const canonical = (event) => ALIASES[event] || event;
// Scripts with end-of-turn semantics, and the events that mean "end of turn".
const END_OF_TURN_SCRIPTS = ['on-stop.sh'];
const END_OF_TURN_EVENTS = new Set(['agentStop', 'Stop', 'sessionEnd', 'SessionEnd']);
// The prefix that makes a `.github/hooks` handler a no-op outside the cloud agent.
// It ends at the `;` that terminates the guard, so whatever follows (no space,
// a space, a newline) is a separate command that runs only when the guard
// passed. The error message prints exactly this text, so a handler that starts
// with what the message says is accepted.
const CLOUD_ONLY_GUARD = '[ -n "${COPILOT_AGENT_PROMPT+x}" ] || exit 0;';
// How `.claude/settings.json` anchors its scripts at the repository root.
const SETTINGS_ROOT_PREFIXES = ['$(git rev-parse --show-toplevel)/', '${CLAUDE_PROJECT_DIR}/', '$CLAUDE_PROJECT_DIR/'];
// A repository-relative shell script: `.claude/hooks/x.sh`, `./scripts/x.sh`.
// Absolute paths and anything with a variable in it are not ours to resolve.
const SCRIPT_REF = /(?:^|[\s'"=(])((?:\.\/)?(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.sh)(?=$|[\s'");])/g;

// Paths print repository-relative (".github/hooks/hooks.json"), never as a
// bare "hooks/hooks.json" that could be .claude/hooks or .codex/hooks. Always
// with `/`: on Windows `path.relative` answers `.github\hooks\hooks.json`, which
// is not the path GitHub annotates and not the path the messages promise.
const rel = (p) => path.relative(root, p).split(path.sep).join('/') || '.';

function commandsOf(h) {
  if (!h || typeof h !== 'object') return [];
  const out = ['bash', 'powershell', 'command'].map((k) => h[k]).filter((c) => typeof c === 'string');
  if (typeof h.exec === 'string') {
    out.push([h.exec, ...(Array.isArray(h.args) ? h.args.filter((a) => typeof a === 'string') : [])].join(' '));
  }
  return out;
}

// Script references in a command, each with whether a shell comment precedes it.
function scriptRefs(cmd) {
  return [...cmd.matchAll(SCRIPT_REF)].map((m) => ({
    ref: m[1],
    commented: /(?:^|\s)#/.test(cmd.slice(0, m.index + m[0].length - m[1].length)),
  }));
}

// Each problem is printed once. `annotate` is false for a directory, which
// GitHub cannot annotate.
const problems = new Map();
const report = (where, message, annotate = true) =>
  problems.set(`${where}\0${message}`, { where, message, annotate });

// ---- `.claude/settings.json`: which script runs on which event (rule 5).
const settingsFile = path.join(root, '.claude', 'settings.json');
const settingsWired = new Map(); // "canonical event\0repo-relative script" -> settings event name
let settingsCommands = 0;
if (fs.existsSync(settingsFile)) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (e) {
    report(rel(settingsFile), `not valid JSON (${e.message}), so it cannot be checked for hooks Copilot CLI would run twice`);
  }
  const hooks = settings && settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      // Claude format nests handlers under `hooks`; Copilot format does not.
      const nested = item && Array.isArray(item.hooks) ? item.hooks : [item];
      for (const h of nested) {
        for (let cmd of commandsOf(h)) {
          settingsCommands += 1;
          for (const prefix of SETTINGS_ROOT_PREFIXES) cmd = cmd.split(prefix).join('');
          for (const { ref, commented } of scriptRefs(cmd)) {
            if (!commented) settingsWired.set(`${canonical(event)}\0${rel(path.resolve(root, ref))}`, event);
          }
        }
      }
    }
  }
  // A cross-check that read no script compares against nothing (#9, #18).
  if (settingsCommands > 0 && settingsWired.size === 0) {
    report(
      rel(settingsFile),
      `has ${settingsCommands} hook command(s) but no script path could be read from any of them, so the` +
        ' double-run check would compare against nothing. Update SETTINGS_ROOT_PREFIXES in scripts/check-copilot-hooks.sh',
    );
  }
}

// ---- `.github/hooks/*.json`
let files = [];
try {
  files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
} catch {
  report(rel(dir), 'cannot read the hook directory', false);
}
// A gate that scans nothing passes vacuously (lessons-learned #9).
if (files.length === 0 && problems.size === 0) report(rel(dir), 'no hook files found', false);

let handlers = 0;
// End-of-turn scripts seen on an end-of-turn event, and on any other event.
const wiredAtEnd = new Set();
const misWired = new Set();
for (const file of files) {
  const where = rel(path.join(dir, file));
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    report(where, `not valid JSON (${e.message})`);
    continue;
  }
  if (doc.version !== 1) report(where, '"version" must be 1');
  if (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks)) {
    report(where, 'missing a "hooks" object');
    continue;
  }
  for (const [event, list] of Object.entries(doc.hooks)) {
    if (!EVENTS.has(event)) {
      report(where, `"${event}" is not a documented Copilot hook event or alias, so it never runs`);
    }
    if (!Array.isArray(list)) {
      report(where, `"${event}" must be an array of handlers`);
      continue;
    }
    for (const h of list) {
      handlers += 1;
      // A handler's commands run in its `cwd`, which is repository-relative.
      const base = path.resolve(root, h && typeof h.cwd === 'string' ? h.cwd : '.');
      const commands = commandsOf(h);
      // An `http` handler (posts to its `url`) and a `prompt` handler (hands
      // its `prompt` to the model) run no script, so they have nothing to
      // cross-check (hooks-reference.md, "HTTP hooks" and "Prompt hooks").
      const scriptless = h && (h.type === 'http' || h.type === 'prompt');
      if (commands.length === 0 && !scriptless) report(where, `a "${event}" handler names nothing to run`);
      const doubled = new Map(); // repo-relative script -> the settings event that also runs it
      const runs = new Set(); // repo-relative scripts this handler runs (uncommented, existing)
      for (const cmd of commands) {
        for (const { ref, commented } of scriptRefs(cmd)) {
          const resolved = path.resolve(base, ref);
          const exists = fs.existsSync(resolved);
          if (!exists) report(where, `"${event}" runs ${ref}, which does not exist`);
          if (commented) continue;
          if (exists) runs.add(rel(resolved));
          const name = path.basename(ref);
          if (END_OF_TURN_SCRIPTS.includes(name)) {
            if (!END_OF_TURN_EVENTS.has(event)) {
              misWired.add(name);
              report(
                where,
                `${name} runs at the end of a turn, but is wired to "${event}"` +
                  ` — use one of: ${[...END_OF_TURN_EVENTS].join(', ')}`,
              );
            } else if (exists) {
              wiredAtEnd.add(name);
            }
          }
          const also = settingsWired.get(`${canonical(event)}\0${rel(resolved)}`);
          if (also) doubled.set(rel(resolved), also);
        }
      }
      const cloudOnly =
        typeof h.bash === 'string' && h.bash.startsWith(CLOUD_ONLY_GUARD) &&
        !['powershell', 'command', 'exec'].some((k) => h[k] !== undefined);
      if (cloudOnly) {
        // The other direction of the same rule: the guard hands the script to
        // `.claude/settings.json` under Copilot CLI, so settings.json must run
        // it on this event, or Copilot CLI never runs it (and rule 3 would
        // count a handler that, under the CLI, always exits 0).
        for (const script of runs) {
          if (doubled.has(script)) continue;
          report(
            where,
            `"${event}" handler is cloud-agent-only, but .claude/settings.json does not run ${script} on that event,` +
              ' so Copilot CLI never runs it — drop the guard or wire it in .claude/settings.json',
          );
        }
        continue;
      }
      for (const [script, settingsEvent] of doubled) {
        report(
          where,
          `"${event}" runs ${script}, which .claude/settings.json also runs on "${settingsEvent}". Copilot CLI` +
            ' reads both files and would run it twice. Make this handler cloud-agent-only: a single "bash" field' +
            ` (no powershell, command or exec) that starts with: ${CLOUD_ONLY_GUARD}`,
        );
      }
    }
  }
}

// Rule 3 checks only the handlers that name an end-of-turn script. If none
// does — the script was unwired, or renamed along with its hook entry — that
// rule matched nothing, so fail rather than pass having checked nothing. A
// script already reported as mis-wired is not reported a second time here.
if (files.length > 0) {
  for (const script of END_OF_TURN_SCRIPTS) {
    if (!wiredAtEnd.has(script) && !misWired.has(script)) {
      report(
        rel(dir),
        `no hook runs ${script} on an end-of-turn event (${[...END_OF_TURN_EVENTS].join(', ')})` +
          ' — wire it, or if it was renamed, update END_OF_TURN_SCRIPTS in scripts/check-copilot-hooks.sh',
        false,
      );
    }
  }
}

if (problems.size) {
  // `file=` makes GitHub annotate the file; the message repeats the path so
  // the line also reads on its own in a terminal.
  for (const { where, message, annotate } of problems.values()) {
    console.log(`::error${annotate ? ` file=${where}` : ''}::${where}: ${message}`);
  }
  process.exit(1);
}
console.log(
  `✓ Copilot hook files are valid: ${files.length} file(s), ${handlers} handler(s);` +
    ` cross-checked against ${settingsWired.size} script hook(s) in .claude/settings.json.`,
);
NODE
