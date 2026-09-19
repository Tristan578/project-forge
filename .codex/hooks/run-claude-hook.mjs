#!/usr/bin/env node
// Runs one shared `.claude/hooks/<name>.sh` script under OpenAI Codex CLI.
//
// WHY AN ADAPTER AND NOT A DIRECT CALL
// The hook scripts were written against Claude Code's payload. Codex's differs
// in exactly the places that fail silently. Each statement below was read from
// openai/codex at tag rust-v0.144.1; the file is named so it can be re-checked.
//
//   * A file edit arrives as tool `apply_patch` with `tool_input.command` set to
//     the PATCH TEXT. There is no `tool_input.file_path` and there are no
//     `TOOL_INPUT_*` environment variables (core/src/tools/hook_names.rs,
//     hooks/src/events/pre_tool_use.rs). Every Edit/Write hook here starts with
//     "no file_path → exit 0", so called directly all nine would pass on every
//     edit, forever, and read as enforcement (lessons-learned #1 and #9).
//   * ONLY exit 2 with a non-empty stderr blocks. Any other non-zero exit marks
//     the hook run Failed and THE ACTION PROCEEDS (pre_tool_use.rs). So a fault
//     in this adapter must not exit 1 on the event that gates actions.
//   * Plain stdout is dropped; only JSON reaches the model, and each event
//     accepts a different, `deny_unknown_fields` shape (hooks/src/schema.rs).
//     A hook that "warns" in plain text would otherwise warn nobody.
//
// WHAT IT DOES
//   apply_patch → parse the patch the way Codex's own parser does (headers are
//     matched on the TRIMMED line — apply-patch/src/streaming_parser.rs — or an
//     indented header would hide a hunk from every hook) and run the script
//     ONCE PER TOUCHED PATH: added and updated files, deleted files, and BOTH
//     ends of a move. Payload per run: `tool_name` Write (Add) or Edit,
//     `tool_input.file_path` absolute and forward-slashed, and
//     `TOOL_INPUT_file_path` set.
//   Bash → the payload already matches (`tool_input.command`); passed through.
//   Bash CARRYING A PATCH → Codex has a second edit channel. Its exec tool
//     reports `apply_patch <<'EOF' … EOF` to hooks as tool `Bash`, and only
//     AFTER the PreToolUse hooks have run does it intercept the command and
//     apply it as a real patch (core/src/tools/handlers/unified_exec/
//     exec_command.rs). A hook wired for `apply_patch` alone never sees that
//     edit. So the generator wires the PreToolUse edit hooks for `Bash` as well
//     and passes mode `edit`.
//
//     Codex intercepts two forms (apply-patch/src/invocation.rs — "must be the
//     only top-level statement"), with ANY heredoc delimiter the bash grammar
//     allows:
//         apply_patch <<'EOF' … EOF
//         cd <path> && apply_patch <<'EOF' … EOF        (also `applypatch`)
//     Its matcher is a tree-sitter query over the bash grammar. This file does
//     NOT try to reproduce it — three attempts to recognise "the shapes Codex
//     intercepts" with a regex were each narrower somewhere, and each gap was
//     an edit applied with every hook at exit 0. Instead the question is asked
//     of the PATCH: any shell command whose text contains a file header line
//     (`*** Add|Update|Delete File: <path>`) has every such path inspected,
//     whatever shell syntax surrounds it (see carriedPatch). `cd <literal> &&`
//     before the patch moves the base, as in Codex; any other directory change
//     before a patch that names apply_patch BLOCKS. What this leaves out is a
//     patch whose text is NOT in the command (`apply_patch < file.patch`) —
//     Codex does not intercept that either, and a shell can write files a
//     hundred ways, none of which an Edit/Write hook sees under Claude Code.
//
//     ONE THING THIS CANNOT SEE: the exec tool's `workdir` argument also moves
//     the base, and the hook payload does not carry it. So for a carried patch
//     an UPDATED or DELETED file that does not exist where the paths resolve is
//     treated as proof the base is wrong, and blocks — better than checking a
//     path that is not the one being edited. An ADDED file cannot be checked
//     that way; that residue is recorded in the support matrix.
//     (PostToolUse cannot see this channel at all: there the intercepted call
//     carries no command. Also recorded.)
//   `if` conditions from .claude/settings.json (e.g. `Bash(git push *)`) are
//     read from `.codex/hook-conditions.json`, which the generator writes.
//     Codex has no such key, and without it `post-push-resolve-comments.sh`
//     would run `gh` after every shell command.
//
// EXIT CODES
//   script exits 2            → exit 2 (block). The reason is its stderr; if
//                               that is empty, its STDOUT (some scripts here
//                               explain themselves there); if both are empty, a
//                               generic line — Codex ignores exit 2 with no
//                               stderr at all.
//   script exits other non-0  → that ONE run is a reported failure, exactly as a
//                               crashing hook is under Claude Code — and the
//                               REMAINING paths are still checked. Under Claude
//                               each file is its own hook invocation, so a
//                               crash on file A never suppresses a block on
//                               file B; returning at the first crash here would.
//                               Exit 2 from any run wins. Only if nothing
//                               blocked does a crash surface, as exit 1.
//   out of time               → each script run is bounded by the hook's own
//                               per-file timeout, and the whole patch by the
//                               budget hooks.json gives Codex. Paths left
//                               unchecked when the budget runs out are an
//                               adapter fault (exit 2 on PreToolUse): a patch
//                               too large to check has not been checked.
//   ADAPTER fault on PreToolUse (unreadable or EMPTY payload, no path found in
//     a patch, script or bash missing, budget exhausted)
//                              → exit 2 with the reason. Enforcement that
//                               cannot run must not read as enforcement that
//                               passed. On other events: exit 1.
//
// OUTPUT, per event (hooks/src/schema.rs)
//   additionalContext   SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
//                       SubagentStart. Plain-text stdout is wrapped into it
//                       here, merged across runs.
//   block               PreToolUse → hookSpecificOutput.permissionDecision
//                       "deny"; UserPromptSubmit, PostToolUse, SubagentStop,
//                       Stop → top-level decision "block" + reason.
//   systemMessage       every event. It is also where PLAIN TEXT goes on the
//                       events that accept no context (Stop, SubagentStop,
//                       PreCompact, PostCompact): shown to the person, not the
//                       model, which is better than reaching neither.
//   PreCompact / PostCompact accept NO context and NO block — systemMessage is
//                       all they take, so nothing a script prints there can
//                       reach the model. That is why the context-restoring
//                       PostCompact scripts are listed as NOT ported in
//                       tools/agentic-sync/port.json.
//   Never forwarded:    permissionDecision allow/ask and decision "approve"
//                       (Codex marks the run Failed on them; it has no
//                       hook-driven approval), updatedInput (honoured by Codex
//                       only alongside a deny, and no script here uses it),
//                       continue, stopReason, suppressOutput.
//
// Usage (from .codex/hooks.json, generated by tools/agentic-sync/port.mjs):
//   node .codex/hooks/run-claude-hook.mjs <script-name.sh> <per-run-seconds> <budget-seconds> [edit]
//   The two numbers are the script's own timeout in .claude/settings.json and
//   the timeout hooks.json declares to Codex for the whole invocation. `edit`
//   marks a hook that inspects FILES: on a Bash payload it acts only on a patch
//   carried inside the command.
//
// TEST SEAMS (never set by hooks.json)
//   CODEX_HOOK_SCRIPT_DIR  — directory holding the scripts (default .claude/hooks)
//   CODEX_HOOK_CONDITIONS  — path of the conditions file
//   CODEX_HOOK_BASH        — bash binary to use

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT_DIR = process.env.CODEX_HOOK_SCRIPT_DIR
  ? resolve(process.env.CODEX_HOOK_SCRIPT_DIR)
  : join(REPO_ROOT, '.claude', 'hooks');
const CONDITIONS = process.env.CODEX_HOOK_CONDITIONS
  ? resolve(process.env.CODEX_HOOK_CONDITIONS)
  : join(REPO_ROOT, '.codex', 'hook-conditions.json');

const CONTEXT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart']);
const TOP_LEVEL_BLOCK_EVENTS = new Set(['UserPromptSubmit', 'PostToolUse', 'SubagentStop', 'Stop']);
// An env string this large makes execve fail with E2BIG on Linux (128 KiB per
// string), which would surface as a non-blocking failure. The scripts read the
// command from stdin; the variable is a convenience, so it is simply omitted.
const MAX_ENV_VALUE = 32 * 1024;

let EVENT = '';
const STARTED = Date.now();

// A fault in the adapter itself. Blocks on the event that gates actions.
function fault(msg) {
  process.stderr.write(`run-claude-hook: ${msg}\n`);
  process.exit(EVENT === 'PreToolUse' ? 2 : 1);
}

// On Windows a bare `bash` can resolve to C:\Windows\System32\bash.exe (WSL),
// which cannot see this checkout's paths. Prefer the bash that ships with git.
function findBash() {
  if (process.env.CODEX_HOOK_BASH) return process.env.CODEX_HOOK_BASH;
  if (process.platform !== 'win32') return 'bash';
  try {
    const execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    // <git>/mingw64/libexec/git-core → <git>/bin/bash.exe
    const candidate = resolve(execPath, '..', '..', '..', 'bin', 'bash.exe');
    if (existsSync(candidate)) return candidate;
  } catch {
    // fall through
  }
  return 'bash';
}

// Rust's `str::trim()` strips the Unicode White_Space property; JavaScript's
// `trim()` strips a DIFFERENT set (it keeps U+0085 NEL, it drops U+FEFF). Codex
// matches patch headers on `line.trim()` (apply-patch/src/streaming_parser.rs),
// so with JS trim a header behind a NEL was a header to Codex and plain text
// here — the file was edited and no hook saw it. These two mirror Rust exactly.
const RUST_WS = '\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const RUST_TRIM = new RegExp(`^[${RUST_WS}]+|[${RUST_WS}]+$`, 'g');
const RUST_TRIM_END = new RegExp(`[${RUST_WS}]+$`);
const rustTrim = (s) => s.replace(RUST_TRIM, '');
const rustTrimEnd = (s) => s.replace(RUST_TRIM_END, '');

// Every path a patch touches, read the way Codex's streaming parser reads it:
//   * `*** Add|Update|Delete File: <path>` is matched on the line after Rust
//     `trim()` — anchoring at column 0 would let an indented header hide its hunk
//     from every hook while Codex applies it. The path is what follows the
//     marker, NOT trimmed again (Codex does not).
//   * `*** Move to: <path>` is matched after `trim_end()` ONLY — so not when
//     indented — and only directly under its Update header, before any chunk,
//     and once. Anywhere else Codex reads the same text as a context line, and
//     treating it as a move would hand the hooks the added lines under the
//     wrong path.
function parsePatch(patch) {
  const files = [];
  let current = null;
  let moveAllowed = false; // true only between an Update header and its first chunk line
  for (const rawLine of String(patch).split(/\r?\n/)) {
    const line = rustTrim(rawLine);
    const head = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (head) {
      current = { op: head[1], path: head[2], added: [] };
      files.push(current);
      moveAllowed = head[1] === 'Update';
      continue;
    }
    const move = moveAllowed ? /^\*\*\* Move to: (.+)$/.exec(rustTrimEnd(rawLine)) : null;
    moveAllowed = false;
    if (move) {
      // Both ends matter: the source is removed from where a hook may protect
      // it, the destination is written where another may.
      const dest = { op: 'Update', path: move[1], added: current.added, isMoveDest: true };
      current.op = 'Delete';
      current.isMoveSource = true; // for messages: the author wrote a move, not a removal
      current.added = [];
      files.push(dest);
      current = dest;
      continue;
    }
    if (/^\*\*\* (Begin|End) Patch$/.test(line) || line === '*** End of File') continue;
    if (current && rawLine.startsWith('+')) current.added.push(rawLine.slice(1));
  }
  return files;
}

// Does this shell command carry a patch?
//
// THE QUESTION IS ASKED OF THE PATCH, NOT OF THE SHELL. Three earlier versions
// asked "is this command one of the shapes Codex intercepts?" and answered with
// a regex over shell syntax. Codex answers it with a tree-sitter query over the
// bash grammar; each regex was narrower somewhere — an envelope cut short, an
// identifier-only heredoc delimiter, then a backslash-newline continuation, a
// quoted assignment, a leading redirect or comment — and each gap was an edit
// Codex applied while every hook exited 0. Shell syntax is open-ended; a
// recogniser for it is never finished (lessons-learned #21).
//
// A patch is not. Whatever the shell around it looks like, a patch that edits a
// file must SAY so, on a line of its own: `*** Add|Update|Delete File: <path>`.
// So the whole command is read with the same header matcher used for the patch
// tool, and:
//   no file header anywhere → null: an ordinary command. A patch with no file
//                             header edits nothing. (`grep '*** Begin Patch' x`
//                             lands here; so does `apply_patch --help`.)
//   one or more             → every path is inspected or the command is
//                             blocked; no shell syntax can make it neither.
//
// The shell still decides ONE thing — the directory the paths resolve in — and a
// fourth version got that wrong the same way: it looked for `cd`/`pushd` with a
// regex (a DENY-list over shell text), and an earlier `<<`, a `\cd`, `env -C`,
// `bash -c '…'` or `d=cd; $d x` each moved the base unseen. So this is a closed
// ALLOW-list instead. For a command that also contains the word apply_patch or
// applypatch (`named`), the text before the patch — continuations joined, as the
// shell joins them; never inside the patch, where joining `+x \` to the next
// line could swallow a header — must be, in full, one of:
//       apply_patch <<…
//       cd <literal path> && apply_patch <<…          (also `applypatch`)
// which are the two forms Codex itself intercepts. Then the base is known: the
// hook's cwd, or that literal directory. ANYTHING else → `{ refused: why }` and
// the caller BLOCKS: an assignment or redirect first, a statement or a comment
// line before it, an argument before the heredoc, the patch as a quoted
// argument, a cd that needs expanding, a subshell, `env -C` … none of them is
// parsed, so none of them can mislead.
//
// The cost is a false block, and it is a real one: a how-to, a test fixture or a
// commit message that QUOTES a whole patch next to the word apply_patch is
// refused too. The message says so and gives both ways out. It is recorded as a
// limit in docs/guides/codex-cli-support-matrix.md.
//
// NOT named (`a\pply_patch`, `$P`, a heredoc that only writes a patch file): the
// paths are inspected against the hook's cwd and nothing is ever blocked. Codex
// intercepts none of those; they are a shell writing files, which no Edit/Write
// hook sees under Claude Code either.
function carriedPatch(command) {
  const files = parsePatch(command);
  if (files.length === 0) return null;
  const named = /(^|[^\w.-])(?:apply_patch|applypatch)(?![\w.-])/.test(command);
  if (!named) return { files, named, dir: '' };

  const lines = command.split(/\r?\n/);
  const firstMarker = lines.findIndex((l) => rustTrim(l).startsWith('*** '));
  const prefix = lines.slice(0, firstMarker).join('\n').replace(/\\\r?\n/g, '');
  const m = /^\s*(?:cd\s+('[^'\n]*'|"[^"\n]*"|[^\s;&|<>()'"]+)\s*&&\s*)?(?:apply_patch|applypatch)\s*<<[^\n]*\n?$/.exec(prefix);
  if (!m) return { files, named, refused: 'the text before the patch is not one of the two forms whose working directory this hook can determine' };
  if (m[1] === undefined) return { files, named, dir: '' };
  // '…' is literal. "…" may still expand; a bare word may expand, glob or escape.
  const expands = m[1].startsWith("'") ? null : m[1].startsWith('"') ? /[$`]|\\[$`"\\]/ : /[$`~*?[\]{}\\]/;
  if (expands && expands.test(m[1])) return { files, named, refused: `its cd path (${m[1]}) needs the shell to expand it` };
  return { files, named, dir: m[1].replace(/^(["'])([\s\S]*)\1$/, '$2') };
}

// `Bash(git push *)` → should the script run for this command?
// Deliberately GENEROUS: Claude Code evaluates these against its own parse of
// the command, which is not reproducible here, so the literal text before the
// first `*` is looked for ANYWHERE in the command. Running a script that then
// decides it has nothing to do is harmless; not running one that would have
// blocked is not.
function conditionMatches(pattern, toolName, command) {
  const m = /^([A-Za-z_]+)\((.*)\)$/.exec(pattern);
  if (!m) return true; // unreadable condition → run
  if (m[1] !== toolName) return false;
  const literal = m[2].split('*')[0].trim();
  return literal === '' || String(command).includes(literal);
}

function conditionsFor(event, name) {
  try {
    const all = JSON.parse(readFileSync(CONDITIONS, 'utf8'));
    const list = all?.[event]?.[name];
    return Array.isArray(list) ? list : null;
  } catch {
    return null; // missing or unreadable → no condition → run
  }
}

function emit(event, { deny, contexts, messages, texts }) {
  const out = {};
  // Plain text a script printed. Where the event can carry context it is
  // context; where it cannot, it is a systemMessage rather than nothing.
  if (texts.length) (event === 'PreToolUse' || CONTEXT_EVENTS.has(event) ? contexts : messages).push(...texts);
  const context = contexts.join('\n\n');
  if (event === 'PreToolUse') {
    const hso = { hookEventName: event };
    if (deny) {
      hso.permissionDecision = 'deny';
      hso.permissionDecisionReason = deny;
    }
    if (context) hso.additionalContext = context;
    if (deny || context) out.hookSpecificOutput = hso;
  } else {
    if (deny && TOP_LEVEL_BLOCK_EVENTS.has(event)) {
      out.decision = 'block';
      out.reason = deny;
    }
    if (context && CONTEXT_EVENTS.has(event)) out.hookSpecificOutput = { hookEventName: event, additionalContext: context };
  }
  if (messages.length) out.systemMessage = messages.join('\n');
  if (Object.keys(out).length) process.stdout.write(`${JSON.stringify(out)}\n`);
}

function main() {
  const name = process.argv[2] || '';

  // Codex always sends a JSON payload. One that cannot be read, is empty, or
  // does not parse leaves the event unknown — and an unknown event may be the
  // gating one, so it is treated as such rather than allowed through.
  let raw = '';
  let readError = null;
  try {
    raw = readFileSync(0, 'utf8');
  } catch (e) {
    readError = e;
  }
  let input = {};
  if (readError || !raw.trim()) {
    EVENT = 'PreToolUse';
    fault(`hook payload is ${readError ? `unreadable (${readError.message})` : 'empty'} — refusing to let ${name} pass unread`);
  }
  try {
    input = JSON.parse(raw);
  } catch (e) {
    EVENT = 'PreToolUse';
    fault(`hook payload is not JSON (${e.message}) — refusing to let ${name} pass unread`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    EVENT = 'PreToolUse';
    fault(`hook payload is not a JSON object — refusing to let ${name} pass unread`);
  }
  // Codex always names the event. Without it nothing below can tell a gating
  // event from an advisory one, so every later fault would exit 1 and proceed.
  if (typeof input.hook_event_name !== 'string' || !input.hook_event_name) {
    EVENT = 'PreToolUse';
    fault(`hook payload names no hook_event_name — refusing to let ${name} pass on an event it cannot identify`);
  }
  EVENT = input.hook_event_name;

  if (!/^[\w.-]+\.sh$/.test(name)) fault(`expected a script name like check-foo.sh, got "${name}"`);
  const script = join(SCRIPT_DIR, name);
  if (!existsSync(script)) fault(`${script} does not exist — the check it carries cannot run`);

  const cwd = typeof input.cwd === 'string' && existsSync(input.cwd) ? input.cwd : REPO_ROOT;
  const toolName = input.tool_name;

  const runs = [];
  const editMode = process.argv[5] === 'edit';
  // A patch carried inside a shell command (see the header).
  // Codex sends the shell command as a string (unified_exec/exec_command.rs). If
  // that ever changes shape, a file hook that cannot read the command must say
  // so — exiting 0 would turn all four edit hooks into silent passes.
  if (editMode && toolName === 'Bash' && typeof input.tool_input?.command !== 'string') {
    fault(`${name}: the Bash payload carries no command string (got ${Array.isArray(input.tool_input?.command) ? 'an array' : typeof input.tool_input?.command}) — cannot tell whether it carries a patch`);
  }
  const carried = editMode && toolName === 'Bash' ? carriedPatch(input.tool_input.command) : null;
  if (editMode && toolName === 'Bash' && !carried) process.exit(0); // no file header anywhere in it: nothing for a file hook to see
  if (carried?.refused) {
    fault(
      `${name}: this command contains a patch and the word apply_patch, but ${carried.refused}, so the files it names cannot be located or checked. ` +
        `If it APPLIES the patch: send it through the apply_patch tool, or make the command start with exactly \`apply_patch <<'EOF'\` or \`cd <literal path> && apply_patch <<'EOF'\`. ` +
        `If it only WRITES text that quotes a patch (a how-to, a fixture, a commit message): create that file with the apply_patch tool, or pass the text from a file (git commit -F <file>), so the patch is not inside a shell command.`,
    );
  }

  // `if` conditions are written for shell commands (`Bash(git push *)`) and gate
  // a hook that inspects the COMMAND. They never apply to a file hook looking
  // at a carried patch: skipping it here would make the two edit channels
  // disagree, with the shell one failing open.
  if (toolName === 'Bash' && !carried) {
    const conds = conditionsFor(EVENT, name);
    const command = input.tool_input?.command ?? '';
    if (conds && !conds.some((c) => conditionMatches(c, 'Bash', command))) process.exit(0);
  }

  if (toolName === 'apply_patch' || carried) {
    const patch = input.tool_input?.command ?? input.tool_input?.input ?? input.tool_input?.patch;
    const base = carried && carried.dir ? resolve(cwd, carried.dir) : cwd;
    const files = carried ? carried.files : parsePatch(typeof patch === 'string' ? patch : '');
    if (files.length === 0) {
      fault(`${name}: could not find a file path in the apply_patch payload — refusing to let the check pass on nothing`);
    }
    for (const f of files) {
      const resolved = isAbsolute(f.path) ? f.path : resolve(base, f.path);
      // The exec tool's `workdir` moves the base too, and the payload does not
      // carry it. A file this patch UPDATES or DELETES must already exist; if
      // it does not exist where the path resolves, the base is wrong and every
      // check below would be looking at a file that is not the one being edited.
      // Only for a NAMED patch: a heredoc that merely writes a patch file may
      // well mention files that are not here, and blocking that would be wrong.
      if (carried?.named && !f.isMoveDest && f.op !== 'Add' && !existsSync(resolved)) {
        fault(
          `${name}: this patch ${f.isMoveSource ? 'moves' : f.op === 'Delete' ? 'removes' : 'updates'} ${f.path}, which does not exist under ${base.replace(/\\/g, '/')}. ` +
            `The command was probably run with a working directory this hook cannot see, so the edit cannot be checked. ` +
            `Send the patch through the apply_patch tool, or run it from the repository root with root-relative paths.`,
        );
      }
      // Forward slashes on every platform: the consumers are bash scripts that
      // match on globs like `*/web/src/lib/*`, which a Windows `D:\a\b` path
      // never satisfies — the check would skip the file and exit 0.
      const filePath = resolved.replace(/\\/g, '/');
      const toolInput = { file_path: filePath };
      if (f.op === 'Add') toolInput.content = f.added.join('\n');
      else toolInput.new_string = f.added.join('\n'); // '' for a delete / move source
      runs.push({
        payload: { ...input, tool_name: f.op === 'Add' ? 'Write' : 'Edit', tool_input: toolInput },
        env: { TOOL_INPUT_file_path: filePath },
      });
    }
  } else {
    const env = {};
    const command = input.tool_input?.command;
    if (typeof command === 'string' && command.length < MAX_ENV_VALUE) env.TOOL_INPUT_command = command;
    runs.push({ payload: input, env });
  }

  const bash = findBash();
  const contexts = [];
  const messages = [];
  const texts = [];
  const crashes = [];
  let deny = null;
  // Seconds → ms. Absent or nonsensical numbers mean "no bound of our own":
  // Codex's timeout still applies, this adapter just cannot pre-empt it.
  const perRunMs = Number(process.argv[3]) > 0 ? Number(process.argv[3]) * 1000 : 0;
  const budgetMs = Number(process.argv[4]) > 0 ? Number(process.argv[4]) * 1000 : 0;
  // Leave room to report: once Codex's own timeout fires, the run is merely
  // Failed and the action proceeds — this adapter must speak first.
  const deadline = budgetMs ? STARTED + Math.max(budgetMs - 1500, budgetMs * 0.8) : 0;
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const remaining = deadline ? deadline - Date.now() : Infinity;
    if (remaining <= 0) {
      fault(`${name}: out of time after checking ${i} of ${runs.length} paths (budget ${budgetMs / 1000}s) — the rest were NOT checked. Split the patch into smaller ones.`);
    }
    const timeout = Math.min(perRunMs || Infinity, remaining);
    const res = spawnSync(bash, [script], {
      input: JSON.stringify(run.payload),
      cwd,
      env: { ...process.env, ...run.env },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...(Number.isFinite(timeout) ? { timeout, killSignal: 'SIGKILL' } : {}),
    });
    if (res.error && res.error.code === 'ETIMEDOUT' && perRunMs && remaining < perRunMs) {
      // The PATCH budget cut this run short, not the hook's own bound. Saying
      // "raise the hook's timeout" here would send the reader to the wrong fix.
      fault(`${name}: out of time while checking path ${i + 1} of ${runs.length} (budget ${budgetMs / 1000}s) — it and the rest were NOT checked. Split the patch into smaller ones.`);
    }
    if (res.error && res.error.code === 'ETIMEDOUT') {
      fault(
        `${name}: timed out after ${Math.round(timeout / 1000)}s on ${run.env.TOOL_INPUT_file_path || 'this command'} — it was NOT checked. ` +
          `The bound is this hook's \`timeout\` in .claude/settings.json ` +
          `(where there is none, hooks.defaultTimeoutSeconds in tools/agentic-sync/port.json): raise it, then run node tools/agentic-sync/port.mjs --write.`,
      );
    }
    if (res.error) fault(`${name}: could not start bash (${res.error.message})`);
    if (res.status === 2) {
      const said = [res.stderr, res.stdout].find((s) => s && s.trim());
      process.stderr.write(said ? (said.endsWith('\n') ? said : `${said}\n`) : `${name} blocked this action without giving a reason\n`);
      process.exit(2);
    }
    if (res.status !== 0) {
      // The script crashed on THIS path. Reported, not blocking — and the loop
      // goes on, so a block on a later path is still found.
      crashes.push(`${name} exited ${res.status}${run.env.TOOL_INPUT_file_path ? ` on ${run.env.TOOL_INPUT_file_path}` : ''}${res.stderr ? `: ${res.stderr.trim()}` : ''}`);
      continue;
    }
    const stdout = (res.stdout || '').trim();
    if (!stdout) continue;
    let parsed = null;
    if (stdout.startsWith('{')) {
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      texts.push(stdout); // plain text: Codex drops it, so emit() finds it a home
      continue;
    }
    const hso = parsed.hookSpecificOutput && typeof parsed.hookSpecificOutput === 'object' ? parsed.hookSpecificOutput : {};
    if (hso.permissionDecision === 'deny' && !deny) deny = hso.permissionDecisionReason || `${name} denied this action`;
    if (parsed.decision === 'block' && !deny) deny = parsed.reason || `${name} blocked this action`;
    if (hso.additionalContext) contexts.push(String(hso.additionalContext));
    if (parsed.systemMessage) messages.push(String(parsed.systemMessage));
  }

  emit(EVENT, { deny, contexts, messages, texts });
  if (crashes.length && !deny) {
    process.stderr.write(`run-claude-hook: ${crashes.join('\n')}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ALWAYS run. There was an "only when executed directly" guard here comparing
// process.argv[1] with this module's path. Node realpaths the entry module but
// not argv[1], so through a directory junction or a symlinked checkout the two
// differ, main() never ran, and the process exited 0 with no output — every
// hook, the blocking ones included, silently passed. This file is a program,
// not a library: nothing imports it, so there is nothing for a guard to protect.
try {
  main();
} catch (e) {
  EVENT = EVENT || 'PreToolUse';
  fault(`unexpected error (${e && e.message ? e.message : e}) — treating as a check that could not run`);
}
