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
// is Rust, so every trim below is Rust's.
const RUST_WS = '\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const RUST_TRIM = new RegExp(`^[${RUST_WS}]+|[${RUST_WS}]+$`, 'g');
const RUST_TRIM_END = new RegExp(`[${RUST_WS}]+$`);
const rustTrim = (s) => s.replace(RUST_TRIM, '');
const rustTrimEnd = (s) => s.replace(RUST_TRIM_END, '');
// Rust's `str::lines()`: split on \n, drop ONE trailing \r per line, and no
// final empty line. Nothing else is a line break — not U+2028, not a lone \r —
// so a PATH may contain those, and no regex with `.` may be used on a line.
const rustLines = (s) => {
  const parts = s.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
};

const M = {
  begin: '*** Begin Patch',
  end: '*** End Patch',
  add: '*** Add File: ',
  del: '*** Delete File: ',
  update: '*** Update File: ',
  move: '*** Move to: ',
  eof: '*** End of File',
  ctx: '@@ ',
  ctxEmpty: '@@',
  env: '*** Environment ID:',
};

// A LINE-FOR-LINE PORT of Codex's patch parser — apply-patch/src/parser.rs
// (`parse_patch_text`, lenient mode, which is what Codex runs) feeding
// apply-patch/src/streaming_parser.rs (`process_line`), read at rust-v0.144.1.
//
// It is a port and not an approximation because three approximations each
// disagreed with Codex somewhere, and every disagreement was a file edited with
// no hook shown it, or a hook shown the wrong path:
//   * headers matched at column 0            → an indented header hid its hunk;
//   * headers trimmed as JavaScript trims    → so did one behind U+0085;
//   * headers trimmed in EVERY state         → inside an Update hunk Codex uses
//     trim_end() only, so an indented `*** Update File: b` there is a CONTEXT
//     line of file a (Codex pins this: keeps_indented_update_markers_as_
//     context_lines); reading it as a header invented file b and handed the
//     hooks a's added lines under b's name;
//   * the path captured with `(.+)$`         → `.` stops at U+2028, so a header
//     whose path contains one did not match at all.
// Returns { ok: true, hunks } or { ok: false, error }. A patch Codex REJECTS is
// not applied, so `ok: false` means "nothing will be edited by this text".
// hunks: { op: 'Add'|'Delete'|'Update', path, movePath?, added: string[] }.
function codexParse(text) {
  let lines = rustLines(rustTrim(String(text)));
  const boundariesOk = (ls) => ls.length > 0 && rustTrim(ls[0]) === M.begin && rustTrim(ls[ls.length - 1]) === M.end;
  if (!boundariesOk(lines)) {
    // Lenient mode: the whole text may be wrapped in a heredoc, exactly these
    // three spellings, which Codex strips before checking again.
    const first = lines[0];
    const wrapped = lines.length >= 4 && (first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"') && lines[lines.length - 1].endsWith('EOF');
    if (!wrapped) return { ok: false, error: lines.length && rustTrim(lines[0]) !== M.begin ? "the first line of the patch must be '*** Begin Patch'" : "the last line of the patch must be '*** End Patch'" };
    lines = lines.slice(1, -1);
    if (!boundariesOk(lines)) return { ok: false, error: 'the heredoc body does not start with *** Begin Patch and end with *** End Patch' };
  }

  const hunks = [];
  let mode = 'NotStarted';
  let envSeen = false;
  const last = () => hunks[hunks.length - 1];
  const lastChunkEmpty = (h) => h.chunks.length > 0 && h.chunks[h.chunks.length - 1].lines === 0;
  const newChunk = (h) => h.chunks.push({ lines: 0, eof: false });
  const fail = (error) => ({ ok: false, error });

  // ensure_update_hunk_is_not_empty
  const updateHunkProblem = () => {
    const h = last();
    if (!h || h.op !== 'Update') return null;
    if (h.chunks.length === 0 && mode === 'UpdateFile') return `update file hunk for path '${h.path}' is empty`;
    if (lastChunkEmpty(h)) return 'update hunk does not contain any lines';
    return null;
  };
  // handle_hunk_headers_and_end_patch → 'handled' | 'no' | { error }
  const header = (line) => {
    if (mode === 'StartedPatch' && line.startsWith(M.env)) {
      if (envSeen) return { error: 'environment id given more than once' };
      if (rustTrim(line.slice(M.env.length)) === '') return { error: 'environment id is empty' };
      envSeen = true;
      return 'handled';
    }
    const opens = line === M.end || line.startsWith(M.add) || line.startsWith(M.del) || line.startsWith(M.update);
    if (!opens) return 'no';
    const problem = updateHunkProblem();
    if (problem) return { error: problem };
    if (line === M.end) mode = 'EndedPatch';
    else if (line.startsWith(M.add)) { hunks.push({ op: 'Add', path: line.slice(M.add.length), added: [] }); mode = 'AddFile'; }
    else if (line.startsWith(M.del)) { hunks.push({ op: 'Delete', path: line.slice(M.del.length), added: [] }); mode = 'DeleteFile'; }
    else { hunks.push({ op: 'Update', path: line.slice(M.update.length), movePath: null, chunks: [], added: [] }); mode = 'UpdateFile'; }
    return 'handled';
  };

  // Codex joins the lines and streams them: every line but the LAST goes through
  // process_line; the last has no newline after it and is handled by finish(),
  // where a line that TRIMS to `*** End Patch` ends the patch in any state —
  // even inside an Update hunk, where an indented header is otherwise context.
  const finalLine = lines[lines.length - 1];
  for (const line of lines.slice(0, -1)) {
    const trimmed = rustTrim(line);
    if (mode === 'NotStarted') {
      if (trimmed !== M.begin) return fail("the first line of the patch must be '*** Begin Patch'");
      mode = 'StartedPatch';
      continue;
    }
    if (mode === 'EndedPatch') {
      if (trimmed !== '') return fail("the last line of the patch must be '*** End Patch'");
      continue;
    }
    if (mode === 'StartedPatch' || mode === 'AddFile' || mode === 'DeleteFile') {
      const r = header(trimmed); // these three states match headers on trim()
      if (r === 'handled') continue;
      if (r !== 'no') return fail(r.error);
      if (mode === 'AddFile' && line.startsWith('+')) { last().added.push(line.slice(1)); continue; }
      return fail(`'${trimmed}' is not a valid hunk header`);
    }
    // UpdateFile: headers — and Move — are matched on trim_end() ONLY.
    const updateLine = rustTrimEnd(line);
    const r = header(updateLine);
    if (r === 'handled') continue;
    if (r !== 'no') return fail(r.error);
    const h = last();
    const lastChunk = h.chunks[h.chunks.length - 1];
    const isCtx = updateLine === M.ctxEmpty || updateLine.startsWith(M.ctx);
    if (lastChunk && lastChunk.eof) {
      if (updateLine === '') continue;
      if (!isCtx) return fail(`expected update hunk to start with a @@ context marker, got: '${line}'`);
    }
    if (h.chunks.length === 0 && h.movePath === null && updateLine.startsWith(M.move)) { h.movePath = updateLine.slice(M.move.length); continue; }
    if (isCtx && lastChunkEmpty(h)) return fail(`unexpected line found in update hunk: '${line}'`);
    if (isCtx) { newChunk(h); continue; }
    if (updateLine === M.eof) {
      if (lastChunkEmpty(h)) return fail('update hunk does not contain any lines');
      if (lastChunk) lastChunk.eof = true;
      continue;
    }
    const first = line === '' ? '' : line[0];
    if (line === '' || first === ' ' || first === '+' || first === '-') {
      if (h.chunks.length === 0) newChunk(h);
      h.chunks[h.chunks.length - 1].lines += 1;
      if (first === '+') h.added.push(line.slice(1));
      continue;
    }
    if (lastChunk && lastChunk.lines > 0) return fail(`expected update hunk to start with a @@ context marker, got: '${line}'`);
    return fail(`unexpected line found in update hunk: '${line}'`);
  }
  // finish(): the boundary check above already proved this line trims to the end marker.
  if (rustTrim(finalLine) !== M.end) return fail("the last line of the patch must be '*** End Patch'");
  const problem = updateHunkProblem();
  if (problem) return fail(problem);
  return { ok: true, hunks };
}

// The files a parsed patch touches, as the hooks are shown them. A move has two
// ends and both matter: the source is removed from where a hook may protect it,
// the destination is written where another may.
function touchedFiles(hunks) {
  const files = [];
  for (const h of hunks) {
    if (h.op === 'Update' && h.movePath !== null) {
      files.push({ op: 'Delete', path: h.path, added: [], isMoveSource: true });
      files.push({ op: 'Update', path: h.movePath, added: h.added, isMoveDest: true });
    } else files.push({ op: h.op, path: h.path, added: h.added });
  }
  return files;
}

// Does any line of this text LOOK like a file header, in any parser state? A
// deliberate SUPERSET of what Codex can treat as one (trim() is the widest rule
// it uses), and no regex touches the path, so nothing in a path can make a
// header invisible. Used to decide that a shell command is patch-bearing, and
// as the fallback when the port above rejects a patch sent through the tool.
function looseHeaderPaths(text) {
  const out = [];
  for (const raw of rustLines(String(text))) {
    const line = rustTrim(raw);
    for (const [op, marker] of [['Add', M.add], ['Delete', M.del], ['Update', M.update]]) {
      if (line.startsWith(marker)) out.push({ op, path: line.slice(marker.length), added: [] });
    }
  }
  return out;
}

// A patch carried in a shell command.
//
// Codex hands hooks the shell command BEFORE deciding whether it is a patch.
// It intercepts `apply_patch <<'EOF'…EOF` and `cd <path> && apply_patch <<'EOF'
// …EOF` as the sole statement (apply-patch/src/invocation.rs) and applies the
// body itself. Everything else it hands to a REAL SHELL — in which `apply_patch`
// is a real executable: Codex prepends a directory holding `apply_patch` and
// `applypatch` to PATH (arg0/src/lib.rs). So any shell text that reaches that
// executable edits files, from whatever directory the shell has reached by then,
// after whatever expansion the shell has done. That is the threat model, and it
// is why five attempts to READ the shell text each failed somewhere: shell
// syntax is open-ended (lessons-learned #21) — an identifier-only delimiter, a
// line continuation, an earlier `<<` hiding a cd, `env -C`, a decoy heredoc
// before the real one, an unquoted delimiter letting `$(…)` rewrite a path.
//
// So the shell is not read. A command that is patch-bearing (any line looks
// like a file header) has exactly TWO outcomes:
//
//   ACCEPTED — the WHOLE command, first byte to last, is one of
//         apply_patch <<'D'\n<body>\nD
//         cd <literal path> && apply_patch <<'D'\n<body>\nD      (or applypatch)
//     with: only spaces/tabs as separators (a continuation may join the first
//     line); the delimiter QUOTED, so the shell expands nothing in the body; a
//     literal cd path (quoted, or a bare word of [A-Za-z0-9_./-]) that is not
//     empty and does not start with `-` (`cd -` is $OLDPWD); nothing but blank
//     space after the closing delimiter; and a body Codex's own parser accepts.
//     Then both the base directory and every path are KNOWN, and each path is
//     shown to the hook.
//
//   REFUSED — everything else, unparsed. Nothing in it is interpreted, so
//     nothing in it can mislead. → { refused: why }, and the caller blocks.
//
// The cost is a false block: any shell command with a line that starts with a
// patch file header is refused unless it is exactly the form above — including a
// heredoc that only WRITES a patch file, a fixture, or a commit message quoting
// a whole patch. The message gives the ways out; the support matrix records it
// as a limit, together with the fact that the hooks on this path only advise
// today, so what the refusal buys is a correctly-aimed warning.
//
// Not patch-bearing → null, an ordinary command. That includes a patch whose
// text is not in the command (`apply_patch < fix.patch`) or is assembled by the
// shell: a shell writing files, which no Edit/Write hook sees under Claude Code
// either.
const CD_LITERAL = String.raw`'[^'\n]*'|"[^"\n$` + '`' + String.raw`\\]*"|[A-Za-z0-9_./-]+`;
const HEAD_LINE = new RegExp(String.raw`^[ \t]*(?:cd[ \t]+(${CD_LITERAL})[ \t]*&&[ \t]*)?(?:apply_patch|applypatch)[ \t]*$`);
const HEREDOC_OPEN = new RegExp(String.raw`^<<[ \t]*(?:'([^'\n]+)'|"([^"\n$` + '`' + String.raw`\\]+)")[ \t]*\r?\n`);
function carriedPatch(command) {
  if (looseHeaderPaths(command).length === 0) return null;
  const refused = (why) => ({ refused: why });

  const at = command.indexOf('<<');
  if (at === -1) return refused('it has no heredoc');
  const head = HEAD_LINE.exec(command.slice(0, at).replace(/\\\r?\n/g, ''));
  if (!head) return refused('the text before its heredoc is not exactly `apply_patch` or `cd <literal path> && apply_patch`');
  const open = HEREDOC_OPEN.exec(command.slice(at));
  if (!open) return refused('its heredoc delimiter is not a plain QUOTED word (unquoted, the shell would expand the patch before applying it)');
  const delimiter = open[1] ?? open[2];
  const bodyLines = command.slice(at + open[0].length).split('\n');
  const close = bodyLines.findIndex((l) => (l.endsWith('\r') ? l.slice(0, -1) : l) === delimiter);
  if (close === -1) return refused(`its heredoc is never closed by a line reading exactly ${delimiter}`);
  if (bodyLines.slice(close + 1).join('\n').trim() !== '') return refused('something follows the closing heredoc delimiter');

  let dir = '';
  if (head[1] !== undefined) {
    dir = head[1].replace(/^(["'])([\s\S]*)\1$/, '$2');
    if (dir === '' || dir.startsWith('-')) return refused(`its cd target (${head[1]}) is empty or starts with "-"`);
  }
  const parsed = codexParse(bodyLines.slice(0, close).join('\n'));
  if (!parsed.ok) return refused(`the patch in it does not parse the way Codex parses it (${parsed.error})`);
  return { files: touchedFiles(parsed.hunks), dir };
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
      `${name}: this shell command contains a patch, but ${carried.refused}, so the files it names cannot be located or checked. ` +
        `If it APPLIES the patch: send it through the apply_patch tool, or make it the WHOLE command, exactly \`apply_patch <<'EOF'\` … \`EOF\` or \`cd <literal path> && apply_patch <<'EOF'\` … \`EOF\`, with a quoted delimiter and nothing after it. ` +
        `If it only WRITES text that quotes a patch (a patch file, a how-to, a fixture, a commit message): create that file with the apply_patch tool, or pass the text from a file (git commit -F <file>), so the patch is not inside a shell command.`,
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
    let files;
    if (carried) files = carried.files;
    else {
      // The patch tool. Codex's own parser decides what is edited, so its port
      // decides what is shown. If the port REJECTS the text, Codex applies
      // nothing — but a bug in the port must not turn into a silent pass, so
      // every line that even looks like a file header is shown instead.
      const parsed = codexParse(typeof patch === 'string' ? patch : '');
      files = parsed.ok ? touchedFiles(parsed.hunks) : looseHeaderPaths(typeof patch === 'string' ? patch : '');
    }
    if (files.length === 0) {
      fault(`${name}: could not find a file path in the apply_patch payload — refusing to let the check pass on nothing`);
    }
    for (const f of files) {
      const resolved = isAbsolute(f.path) ? f.path : resolve(base, f.path);
      // The exec tool's `workdir` moves the base too, and the payload does not
      // carry it. A file this patch UPDATES or DELETES must already exist; if
      // it does not exist where the path resolves, the base is wrong and every
      // check below would be looking at a file that is not the one being edited.
      if (carried && !f.isMoveDest && f.op !== 'Add' && !existsSync(resolved)) {
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
