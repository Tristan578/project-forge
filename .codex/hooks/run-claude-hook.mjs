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
//   apply_patch → parse the patch with a line-for-line PORT of Codex's own
//     parser (codexParse: apply-patch/src/parser.rs + streaming_parser.rs) and
//     run the script ONCE PER TOUCHED PATH: added and updated files, deleted
//     files, and BOTH ends of a move. A patch the port cannot parse is BLOCKED,
//     not guessed at. Payload per run: `tool_name` Write (Add) or Edit,
//     `tool_input.file_path` absolute, normalised and forward-slashed, and
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
//     Its matcher is a tree-sitter query over the bash grammar, and what it
//     does not intercept runs in a real shell where `apply_patch` is a real
//     executable on PATH. This file does NOT read the shell: five attempts
//     did, and each failed open somewhere. A shell command with any line that
//     looks like a file header has exactly TWO outcomes (see carriedPatch):
//       ACCEPTED — the WHOLE command is `[cd <literal> &&] apply_patch <<'D'`
//                  … `D`, quoted delimiter, nothing but spaces, tabs and
//                  newlines after the closing line, no carriage return except
//                  the one ending a line inside the body (Git for Windows'
//                  bash deletes a CR wherever it stands, bash on Linux keeps
//                  it), a body the parser port accepts → every path is shown;
//       REFUSED  — everything else, unparsed → the hook blocks, with the ways
//                  out. That includes a command that only WRITES text quoting a
//                  patch; the support matrix records that cost under Limits.
//     What this leaves out is a patch whose text is NOT in the command
//     (`apply_patch < file.patch`) — Codex does not intercept that either, and
//     a shell can write files a hundred ways, none of which an Edit/Write hook
//     sees under Claude Code.
//
//     ONE THING THIS CANNOT SEE: the exec tool's `workdir` argument also moves
//     the base, and the hook payload does not carry it. So for a carried patch
//     an UPDATED or DELETED file that does not exist where the paths resolve is
//     treated as proof the base is wrong, and blocks — better than checking a
//     path that is not the one being edited. An ADDED file cannot be checked
//     that way; that residue is recorded in the support matrix.
//     (PostToolUse cannot see this channel at all: there the intercepted call
//     carries no command. Also recorded.)
//   `if` conditions from .claude/settings.json (e.g. `Bash(git push *)`): Codex
//     has no such key. On NON-GATING events they are read from
//     `.codex/hook-conditions.json`, which the generator writes — without that
//     `post-push-resolve-comments.sh` would run `gh` after every shell command.
//     On PreToolUse none is applied and none is written: a blocking script
//     always starts and routes on the command itself (see conditionMatches).
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
//   ADAPTER fault on PreToolUse (unreadable or EMPTY payload, a patch that names
//     no file, script or bash or jq missing, a run that ends 126/127 or cannot
//     be completed, budget exhausted)
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
const MAX_OUTPUT = 64 * 1024 * 1024;
// One spelling of the pointer, so the suite can hold it against the document.
const ON_PATH = `bash (Git for Windows' on Windows), node, git and jq must be on PATH — .codex/AGENTS.md, "Requirements on PATH".`;

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
  let execPath = '';
  try {
    execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  } catch {
    // reported below
  }
  if (execPath) {
    // <git>/mingw64/libexec/git-core → <git>/bin/bash.exe, or <git>/usr/bin/bash.exe
    for (const tail of [['bin', 'bash.exe'], ['usr', 'bin', 'bash.exe']]) {
      const candidate = resolve(execPath, '..', '..', '..', ...tail);
      if (existsSync(candidate)) return candidate;
    }
  }
  // NOT a bare `bash`: that is the hazard named above. The WSL shim starts,
  // cannot see this checkout, and the script "exits 1" — which Codex reads as
  // Failed and lets the action through. A check that cannot run must say so.
  fault(
    `no usable bash: Git for Windows' bash.exe was not found next to \`git --exec-path\`${execPath ? ` (${execPath})` : ' (git itself did not run)'}, ` +
      `and a bare \`bash\` on Windows is the WSL launcher, which cannot see this checkout. ` +
      `Install Git for Windows. ${ON_PATH} This needs a person: no hook can run until it is fixed.`,
  );
  return '';
}

// Rust's `str::trim()` strips the Unicode White_Space property; JavaScript's
// `trim()` strips a DIFFERENT set (it keeps U+0085 NEL, it drops U+FEFF). Codex
// is Rust, so every trim below is Rust's.
//
// INDEX LOOPS, not `[ws]+$` regexes. A regex anchored only at the end restarts at
// every position of a long whitespace run that is NOT at the end, which is
// quadratic: `echo a<300000 spaces>b` — no patch in it — kept an edit hook busy
// for 55 s against a declared budget of 30, inside the adapter itself, where
// the deadline is not consulted. Past Codex's own timeout the run is merely
// Failed and the action proceeds. Every trim here is one pass.
const RUST_WS = /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const rustTrimEnd = (s) => {
  let end = s.length;
  while (end > 0 && RUST_WS.test(s[end - 1])) end -= 1;
  return s.slice(0, end);
};
const rustTrim = (s) => {
  const t = rustTrimEnd(s);
  let start = 0;
  while (start < t.length && RUST_WS.test(t[start])) start += 1;
  return t.slice(start);
};
// Rust's `str::lines()`: split on \n, drop ONE trailing \r per line. Nothing else
// is a line break — not U+2028, not a lone \r — so a PATH may contain those, and
// no regex with `.` may be used on a line. (`lines()` also drops a final empty
// line; both callers here make that unobservable — the parser trims the text
// first, the header scan ignores an empty line — so it is not reproduced.)
const rustLines = (s) => s.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

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

  // Codex strips a trailing \r TWICE from every line but the last: once in
  // `patch.trim().lines()` (done above) and again in push_delta, after it has
  // re-joined the lines with \n (streaming_parser.rs: `line.strip_suffix('\r')`).
  // The last line has no \n after it, so finish() sees it as it is. A line that
  // is exactly "\r\r" is therefore an EMPTY line to Codex — a context line in
  // an Update hunk — and stripping once made the port reject a patch Codex applies.
  // (Applied to the last line as well: Codex does not strip that one a second
  // time, but only its trim() is ever looked at, so the two are indistinguishable
  // and a special case here would be a branch no test can observe.)
  lines = lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

  const hunks = [];
  let mode = 'StartedPatch'; // the boundary check above proved line 1 is `*** Begin Patch`
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
  for (const line of lines.slice(1, -1)) {
    const trimmed = rustTrim(line);
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
      // On an EMPTY chunk Codex rejects right here. Nothing is lost by not doing so:
      // every line that can follow (blank, @@, a header, End Patch, anything else)
      // rejects an empty chunk too, so the patch is refused either way.
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
  // finish(): the last line trims to the end marker — the boundary check proved it —
  // so all that is left is the check every header runs on the hunk before it.
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
// header invisible. Used ONLY to decide that a shell command is patch-bearing —
// never to choose what a hook is shown: that is the port's job, and where the
// port cannot parse, the answer is a block.
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

// What Git for Windows' bash will have of this text by the time it runs it: it
// deletes every CR wherever it stands, quoted or not (measured). bash on Linux
// keeps them all, so the raw text is that reader's view.
//
// Its one caller, the header scan, cannot tell this from a form that spared a CR
// directly before a line feed — rustLines drops that one and rustTrim the rest —
// so no test distinguishes the two. It stays faithful to what bash does anyway,
// because that is the property its name claims and the next caller may need it.
const crDeleted = (s) => (s.includes('\r') ? s.split('\r').join('') : s);

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
// SEP: a space, a tab, or a backslash-LF continuation, which bash deletes between
// words. Matched on the RAW text: an earlier version JOINED continuations first
// and then looked for the cd target "somewhere in the head", which `cd c\<LF>d`
// satisfied through the letters of `cd` itself. With no joining step a
// continuation can only ever sit BETWEEN words — never inside the cd target or a
// command name — and backslash-CR-LF is not one at all (to POSIX bash the
// backslash quotes the CR), so a head containing it simply does not match.
const SEP = String.raw`(?:[ \t]|\\\n)`;
const HEAD_LINE = new RegExp(String.raw`^${SEP}*(?:cd${SEP}+(${CD_LITERAL})${SEP}*&&${SEP}*)?(?:apply_patch|applypatch)${SEP}*$`);
// NO CARRIAGE RETURN on the line that opens the heredoc. Two bashes disagree about
// one (the suite prints what the bash it runs under does): to bash on Linux a CR
// is an ordinary byte, so `<<'EOF'<CR>` opens a heredoc whose delimiter is
// `EOF<CR>`; Git for Windows' bash deletes it, so the delimiter is `EOF` and a
// line `EOF<CR>` closes it. A delimiter ENDING in CR made the two readers close on
// different lines — everything between was shell to bash and patch body to this
// file. What cannot be read one way is refused. (carriedPatch() refuses every CR
// outside a CRLF in the body BEFORE this is asked, so the classes below need not
// exclude one.)
const HEREDOC_OPEN = new RegExp(String.raw`^<<[ \t]*(?:'([^'\n]+)'|"([^"\n$` + '`' + String.raw`\\]+)")[ \t]*\n`);
function carriedPatch(command) {
  // ASKED IN THE VIEW THE WIDEST APPLIER USES, not in the bytes as sent.
  // Git for Windows' bash DELETES every carriage return while reading the script,
  // so `*** Ad<CR>d File: x.ts` is a header to the apply_patch it then runs and
  // not one in the raw text. Gating on the raw text made that command an ORDINARY
  // command: the adapter exited 0, no edit hook was shown the path, and the file
  // was written — a silent third outcome where this file promises two. The CR
  // refusal below could never fire, because it sits behind this gate.
  // (lessons-learned #21: the detector and the thing it guards must not read the
  // same bytes in different string spaces. The refusal stays the answer; this
  // only decides that the question gets asked.)
  //
  // ONE view, not both: deleting carriage returns can only ever CREATE a header,
  // never destroy one — the marker holds no CR, so a line that starts with it
  // still does once they are gone. Asking the raw text as well was a second guard
  // for the same fact, and a mutation that removed it could not be killed.
  if (looseHeaderPaths(crDeleted(command)).length === 0) return null;
  // `fix` says what to do about THIS cause; one remedy for every cause sent the
  // reader of a body that would not parse to "make it the whole command", which
  // it already was.
  const WHOLE = "make it the WHOLE command, exactly `apply_patch <<'EOF'` … `EOF` or `cd <literal path> && apply_patch <<'EOF'` … `EOF`, with a quoted delimiter and nothing after the closing line";
  const refused = (why, fix = WHOLE, opts = {}) => ({ refused: why, fix, noTool: opts.noTool === true });

  // A CARRIAGE RETURN IS READ TWO WAYS, so the only one accepted is the one both
  // readers agree on. Git for Windows' bash DELETES a CR wherever it stands in the
  // command text — mid-word, inside either kind of quote, inside the body of a
  // quoted-delimiter heredoc (measured: `printf '%s' 'a<CR>b'` prints `ab`); bash
  // on Linux keeps every one. So `Add File: we<CR>b/src/lib/x.ts` was shown to the
  // hooks as a path no glob matched while bash handed apply_patch `web/src/lib/x.ts`.
  // The one CR left alone is the one directly before a line feed INSIDE the body:
  // Codex's parser strips that itself, so no path or added line can carry it.
  const LF_ONLY = 'write the command with LF line endings. The only carriage return accepted is the one ending a line INSIDE the patch body (a CRLF file): none in the command before the heredoc, on the `apply_patch <<\'EOF\'` line, in the middle of a line, or on the line that closes the heredoc';
  if (/\r(?!\n)/.test(command)) {
    return refused("it contains a carriage return that does not end a line, which Git for Windows' bash deletes and bash on Linux keeps — the two would apply different text", LF_ONLY);
  }
  const at = command.indexOf('<<');
  if (at === -1) return refused('it has no heredoc');
  const head = HEAD_LINE.exec(command.slice(0, at));
  if (!head) return refused('the text before its heredoc is not exactly `apply_patch` or `cd <literal path> && apply_patch` (a line continuation may separate words, never split one)');
  if (command.slice(at).split('\n', 1)[0].includes('\r')) {
    return refused('the line that opens its heredoc contains a carriage return, which bash on Linux reads as part of the delimiter and Git for Windows\' bash drops', LF_ONLY);
  }
  const open = HEREDOC_OPEN.exec(command.slice(at));
  if (!open) {
    // Two different mistakes, two different ways out.
    const quotedButFollowed = /^<<[ \t]*(?:'[^'\n]+'|"[^"\n$`\\]+")/.test(command.slice(at));
    return quotedButFollowed
      ? refused('something follows the heredoc delimiter on its opening line', 'put nothing after the quoted delimiter on the `apply_patch <<\'EOF\'` line — no redirect, no second command, no second heredoc')
      : refused('its heredoc delimiter is not a plain QUOTED word (unquoted, the shell would expand the patch before applying it)', "quote the delimiter: `apply_patch <<'EOF'`");
  }
  const delimiter = open[1] ?? open[2];
  const bodyLines = command.slice(at + open[0].length).split('\n');
  // The FIRST line either bash could take for the closing one: the delimiter, with
  // or without a carriage return after it (one at most — a second would not end a
  // line, and was refused above). Only the byte-exact spelling closes the heredoc
  // for both (Git for Windows' bash also closes on `EOF<CR>`; bash on Linux does
  // not), so the other is refused rather than read the way one of them reads it.
  const close = bodyLines.findIndex((l) => (l.endsWith('\r') ? l.slice(0, -1) : l) === delimiter);
  if (close === -1) return refused(`its heredoc is never closed by a line reading exactly ${delimiter}`);
  if (bodyLines[close] !== delimiter) {
    return refused(`the line that would close its heredoc (${delimiter}) ends in a carriage return — Git for Windows' bash closes the heredoc there, bash on Linux does not`, LF_ONLY);
  }
  // BASH's idea of blank — space, tab, newline — not JavaScript's. `trim()` also
  // strips U+00A0, form feed, vertical tab, U+2028 and U+FEFF, each of which bash
  // runs as a second command: the command was then not the WHOLE command, which
  // is also the one form Codex intercepts rather than hands to a real shell.
  if (/[^ \t\n]/.test(bodyLines.slice(close + 1).join('\n'))) return refused('something follows the closing heredoc delimiter (only spaces, tabs and newlines may)');

  let dir = '';
  if (head[1] !== undefined) {
    dir = head[1].replace(/^(["'])([\s\S]*)\1$/, '$2');
    if (dir === '' || dir.startsWith('-')) return refused(`its cd target (${head[1]}) is empty or starts with "-"`, 'cd to a literal directory, or drop the cd and use paths relative to the repository root');
  }
  const parsed = codexParse(bodyLines.slice(0, close).join('\n'));
  if (!parsed.ok) return refused(`the patch in it does not parse the way Codex parses it (${parsed.error})`, 'correct the patch text — Codex would reject it too, through the apply_patch tool as well', { noTool: true });
  return { files: touchedFiles(parsed.hunks), dir };
}

// `Bash(git push *)` → should the script run for this command?
//
// NEVER ASKED ON PreToolUse. There the script always starts and decides for
// itself: every blocking Bash hook here routes on the command it is given, and
// block-main-commits.sh does so with a normaliser hardened over many rounds
// (quotes, `$'…'`, continuations inside a word, `git -C`). A filter in front of
// it is a second, weaker router — it skipped `g''it commit` and `git com\<LF>mit`,
// and with the source's `if: Bash(git commit *)` it never started the script for
// merge, cherry-pick, revert or pull, which that script also exists to stop.
// Reading shell text to decide whether enforcement runs is the mistake this file
// has made and removed twice already (lessons-learned #21).
//
// On the NON-gating events (PostToolUse …) a skipped run costs an advisory, and
// an unfiltered one costs real work — post-push-resolve-comments.sh does not
// look at the command and would call `gh` after every shell command. So there
// the condition is applied, generously: the pattern's words before the first
// `*`, in order, as words, with anything between them.
function conditionMatches(pattern, toolName, command) {
  const m = /^([A-Za-z_]+)\((.*)\)$/.exec(pattern);
  if (!m) return true; // unreadable condition → run
  if (m[1] !== toolName) return false;
  // The literal words before the first `*`, IN ORDER, with anything between
  // them. A single substring test skipped `git -C . commit`, `git  commit`,
  // `git -c k=v commit` and `git \<LF>commit` for `Bash(git commit *)` — the
  // very spellings block-main-commits.sh exists to catch — so the script was
  // never started for them.
  const words = m[2].split('*')[0].trim().split(/\s+/).filter(Boolean);
  // (No words — `Bash(*)` — leaves nothing to look for: every command matches.)
  //
  // One left-to-right pass: the earliest whole-word occurrence of each word after
  // the one before it. This was a regex, `w1[\s\S]*?w2`, which restarts the lazy
  // scan at every occurrence of w1 — quadratic on a long command that repeats the
  // first word and never reaches the second, on the same budget as everything else.
  const text = String(command);
  const inWord = (c) => c !== undefined && /[\w-]/.test(c);
  let from = 0;
  for (const w of words) {
    let i = text.indexOf(w, from);
    while (i !== -1 && (inWord(text[i - 1]) || inWord(text[i + w.length]))) i = text.indexOf(w, i + 1);
    if (i === -1) return false;
    from = i + w.length;
  }
  return true;
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
  if (!existsSync(script)) fault(`${script} does not exist — the check it carries cannot run. Restore it from git, or, if the hook was removed from .claude/settings.json on purpose, regenerate: node tools/agentic-sync/port.mjs --write`);

  const cwd = typeof input.cwd === 'string' && existsSync(input.cwd) ? input.cwd : REPO_ROOT;
  const toolName = input.tool_name;

  const runs = [];
  const editMode = process.argv[5] === 'edit';
  // A patch carried inside a shell command (see the header).
  // Codex sends the shell command as a string (unified_exec/exec_command.rs). If
  // that ever changes shape, a file hook that cannot read the command must say
  // so — exiting 0 would turn all four edit hooks into silent passes.
  if (editMode && toolName === 'Bash' && typeof input.tool_input?.command !== 'string') {
    // Adapter-level, like every fault down to the loop: no `${name}:` in front —
    // every edit hook reaches it for the same payload and none of them said it.
    fault(
      `the Bash payload carries no command string (got ${Array.isArray(input.tool_input?.command) ? 'an array' : typeof input.tool_input?.command}), so the edit hooks cannot tell whether it carries a patch. ` +
        `Codex sent the command as a string when this was written (core/src/tools/handlers/unified_exec/exec_command.rs in openai/codex); if that changed, main() in .codex/hooks/run-claude-hook.mjs has to be re-read against it. This needs a person.`,
    );
  }
  const carried = editMode && toolName === 'Bash' ? carriedPatch(input.tool_input.command) : null;
  if (editMode && toolName === 'Bash' && !carried) process.exit(0); // no file header anywhere in it: nothing for a file hook to see
  if (carried?.refused) {
    // Every edit hook reaches this line for the same command, so the text is the
    // same from each of them and names the adapter, not the check that happened
    // to be running — "check-vercel-json.sh: this shell command…" read as if that
    // check had an opinion about it. The same goes for every ADAPTER-LEVEL block
    // below (a patch that does not parse, a base directory that cannot be seen):
    // none of them is the verdict of the script named in argv.
    process.stderr.write(
      `run-claude-hook (edit hooks): this shell command contains a patch, but ${carried.refused}, so the files it names cannot be located or checked. ` +
        `If it APPLIES the patch: ${carried.fix}${carried.noTool ? '' : ', or send it through the apply_patch tool'}. ` +
        `If it only WRITES text that quotes a patch (a patch file, a how-to, a fixture, a commit message): create that file with the apply_patch tool, or pass the text from a file (git commit -F <file>). ` +
        `Details: docs/guides/codex-cli-support-matrix.md, "Limits to know about".\n`,
    );
    process.exit(EVENT === 'PreToolUse' ? 2 : 1);
  }

  // `if` conditions: never on PreToolUse (see conditionMatches), and never for a
  // file hook looking at a carried patch — skipping it here would make the two
  // edit channels disagree, with the shell one failing open.
  if (toolName === 'Bash' && !carried && EVENT !== 'PreToolUse') {
    const conds = conditionsFor(EVENT, name);
    const command = input.tool_input?.command ?? '';
    if (conds && !conds.some((c) => conditionMatches(c, 'Bash', command))) process.exit(0);
  }

  if (toolName === 'apply_patch' || carried) {
    // Codex puts the patch text in `tool_input.command` (core/src/tools/
    // hook_names.rs). Other field names were guessed at once and never observed;
    // a payload without it is a fault below, not a guess.
    const patch = input.tool_input?.command;
    const base = carried && carried.dir ? resolve(cwd, carried.dir) : cwd;
    let files;
    if (carried) files = carried.files;
    else {
      // The patch tool. Codex's own parser decides what is edited, so its port
      // decides what is shown — and a patch the port cannot parse is BLOCKED.
      // There used to be a fallback here that showed every line looking like a
      // header instead; it turned each disagreement between the port and Codex
      // into an exit 0 with the added lines and the Move destination missing,
      // which is how a whole class of port bugs stayed invisible. If Codex would
      // reject the text too, blocking costs nothing; if it would not, the port
      // has diverged and that must be loud.
      if (typeof patch !== 'string') {
        fault(
          `the apply_patch payload carries no patch text in tool_input.command, so the files it edits cannot be checked. ` +
            `Codex put the patch there when this was written (core/src/tools/hook_names.rs in openai/codex); if that changed, main() in .codex/hooks/run-claude-hook.mjs has to be re-read against it. This needs a person.`,
        );
      }
      const parsed = codexParse(patch);
      if (!parsed.ok) {
        fault(
          `this patch does not parse the way Codex parses it (${parsed.error}), so the files it edits cannot be checked. ` +
            `Codex should reject it too — correct the patch. If Codex accepts it, the parser port in .codex/hooks/run-claude-hook.mjs (codexParse) has diverged from apply-patch/src/streaming_parser.rs and needs re-reading.`,
        );
      }
      files = touchedFiles(parsed.hunks);
    }
    if (files.length === 0) {
      // A well-formed envelope with no Add/Update/Delete section. Codex applies
      // nothing for it ("No files were modified.", apply-patch/src/lib.rs), so the
      // block costs nothing — and it is not "a path could not be found", which
      // read like five checks each failing at their job.
      fault(`this patch names no file — it has no Add File, Update File or Delete File section — so there is nothing to check, and Codex applies nothing for it. Add a hunk, or drop the call.`);
    }
    for (const f of files) {
      // resolve() on BOTH branches: it is what removes `.` and `..` segments, and
      // an absolute `<repo>/web/src/./lib/x.ts` handed over verbatim matched no
      // `*/web/src/lib/*` glob while the relative spelling of the same file did.
      const resolved = isAbsolute(f.path) ? resolve(f.path) : resolve(base, f.path);
      // The exec tool's `workdir` moves the base too, and the payload does not
      // carry it. A file this patch UPDATES or DELETES must already exist; if
      // it does not exist where the path resolves, the base is wrong and every
      // check below would be looking at a file that is not the one being edited.
      if (carried && !f.isMoveDest && f.op !== 'Add' && !existsSync(resolved)) {
        fault(
          `this patch ${f.isMoveSource ? 'moves' : f.op === 'Delete' ? 'removes' : 'updates'} ${f.path}, which does not exist under ${base.replace(/\\/g, '/')}. ` +
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
  // jq, asked for BEFORE any script starts. Most scripts read their payload with
  // it, and without it they split two ways, both wrong: the ones under `set -e`
  // exit 127 with bash's "jq: command not found" swallowed by their own
  // `2>/dev/null`, and the rest take their "nothing to inspect" branch and pass.
  // A requirement is all-or-nothing here, as bash is: the scripts that do not
  // use jq are held back too, so that its absence shows at session start and
  // not at the first push. (Asking "does THIS script use jq" would mean reading
  // shell text, through every file it sources, to decide whether a check runs.)
  // The question goes to the SAME bash the scripts run under, because its PATH is
  // not node's (Git for Windows' bash.exe adds directories of its own).
  //
  // Seconds → ms. Absent or nonsensical numbers mean "no bound of our own":
  // Codex's timeout still applies, this adapter just cannot pre-empt it.
  const perRunMs = Number(process.argv[3]) > 0 ? Math.ceil(Number(process.argv[3]) * 1000) : 0;
  const budgetMs = Number(process.argv[4]) > 0 ? Number(process.argv[4]) * 1000 : 0;
  // Leave room to report: once Codex's own timeout fires, the run is merely
  // Failed and the action proceeds — this adapter must speak first.
  // WHOLE milliseconds: node rejects a fractional `timeout` outright ("must be an
  // unsigned integer"), and a fractional budget left a fraction of one to spend —
  // seen only on a runner fast enough to reach this line inside the first ms.
  const deadline = budgetMs ? STARTED + Math.floor(Math.max(budgetMs - 1500, budgetMs * 0.8)) : 0;
  // The probe spends the same budget as the runs. With none left it is not
  // started: the loop below says "out of time" before its first run.
  const probeMs = deadline ? Math.min(deadline - Date.now(), 10000) : 10000;
  if (probeMs > 0) {
    const probe = spawnSync(bash, ['-c', 'command -v jq'], { cwd, encoding: 'utf8', timeout: probeMs, killSignal: 'SIGKILL' });
    if (probe.error) fault(`could not start bash, or it did not answer within ${probeMs / 1000}s (${probe.error.message}). ${ON_PATH} This needs a person.`);
    if (probe.status !== 0) {
      fault(`jq is not on the PATH that bash sees. Most hook scripts read their payload with it, the blocking ones among them, and without it they either die with no message or read nothing and pass — so NO hook is run until it is installed. ${ON_PATH} This needs a person.`);
    }
  }
  // Two readers, two ways out. A patch too large for its budget is split. A plain
  // command has nothing to split: there the time went on starting up — node, a cold
  // bash, the jq probe — and the way out is to try again, so the message says how
  // much was spent before the check began. ("Split the patch" on a blocked
  // `git commit` sent its reader looking for a patch that did not exist.)
  const isPatch = toolName === 'apply_patch' || Boolean(carried);
  const beforeRunsMs = Date.now() - STARTED;
  const outOfTime = (wherePatch, restPatch, whereCommand) => {
    const budget = `budget ${budgetMs / 1000}s; stopping at ${(deadline - STARTED) / 1000}s to report before Codex's own timeout`;
    return isPatch
      ? `${name}: out of time ${wherePatch} (${budget}) — ${restPatch} NOT checked. Split the patch into smaller ones.`
      : `${name}: out of time ${whereCommand} (${budget}; ${(beforeRunsMs / 1000).toFixed(1)}s of it went on starting up — node, finding bash, asking it for jq — before the check began) — this command was NOT checked. ` +
          `Run it again: a slow first start is the usual cause. If it repeats, raise this hook's \`timeout\` in .claude/settings.json and run node tools/agentic-sync/port.mjs --write.`;
  };
  const contexts = [];
  const messages = [];
  const texts = [];
  const crashes = [];
  let deny = null;
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const remaining = deadline ? deadline - Date.now() : Infinity;
    if (remaining <= 0) {
      fault(outOfTime(`after checking ${i} of ${runs.length} paths`, 'the rest were', 'before the check could start'));
    }
    const timeout = Math.min(perRunMs || Infinity, remaining);
    const res = spawnSync(bash, [script], {
      input: JSON.stringify(run.payload),
      cwd,
      env: { ...process.env, ...run.env },
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT,
      ...(Number.isFinite(timeout) ? { timeout, killSignal: 'SIGKILL' } : {}),
    });
    if (res.error && res.error.code === 'ETIMEDOUT' && perRunMs && remaining < perRunMs) {
      // The PATCH budget cut this run short, not the hook's own bound. Saying
      // "raise the hook's timeout" here would send the reader to the wrong fix.
      fault(outOfTime(`while checking path ${i + 1} of ${runs.length}`, 'it and the rest were', 'while the check was running'));
    }
    if (res.error && res.error.code === 'ETIMEDOUT') {
      fault(
        `${name}: timed out after ${Math.round(timeout / 1000)}s on ${run.env.TOOL_INPUT_file_path || 'this command'} — it was NOT checked. ` +
          `The bound is this hook's \`timeout\` in .claude/settings.json ` +
          `(where there is none, hooks.defaultTimeoutSeconds in tools/agentic-sync/port.json): raise it, then run node tools/agentic-sync/port.mjs --write.`,
      );
    }
    // bash started a moment ago (the jq probe), so this is the RUN failing to
    // complete — output past maxBuffer (ENOBUFS), an environment too large to
    // exec — not a missing interpreter.
    //
    // EXCEPT a payload the script chose not to read. Several ported scripts decide
    // without reading stdin, and with a payload larger than the pipe buffer node
    // reports the unfinished WRITE as the error (`EOF` on Windows — measured —
    // `EPIPE` elsewhere) although the script ran to its own exit code. That code
    // is the verdict: read as a failed run, an `exit 0` became a block and, on
    // PostToolUse, an `exit 2` became a mere failure.
    const unreadPayload = res.error && (res.error.code === 'EOF' || res.error.code === 'EPIPE') && typeof res.status === 'number';
    if (res.error && !unreadPayload) {
      fault(`${name}: the run could not be completed (${res.error.message}) — ${run.env.TOOL_INPUT_file_path || 'this command'} was NOT checked. If the script printed more than ${MAX_OUTPUT / (1024 * 1024)} MiB, that is the cause: a hook reports a verdict, not a file.`);
    }
    // 126/127 mean a command was found but could not be executed / was not found
    // at all — the script itself, OR anything it calls: under `set -e` a missing
    // tool ends the script with 127 too, so the message may not blame bash.
    // Either way no verdict was reached. Treated as a crash they would exit 1,
    // Codex would mark the run Failed, and the action would proceed unchecked.
    if (res.status === 126 || res.status === 127) {
      fault(
        `${name} exited ${res.status} (${res.status === 127 ? 'command not found' : 'found but not executable'})${res.stderr ? `: ${res.stderr.trim()}` : ''} — the check did not run. ` +
          `Either bash could not run the script itself, or the script called a tool that is ${res.status === 127 ? 'not on PATH' : 'not executable'}. bash and jq both answered a moment ago, so it is neither of those — the scripts also call tools such as python3, gh, curl and npx. ` +
          `A script that hides its own stderr will not say which, so trace it by hand: bash -x .claude/hooks/${name} </dev/null. This needs a person.`,
      );
    }
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
