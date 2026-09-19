#!/usr/bin/env node
// Codex CLI surface generator — finishes the cross-tool port behind #9745.
//
// PROBLEM IT SOLVES
// The first port of `.claude/` to OpenAI Codex CLI was made by copying and
// find-and-replace. It shipped nothing: 143 references pointed at `.Codex/rules`,
// `.Codex/tools` and `.Codex/skills` (directories that do not exist),
// `.codex/hooks.json` wired 26 of the 39 hooks `.claude/settings.json` did, and
// the copied skills had drifted from their originals within days. It was
// quarantined in `.gitignore` with the instruction to redo it as "a generator
// plus a drift gate". This is that generator.
//
// WHAT IT EMITS — all derived, none hand-edited
//   1. `.agents/skills/<name>/**`   byte-exact mirror of `.claude/skills/<name>/`.
//      Codex discovers repo skills from `.agents/skills` — and from the project
//      layer's `.codex/skills`, which this repository does not use — and has no
//      configurable extra directory (codex-rs core-skills/src/loader.rs). A
//      symlink would avoid the copy, but this repo is developed on Windows with
//      `core.symlinks=false`, where a git symlink checks out as a text stub —
//      the skills would silently not exist for the one platform Codex is
//      installed on here. Bodies are NOT rewritten: a path like
//      `.claude/rules/x.md` inside a skill is a real path, and rewriting it is
//      precisely what produced the 143 dead references.
//   2. `.codex/agents/<name>.toml`  from `.claude/agents/<name>.md`. Codex needs
//      `name`, `description` and `developer_instructions` (codex-rs
//      core/src/config/agent_roles.rs). Claude-only frontmatter (`model`,
//      `tools`, `skills`, `mcpServers`, `hooks`, `memory`, `maxTurns`,
//      `isolation`) names mechanisms Codex does not have and is dropped;
//      `model` is omitted so the agent inherits the session's model.
//   3. `.codex/hooks.json`          from `.claude/settings.json`. Every wired
//      hook is either ported or named in port.json with a reason. An event or
//      script that is neither is a HARD ERROR — that is the property the first
//      port lacked.
//   4. `.codex/hook-conditions.json`  the `if` conditions of those hooks, which
//      Codex has no key for; the adapter applies them.
//   5. `tools/agentic-sync/port.lock.json`  every generated path WITH THE HASH
//      of what was written, so a skill or agent DELETED from `.claude/` is
//      removed from the mirror instead of lingering as an orphan nobody owns.
//      The hash is what makes deletion safe: the target directories also hold
//      files this tool does not own (third-party skills, the `independent`
//      ones, hand-authored agents), the lock is an editable text file, and
//      --write deletes ONLY a file that is still byte-for-byte what it wrote.
//
// MODES
//   --write   regenerate everything, delete orphans named by the previous lock.
//             It can still EXIT 1: regenerating does not fix everything it
//             checks. A new source file git does not track yet (`untracked:`),
//             a mirrored script whose executable bit is not staged on a
//             core.fileMode=false checkout (`mode: … not staged`), and
//             `modified:` / `ref:` / `mcp:` problems are reported by --write
//             too. For the first two the fix is `git add`, then --write again.
//   --check   exit 1 on any difference. Never writes. Also validates that every
//             repo path named inside a `.codex/` file resolves, CASE-EXACTLY —
//             `existsSync('.Codex/rules')` is TRUE on a case-insensitive
//             filesystem when `.codex/rules` exists, so a plain exists-check
//             would pass the exact defect this gate is here to catch.
//
// DESIGN NOTES
//  * Zero dependencies, like sync.mjs. `git` is used when present, and it
//    decides four things: WHICH source files are mirrored at all (only tracked
//    ones — see planSkills), which are symlinks (mode 120000; on Windows those
//    are text stubs and must be dereferenced by hand), what the executable bit
//    should be where the filesystem cannot say (core.fileMode=false), and what
//    `.codex/config.toml` DECLARES (the committed blob, for MCP parity). With
//    no repository — the hermetic fixtures — every file on disk is taken.
//  * Deterministic: sorted traversal, no timestamps.
//  * Fail-closed: a malformed manifest, a missing source directory, an empty
//    skill set or an unclassified hook is exit 2, never "in sync".
//
// TEST SEAM (never set in CI; used by scripts/__tests__/check-codex-port.test.sh)
//   CODEX_PORT_ROOT — base directory holding the manifest, sources and targets.

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CODEX_PORT_ROOT
  ? resolve(process.env.CODEX_PORT_ROOT)
  : resolve(HERE, '..', '..');
const MANIFEST = join(ROOT, 'tools', 'agentic-sync', 'port.json');
const LOCK_REL = 'tools/agentic-sync/port.lock.json';

function die(msg) {
  console.error(`::error::codex-port: ${msg}`);
  process.exit(2);
}

const abs = (rel) => join(ROOT, ...rel.split('/'));

// --- filesystem helpers ------------------------------------------------------

// Filled by main() before any lookup: path -> git mode, when git is available.
let INDEX_MODES = new Map();
// Source files git does not track: not mirrored, and said so. Two kinds. One
// git IGNORES (`__pycache__`, an editor backup) is noise and only listed. One
// it does not is a file somebody is about to commit: leaving it out of the plan
// made a local --check green, and the first red appeared in CI once the file was
// committed and the mirror was found missing. That one is a PROBLEM, now.
const UNTRACKED_SOURCES = [];
function unignoredUntracked(dir) {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '--others', '--exclude-standard', '-z', '--', dir], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}
// Does git read the executable bit from the filesystem here?
let FILEMODE_TRUSTED = process.platform !== 'win32';

// Case-EXACT existence: walk each segment against the directory listing.
//
// A git symlink is followed by hand. With `core.symlinks=false` (the Windows
// default) a link checks out as a text stub holding its target, so
// `.claude/skills/tdd/SKILL.md` — a real path on macOS and Linux, where
// `.claude/skills/tdd` links to `.agents/skills/tdd` — would otherwise read as
// unresolved on exactly one platform.
function existsExact(rel, depth = 0) {
  if (depth > 8) return false;
  const segs = rel.split('/').filter(Boolean);
  let dir = ROOT;
  for (let i = 0; i < segs.length; i += 1) {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return false;
    }
    if (!names.includes(segs[i])) return false;
    const soFar = segs.slice(0, i + 1).join('/');
    if (i < segs.length - 1 && INDEX_MODES.get(soFar) === '120000' && !lstatSync(join(dir, segs[i])).isSymbolicLink()) {
      const target = readFileSync(join(dir, segs[i]), 'utf8').trim();
      const resolved = posix.normalize(posix.join(posix.dirname(soFar), target, ...segs.slice(i + 1)));
      return !resolved.startsWith('..') && existsExact(resolved, depth + 1);
    }
    dir = join(dir, segs[i]);
  }
  return true;
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

// Text is compared and written with LF so a CRLF checkout can neither report
// phantom drift nor commit CRLF into a mirror whose source is LF.
function normalize(buf) {
  if (isBinary(buf)) return buf;
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

// Paths git records as symlinks / executables, when git can tell us.
function gitIndex() {
  const modes = new Map();
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-s', '-z'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const rec of out.split('\0')) {
      const m = /^(\d{6}) [0-9a-f]+ \d\t(.+)$/.exec(rec);
      if (m) modes.set(m[2], m[1]);
    }
  } catch {
    // No git, or not a repository: symlinks are then detected by lstat alone.
  }
  return modes;
}

// Read a source file, dereferencing a symlink whether the platform checked it
// out as a real link or as a text stub holding the link target.
//
// CONTAINMENT, identically on both branches. A link's TARGET CONTENT is copied
// into a tracked file, in the one directory reviewers are told not to read line
// by line — so a link such as `notes -> ../../../.env.local` would publish a
// secret through a "regenerate and commit" instruction. The target must
// therefore be (a) inside the repository and (b) a file git TRACKS. "Inside the
// repo" alone is not enough: `.env.local` is inside it. When git is unavailable
// the tracked test cannot be made, and a link is refused rather than trusted.
function readSource(rel, modes) {
  const p = abs(rel);
  const st = lstatSync(p);
  const isLink = st.isSymbolicLink();
  const isStub = !isLink && modes.get(rel) === '120000';
  if (!isLink && !isStub) return readFileSync(p);

  let resolved;
  if (isLink) {
    const real = realpathSync(p);
    const realRoot = realpathSync(ROOT);
    if (!real.startsWith(realRoot + sep)) die(`symlink ${rel} points outside the repository`);
    resolved = real.slice(realRoot.length + 1).split(sep).join('/');
  } else {
    const target = readFileSync(p, 'utf8').trim();
    if (target.startsWith('/') || /^[A-Za-z]:/.test(target)) die(`symlink ${rel} has an absolute target (${target})`);
    resolved = posix.normalize(posix.join(posix.dirname(rel), target));
    if (resolved.startsWith('..')) die(`symlink ${rel} points outside the repository (${target})`);
  }
  if (!existsExact(resolved)) die(`symlink ${rel} -> ${resolved} does not resolve`);
  if (!modes.has(resolved)) {
    die(`symlink ${rel} -> ${resolved}: the target is not a file git tracks, so its content will not be copied into the mirror`);
  }
  return readFileSync(abs(resolved));
}

function walk(relDir, modes, out = []) {
  for (const name of readdirSync(abs(relDir)).sort()) {
    const rel = `${relDir}/${name}`;
    const st = lstatSync(abs(rel));
    if (st.isDirectory()) walk(rel, modes, out);
    else if (st.isFile() || st.isSymbolicLink()) out.push(rel);
  }
  return out;
}

// --- manifest ----------------------------------------------------------------

function loadManifest() {
  if (!existsSync(MANIFEST)) die(`manifest not found: ${MANIFEST}`);
  let m;
  try {
    m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    die(`manifest is not valid JSON: ${e.message}`);
  }
  // Every field this file dereferences, checked up front. Without this a
  // valid-JSON manifest missing a key surfaced as an uncaught TypeError and
  // exit 1 — which the gate reads as "drift", not "could not run".
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const need = (path, test, what) => {
    const v = path.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), m);
    if (!test(v)) die(`manifest.${path} must be ${what}`);
  };
  const str = (v) => typeof v === 'string' && v.length > 0;
  const strs = (v) => Array.isArray(v) && v.every(str);
  for (const k of ['skills', 'agents', 'hooks']) need(k, isObj, 'an object');
  for (const k of ['skills.source', 'skills.target', 'agents.source', 'agents.target', 'hooks.source', 'hooks.target', 'hooks.adapter', 'hooks.conditions', 'hooks.scriptDir']) {
    need(k, str, 'a non-empty string');
  }
  for (const k of ['hooks.supportedEvents', 'hooks.matcherlessEvents', 'agents.reasoningEffort']) need(k, strs, 'an array of strings');
  for (const k of ['skills.independent', 'agents.handAuthored', 'agents.droppedFrontmatterKeys', 'hooks.toolAliases', 'hooks.unsupportedEvents', 'hooks.skipScripts', 'hooks.droppedHandlerKeys']) {
    need(k, isObj, 'an object');
  }
  need('hooks.patchTimeoutFactor', (v) => Number.isInteger(v) && v >= 1, 'a positive integer');
  need('hooks.maxTimeoutSeconds', (v) => Number.isInteger(v) && v >= 1, 'a positive integer');
  need('hooks.adapterOverheadSeconds', (v) => Number.isInteger(v) && v >= 2, 'an integer of at least 2');
  need('hooks.defaultTimeoutSeconds', (v) => Number.isInteger(v) && v >= 1, 'a positive integer');
  return m;
}

// --- 1. skills ---------------------------------------------------------------

function planSkills(m, modes, plan) {
  const { source, target, independent = {} } = m.skills;
  if (!existsExact(source)) die(`skills source not found: ${source}`);
  let mirrored = 0;
  for (const name of readdirSync(abs(source)).sort()) {
    const rel = `${source}/${name}`;
    const st = lstatSync(abs(rel));
    // A symlinked skill (or its Windows text stub, which is a FILE) already
    // lives on the .agents side; only real directories are project skills.
    if (st.isSymbolicLink() || !st.isDirectory() || modes.get(rel) === '120000') continue;
    if (Object.hasOwn(independent, name)) continue;
    if (!existsSync(join(abs(rel), 'SKILL.md'))) die(`${rel} has no SKILL.md — not a skill`);
    for (const file of walk(rel, modes)) {
      // Only what git TRACKS is mirrored. The content lands in a tracked file in
      // a directory reviewers are told not to read line by line, so a stray
      // `.env`, an editor backup or a `__pycache__` left beside a skill script
      // must not ride along — the same rule readSource() applies to link
      // targets. With no index to consult (not a repository, or nothing staged
      // yet) there is nothing to filter by, and every file is taken.
      if (modes.size > 0 && !modes.has(file)) {
        UNTRACKED_SOURCES.push(file);
        continue;
      }
      const out = `${target}/${file.slice(source.length + 1)}`;
      plan.set(out, { content: normalize(readSource(file, modes)), modeFrom: file });
    }
    mirrored += 1;
  }
  if (mirrored === 0) die(`no skills found under ${source} — refusing to report an empty mirror as in sync`);
  return mirrored;
}

// --- 2. agents ---------------------------------------------------------------

const PORTED_FRONTMATTER = ['name', 'description', 'effort'];

function parseAgent(rel, text, manifest) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) die(`${rel}: no YAML frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    // Top-level keys only: an indented line belongs to the key above it.
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    // Same rule as hook keys. A key Claude Code adds to agents tomorrow — a
    // permission list, a disallowed-tools key — must not vanish from the Codex
    // agents without anyone deciding what it means there.
    if (!PORTED_FRONTMATTER.includes(kv[1]) && !Object.hasOwn(manifest.agents.droppedFrontmatterKeys, kv[1])) {
      die(`${rel}: frontmatter key "${kv[1]}" is neither ported nor explained in port.json agents.droppedFrontmatterKeys`);
    }
    fm[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  for (const k of ['name', 'description']) {
    if (!fm[k]) die(`${rel}: frontmatter is missing a single-line \`${k}\``);
    // This is a line reader, not a YAML parser. A block scalar (`description: >`)
    // would otherwise come through as the one-character description ">".
    if (/^[>|][+-]?\d*$/.test(fm[k])) {
      die(`${rel}: \`${k}\` is a YAML block scalar (${fm[k]}); write it on one line — this generator does not parse multi-line YAML`);
    }
  }
  return { fm, body: m[2].replace(/^\n+/, '').replace(/\s+$/, '') };
}

// TOML basic strings (single- and multi-line) share one escape grammar.
function tomlEscape(s, multiline) {
  let out = s.replace(/\\/g, '\\\\');
  out = multiline ? out.replace(/"""/g, '""\\"') : out.replace(/"/g, '\\"');
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function renderAgent(rel, m) {
  const { fm, body } = parseAgent(rel, readFileSync(abs(rel), 'utf8'), m);
  const lines = [
    `# GENERATED from ${rel} by tools/agentic-sync/port.mjs — do not edit.`,
    `# Edit the source, then run: node tools/agentic-sync/port.mjs --write`,
    `name = "${tomlEscape(fm.name, false)}"`,
    `description = "${tomlEscape(fm.description, false)}"`,
  ];
  if (fm.effort) {
    if (!m.agents.reasoningEffort.includes(fm.effort)) {
      die(`${rel}: effort "${fm.effort}" is not a Codex model_reasoning_effort (${m.agents.reasoningEffort.join(', ')})`);
    }
    lines.push(`model_reasoning_effort = "${fm.effort}"`);
  }
  const preface =
    `This role is generated from \`${rel}\`. Paths under \`.claude/\` are real ` +
    `repository paths shared by every assistant — read them as written. Where the ` +
    `text names a Claude Code tool, use the Codex equivalent: a shell command for ` +
    `Bash/Grep/Glob/Read, \`apply_patch\` for Edit/Write, \`$skill-name\` for the ` +
    `Skill tool, and \`spawn_agent\` for the Agent tool. ` +
    `Two things this text may assume do NOT hold under Codex. (1) Hooks scoped to this one agent do ` +
    `not exist here: where it says a command "will be blocked" or is "enforced by a hook" for this ` +
    `agent, nothing will stop you — keep the rule yourself. If the role is described as read-only, ` +
    `do not write, even though Codex will let you. (2) An MCP server it tells you to use (a browser, ` +
    `a docs lookup) may not be configured in this session; if it is not, say so in your answer ` +
    `rather than skipping the step silently.`;
  lines.push(`developer_instructions = """`, tomlEscape(`${preface}\n\n${body}`, true), `"""`, '');
  return { name: fm.name, text: lines.join('\n') };
}

function planAgents(m, plan) {
  const { source, target, handAuthored = {} } = m.agents;
  if (!existsExact(source)) die(`agents source not found: ${source}`);
  const files = readdirSync(abs(source)).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) die(`no agent definitions under ${source}`);
  for (const f of files) {
    const rel = `${source}/${f}`;
    const { name, text } = renderAgent(rel, m);
    if (`${name}.md` !== f) die(`${rel}: frontmatter name "${name}" does not match the file name`);
    if (Object.hasOwn(handAuthored, name)) die(`${name} is listed as handAuthored but has a source at ${rel}`);
    plan.set(`${target}/${name}.toml`, { content: Buffer.from(text, 'utf8') });
  }
  for (const name of Object.keys(handAuthored)) {
    if (!existsExact(`${target}/${name}.toml`)) die(`handAuthored agent ${target}/${name}.toml is missing`);
  }
  return files.length;
}

// --- 3. hooks ----------------------------------------------------------------

function mapMatcher(matcher, event, h) {
  if (h.matcherlessEvents.includes(event)) return undefined; // Codex ignores it
  if (matcher === undefined || matcher === '' || matcher === '*') return undefined;
  const mapped = [];
  for (const tool of String(matcher).split('|')) {
    const to = h.toolAliases[tool];
    if (!to) die(`hooks: matcher "${matcher}" on ${event} names tool "${tool}", which has no entry in port.json hooks.toolAliases`);
    if (!mapped.includes(to)) mapped.push(to);
  }
  return mapped.join('|');
}

function planHooks(m, plan) {
  const h = m.hooks;
  if (!existsExact(h.source)) die(`hooks source not found: ${h.source}`);
  if (!existsExact(h.adapter)) die(`hook adapter not found: ${h.adapter}`);
  let settings;
  try {
    settings = JSON.parse(readFileSync(abs(h.source), 'utf8'));
  } catch (e) {
    die(`${h.source} is not valid JSON: ${e.message}`);
  }
  const out = {};
  const conditions = {};
  const report = { ported: 0, skipped: [], unsupported: [] };
  // Every key on a group or a handler is classified, exactly like events and
  // scripts. `.claude/settings.json` already carries two the first cut of this
  // generator dropped without a word: a group-level `if` on six groups and
  // `async` on one handler. A key Claude Code adds tomorrow must stop the
  // generator until someone decides what it means under Codex.
  const GROUP_KEYS = ['matcher', 'hooks', 'if'];
  const HANDLER_KEYS = ['type', 'command', 'timeout', 'statusMessage', ...Object.keys(h.droppedHandlerKeys || {})];
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    const supported = h.supportedEvents.includes(event);
    if (!supported && !Object.hasOwn(h.unsupportedEvents, event)) {
      die(`hooks: event "${event}" is wired in ${h.source} but is neither in port.json hooks.supportedEvents nor explained in hooks.unsupportedEvents`);
    }
    for (const group of groups) {
      for (const k of Object.keys(group)) {
        if (!GROUP_KEYS.includes(k)) die(`hooks: ${event} group carries key "${k}", which this generator does not know how to port — classify it in port.mjs`);
      }
      const handlers = [];
      for (const hook of group.hooks || []) {
        for (const k of Object.keys(hook)) {
          if (!HANDLER_KEYS.includes(k)) die(`hooks: a ${event} handler carries key "${k}", which is neither ported nor explained in port.json hooks.droppedHandlerKeys`);
        }
        // The whole command must be one of the two house spellings, so that an
        // argument after the script name cannot vanish: the adapter is called
        // with the script NAME only.
        const cmd = /^bash (?:"\$\(git rev-parse --show-toplevel\)\/|)\.claude\/hooks\/([\w.-]+\.sh)"?$/.exec(hook.command || '');
        if (hook.type !== 'command' || !cmd) {
          die(`hooks: cannot port this ${event} handler — expected \`bash .claude/hooks/<name>.sh\` with no arguments: ${JSON.stringify(hook.command)}`);
        }
        const name = cmd[1];
        if (!existsExact(`${h.scriptDir}/${name}`)) die(`hooks: ${event} names ${h.scriptDir}/${name}, which does not exist`);
        if (!supported) {
          report.unsupported.push(`${event}:${name}`);
          continue;
        }
        if (Object.hasOwn(h.skipScripts, name)) {
          report.skipped.push(`${event}:${name}`);
          continue;
        }
        // TIME. A Claude `timeout` bounds ONE file's check. Under Codex one hook
        // invocation covers a whole patch, and the adapter runs the script once
        // per touched path inside it — so copying the number verbatim meant a
        // dozen-file patch outran a 3 s budget, Codex marked the run Failed,
        // and the edit proceeded unchecked. The adapter gets both numbers: the
        // per-run bound, and the budget declared to Codex, which it must beat
        // so that running out of time is a BLOCK, not a silent pass.
        // A handler with NO timeout would get no per-file bound and no budget, so
        // a large patch would simply run into Codex's own timeout — Failed, and
        // the edit proceeds. It gets the manifest's default instead.
        const perRun = Number.isFinite(hook.timeout) && hook.timeout > 0 ? hook.timeout : h.defaultTimeoutSeconds;
        const aliases = String(group.matcher || '').split('|').map((tool) => h.toolAliases[tool]);
        const perPatch = aliases.includes('apply_patch');
        // A hook that inspects FILES and gates the action. Codex's exec tool
        // reports `apply_patch <<EOF … EOF` to hooks as `Bash` and only then
        // applies it as a patch, so such a hook must be offered Bash payloads
        // too; the adapter (mode `edit`) acts only on one that carries a patch.
        const editOnly = event === 'PreToolUse' && perPatch && !aliases.includes('Bash');
        // A single run still gets headroom for node and bash to start, or the
        // script's own bound could never be reached before the adapter's.
        const budget = !perRun
          ? 0
          : Math.min(h.maxTimeoutSeconds, perPatch ? perRun * h.patchTimeoutFactor : perRun + h.adapterOverheadSeconds);
        const handler = {
          type: 'command',
          // POSIX: resolve from the git root so a session started in a
          // subdirectory still finds the adapter.
          command: `node "$(git rev-parse --show-toplevel)/${h.adapter}" ${name} ${perRun} ${budget}${editOnly ? ' edit' : ''}`,
          // Windows: Codex runs hooks through the session shell, which may be
          // cmd or PowerShell; no quoting of $(...) survives both. A plain
          // relative path does — it requires Codex to be started at the repo
          // root (see docs/guides/codex-cli-support-matrix.md).
          commandWindows: `node ${h.adapter} ${name} ${perRun} ${budget}${editOnly ? ' edit' : ''}`,
        };
        if (budget) handler.timeout = budget;
        // Codex shows one status line per MATCHED handler, and matching is all it
        // does — it has no `if`. So a handler that is matched far more widely
        // than it acts would announce work it is not doing on every shell command:
        //   - an edit-only hook, matched for `Bash` to see a carried patch
        //     ("Checking sanitization patterns" on an `ls`);
        //   - a hook whose group carries an `if`, which moved into the adapter
        //     ("Checking for unreplied review comments" on every command, where
        //     Claude Code shows it on `git push` alone).
        const conditional = typeof group.if === 'string' && group.if !== '';
        if (hook.statusMessage && !editOnly && !conditional) handler.statusMessage = hook.statusMessage;
        handlers.push(handler);
        report.ported += 1;
        // Codex has no `if`. The adapter applies it, reading this file. A script
        // wired once WITHOUT a condition always runs, so record `null` for it and
        // never let a later conditional group narrow it.
        const slot = (conditions[event] ||= {});
        if (typeof group.if === 'string' && group.if && !/^Bash\(/.test(group.if)) {
          die(`hooks: ${event} group has \`if: ${JSON.stringify(group.if)}\`. Only \`Bash(…)\` conditions are ported: the adapter applies them to shell commands, and a condition on another tool would be silently skipped for a patch carried in a shell command. Decide how it should behave under Codex and teach port.mjs.`);
        }
        if (typeof group.if === 'string' && group.if) {
          if (slot[name] !== null) (slot[name] ||= []).push(group.if);
        } else {
          slot[name] = null;
        }
      }
      if (handlers.length === 0) continue;
      const entry = {};
      let matcher = mapMatcher(group.matcher, event, h);
      if (matcher === 'apply_patch' && event === 'PreToolUse') matcher = 'apply_patch|Bash'; // see `editOnly` above
      if (matcher !== undefined) entry.matcher = matcher;
      entry.hooks = handlers;
      (out[event] ||= []).push(entry);
    }
  }
  if (report.ported === 0) die('hooks: nothing was ported — refusing to emit an empty hooks.json');
  const doc = {
    description:
      'GENERATED from .claude/settings.json by tools/agentic-sync/port.mjs — do not edit. ' +
      'Each entry runs a shared .claude/hooks script through .codex/hooks/run-claude-hook.mjs, ' +
      'which translates the Codex hook payload into the shape those scripts read.',
    hooks: out,
  };
  plan.set(h.target, { content: Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf8') });
  // Only the conditional scripts are written; an absent entry means "always run".
  const cond = { _README: 'GENERATED by tools/agentic-sync/port.mjs from the `if` keys in .claude/settings.json — do not edit. Read by .codex/hooks/run-claude-hook.mjs.' };
  for (const [event, scripts] of Object.entries(conditions)) {
    for (const [name, list] of Object.entries(scripts)) {
      if (Array.isArray(list)) (cond[event] ||= {})[name] = [...new Set(list)];
    }
  }
  plan.set(h.conditions, { content: Buffer.from(`${JSON.stringify(cond, null, 2)}\n`, 'utf8') });
  return report;
}

// --- reference validation (the #9745 negative scenario) ----------------------

// Repo paths named inside the Codex surface must exist, case-exactly.
//
// The first cut of this had two blind spots, both found in review and both in
// the exact shape of the defect it exists to catch:
//   * it skipped any reference preceded by `/` — which is how this repository
//     spells nearly every hook and tool invocation
//     (`"$(git rev-parse --show-toplevel)/.claude/hooks/x.sh"`, `$ROOT/...`);
//   * it skipped a reference followed by a glob or placeholder entirely, so
//     `.Codex/rules/*.md` passed although `.Codex/rules` does not exist.
// Now: what precedes the reference decides what it is relative to, and a glob
// or placeholder still has its longest literal DIRECTORY checked.
const REF = /(?<![A-Za-z0-9_.])(\.(?:claude|codex|agents|github)\/[A-Za-z0-9_@./-]*[A-Za-z0-9_/-])/gi;
// No `@`: `@.claude/CLAUDE.md` is Claude Code's import syntax for a ROOT path.
const LEAD_CHARS = /[A-Za-z0-9_.~/:-]/;

function refCandidate(text, index, raw) {
  // The path text immediately before the match: a relative prefix (`web/`), a
  // home prefix (`~/`), or the front of an absolute path.
  let start = index;
  while (start > 0 && LEAD_CHARS.test(text[start - 1])) start -= 1;
  const lead = text.slice(start, index);
  const before = text[start - 1] || '';

  let ref = raw;
  const after = text[index + raw.length] || '';
  const placeholder = /XXX|NNN/.exec(ref);
  if (placeholder) ref = ref.slice(0, placeholder.index);
  // `*` is a glob in `.claude/rules/*.md` but Markdown emphasis in
  // `**@.claude/CLAUDE.md**`. It is emphasis when the path already ends in a
  // file extension and the asterisks are not followed by more path.
  const rest = text.slice(index + raw.length);
  const emphasis = after === '*' && /\.[A-Za-z0-9]+$/.test(raw) && /^\*{1,3}(?![A-Za-z0-9_./-])/.test(rest);
  if (placeholder || (/[<{*[]/.test(after) && !emphasis)) {
    // Keep only whole literal segments: `.claude/hooks/validate-` → `.claude/hooks`.
    ref = ref.endsWith('/') ? ref : posix.dirname(ref);
  }
  ref = ref.replace(/\/+$/, '');
  if (!ref || ref === '.') return null;

  if (lead === '' || lead === './') return ref;
  if (lead.includes('://') || lead.startsWith('~') || /^[A-Za-z]:/.test(lead)) return null; // URL, home, drive
  if (lead === '/' && /[)}"']/.test(before)) return ref; // $(…)/x, ${ROOT}/x
  if (before === '$' && /^[A-Za-z_][A-Za-z0-9_]*\/$/.test(lead)) return ref; // $ROOT/x
  if (lead.startsWith('/')) return null; // an absolute path on some other machine
  return posix.normalize(`${lead}${ref}`); // `web/.claude/agent-memory/…`
}

function unresolvedRefs(relFile, text, plan) {
  const bad = [];
  for (const match of text.matchAll(REF)) {
    const raw = match[1];
    const candidate = refCandidate(text, match.index, raw);
    // A path the generator is about to write resolves, even before --write.
    if (candidate && !candidate.startsWith('..') && !plan.has(candidate) && !existsExact(candidate)) {
      bad.push(`${relFile}: unresolved path ${candidate === raw.replace(/\/+$/, '') ? raw : `${raw} (checked as ${candidate})`}`);
    }
  }
  return [...new Set(bad)];
}

// Everything under `.codex/` that git would track: generated or hand-written,
// planned or not. `.codex/hooks/` holds one tracked file (see .gitignore); the
// rest of that directory is ignored leftovers and is not scanned.
function codexFiles(m) {
  const out = [];
  if (!existsExact('.codex')) return out;
  for (const rel of walk('.codex', INDEX_MODES)) {
    if (rel.startsWith('.codex/hooks/') && rel !== m.hooks.adapter) continue;
    out.push(rel);
  }
  return out;
}

function validateRefs(m, plan) {
  const bad = [];
  const scan = new Map();
  for (const rel of codexFiles(m)) {
    const buf = readFileSync(abs(rel));
    if (!isBinary(buf)) scan.set(rel, buf.toString('utf8'));
  }
  // What WOULD be written wins over what is on disk, so --check reports a dead
  // reference in the source even before anyone has run --write.
  for (const [rel, { content }] of plan) {
    if (rel.startsWith('.codex/') && !isBinary(content)) scan.set(rel, content.toString('utf8'));
  }
  for (const [rel, text] of scan) bad.push(...unresolvedRefs(rel, text, plan));
  return bad;
}

// Files sitting inside a generated location that the generator does not own.
// Without this the check is one-directional: a hand-added
// `.agents/skills/<mirrored>/EXTRA.md` ships to Codex users, is never removed by
// --write, and the "byte-exact mirror" claim is false while the gate is green.
function extraFiles(m, plan) {
  const extra = [];
  const mirrored = new Set();
  for (const rel of plan.keys()) {
    if (rel.startsWith(`${m.skills.target}/`)) mirrored.add(rel.split('/').slice(0, 3).join('/'));
  }
  for (const dir of [...mirrored].sort()) {
    if (!existsExact(dir)) continue;
    for (const rel of walk(dir, INDEX_MODES)) if (!plan.has(rel)) extra.push(rel);
  }
  if (existsExact(m.agents.target)) {
    for (const rel of walk(m.agents.target, INDEX_MODES)) {
      const name = posix.basename(rel).replace(/\.toml$/, '');
      if (!plan.has(rel) && !Object.hasOwn(m.agents.handAuthored || {}, name)) extra.push(rel);
    }
  }
  return extra;
}

// Mirrored scripts whose source is executable but which have no index entry to
// carry the bit — only a problem where the filesystem cannot (core.fileMode=false).
// A plain `git add` would stage them 100644 and the drift would first show in CI.
function unstagedExecutables(plan, modes) {
  if (FILEMODE_TRUSTED || modes.size === 0) return [];
  const out = [];
  for (const [rel, { modeFrom }] of plan) {
    if (modeFrom && modes.get(modeFrom) === '100755' && !modes.has(rel)) out.push(rel);
  }
  return out;
}

// Has this generated path been handed to a person? Then it is not an orphan.
function handedOver(m, rel) {
  if (rel.startsWith(`${m.skills.target}/`)) {
    const name = rel.split('/')[m.skills.target.split('/').length];
    if (Object.hasOwn(m.skills.independent, name)) return true;
    // `.claude/skills/<name>` is now a link (or its Windows stub) to the
    // .agents side: that side is the canonical copy, not a mirror.
    const src = `${m.skills.source}/${name}`;
    if (existsExact(src)) {
      const st = lstatSync(abs(src));
      if (st.isSymbolicLink() || !st.isDirectory() || INDEX_MODES.get(src) === '120000') return true;
    }
    return false;
  }
  if (rel.startsWith(`${m.agents.target}/`)) {
    return Object.hasOwn(m.agents.handAuthored, posix.basename(rel).replace(/\.toml$/, ''));
  }
  return false;
}

// The ONLY places --write may delete from. The lock is a committed text file; a
// bad merge resolution, or an edit, can put any path in it, and the first cut
// deleted whatever it named — a source hook script included.
function ownedByGenerator(m, rel) {
  return (
    rel.startsWith(`${m.skills.target}/`) ||
    rel.startsWith(`${m.agents.target}/`) ||
    rel === m.hooks.target ||
    rel === m.hooks.conditions
  );
}

// --- MCP server parity: .mcp.json <-> .codex/config.toml ----------------------

// Codex never reads `.mcp.json`, so a server added there is simply absent for
// Codex users until it is restated in `.codex/config.toml` — and nothing else
// would notice. NAMES only: command/args are not compared, because Codex
// forwards secrets by name through `env_vars` where `.mcp.json` interpolates
// `${VAR}`, so the two are never byte-identical by design.
//
// config.toml is hand-authored (and guarded by a deny rule in
// .claude/settings.json), so this is a check the generator cannot fix.
function mcpParity() {
  const out = { problems: [], note: '' };
  if (!existsExact('.mcp.json') || !existsExact('.codex/config.toml')) {
    out.note = 'MCP parity skipped — .mcp.json or .codex/config.toml is absent.';
    return out;
  }
  let want;
  try {
    want = Object.keys(JSON.parse(readFileSync(abs('.mcp.json'), 'utf8')).mcpServers || {}).sort();
  } catch (e) {
    die(`.mcp.json is not valid JSON: ${e.message}`);
  }
  // The COMMITTED blob when git can supply it, exactly as
  // scripts/check-codex-config-safety.sh does and for the same reason: a
  // contributor may have an uncommitted `[mcp_servers.*]` edit in the working
  // tree, and that must not turn a local --check red. It is tolerated, NOT
  // recommended: docs/guides/taskboard-sync.md sends personal servers to the
  // user-level ~/.codex/config.toml, because in a linked worktree
  // worktree-safety-commit.sh commits whatever is in the tree when a session
  // stops — after which the block IS committed and this check goes red. In CI
  // the checkout IS the ref under test: "what does the repository declare?".
  let config = null;
  try {
    config = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:.codex/config.toml'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    config = readFileSync(abs('.codex/config.toml'), 'utf8'); // no git, or not yet committed
  }
  const have = [];
  for (const line of config.split(/\r?\n/)) {
    // The table header of a server itself, not of a sub-table (`…sentry.env`).
    const hit = /^\s*\[mcp_servers\.("[^"]+"|[A-Za-z0-9_-]+)\]\s*(#.*)?$/.exec(line);
    if (hit) have.push(hit[1].replace(/^"|"$/g, ''));
  }
  if (have.length === 0) {
    // Not an error: a profile with no MCP block is a legitimate state, and
    // failing here would make this gate red on the tree it was introduced in.
    // It is said out loud so "nothing declared" never reads as "in parity".
    out.note = `::warning::.codex/config.toml declares no [mcp_servers.*] — Codex users have none of the ${want.length} servers in .mcp.json. Parity is enforced from the first declaration (#8767).`;
    return out;
  }
  for (const n of want) if (!have.includes(n)) out.problems.push(`mcp:      ${n} is in .mcp.json but not in .codex/config.toml`);
  for (const n of have) if (!want.includes(n)) out.problems.push(`mcp:      ${n} is in .codex/config.toml but not in .mcp.json`);
  if (out.problems.length === 0) out.note = `${have.length} MCP servers declared for Codex, matching .mcp.json.`;
  return out;
}

// --- main --------------------------------------------------------------------

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('usage: port.mjs --check | --write');
    process.exit(2);
  }
  const m = loadManifest();
  const modes = gitIndex();
  INDEX_MODES = modes;
  try {
    const v = execFileSync('git', ['-C', ROOT, 'config', '--get', 'core.fileMode'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (v === 'true' || v === 'false') FILEMODE_TRUSTED = v === 'true';
  } catch {
    // Not a repository, or unset: keep the platform default.
  }
  const plan = new Map();
  const skills = planSkills(m, modes, plan);
  const agents = planAgents(m, plan);
  const hooks = planHooks(m, plan);

  const sha = (buf) => createHash('sha256').update(buf).digest('hex');

  let previous = {};
  if (existsExact(LOCK_REL)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(abs(LOCK_REL), 'utf8')).generated;
    } catch (e) {
      die(`${LOCK_REL} is not valid JSON: ${e.message}`);
    }
    // An array is the first lock format (paths only). It carries no hashes, so
    // nothing it names can be proven to be this tool's work.
    if (Array.isArray(parsed)) for (const rel of parsed) previous[rel] = null;
    else if (parsed && typeof parsed === 'object') previous = parsed;
  }
  for (const rel of Object.keys(previous)) {
    if (rel.includes('..') || rel.startsWith('/') || !ownedByGenerator(m, rel)) {
      die(`${LOCK_REL} names ${JSON.stringify(rel)}, which is outside the generator's targets — refusing to treat it as something this tool may delete. Restore the lock from git and re-run.`);
    }
  }
  // A path that has left the plan is one of three things, and only one of them
  // may be deleted:
  //   released  its skill became `independent`, or moved to the .agents side
  //             behind a symlink, or the agent became handAuthored. The file is
  //             now someone else's. Dropped from the lock; NEVER deleted.
  //   orphan    still byte-for-byte what this tool wrote. Deleted by --write.
  //   modified  no longer generated AND edited since (or the lock predates
  //             hashes). Reported; a person decides.
  const released = [];
  const orphans = [];
  const modified = [];
  for (const [rel, hash] of Object.entries(previous)) {
    if (plan.has(rel) || !existsExact(rel)) continue;
    if (handedOver(m, rel)) released.push(rel);
    else if (hash && sha(normalize(readFileSync(abs(rel)))) === hash) orphans.push(rel);
    else modified.push(rel);
  }
  const accounted = new Set([...released, ...orphans, ...modified]);
  const extras = extraFiles(m, plan).filter((rel) => !accounted.has(rel));

  // The new lock: everything in the plan, PLUS every `modified` path with the
  // hash it already had. Building it from the plan alone forgot a modified path
  // after one --write — the next --check was green with a skill deleted from
  // .claude/ still on disk and still discoverable by Codex, which is the very
  // "orphan nobody owns" the lock exists to prevent. It stays listed, and stays
  // reported, until a person deletes or restores the file.
  const generated = {};
  for (const rel of [...plan.keys()]) generated[rel] = sha(plan.get(rel).content);
  for (const rel of modified) generated[rel] = previous[rel] ?? null;
  const lock = {
    _README: 'GENERATED by tools/agentic-sync/port.mjs — each path it owns and the sha256 of what it wrote. Do not edit. --write deletes a path that has left the plan ONLY while the file still matches its hash; one that was edited since stays listed (and reported) until a person removes it.',
    generated: Object.fromEntries(Object.entries(generated).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  plan.set(LOCK_REL, { content: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8') });

  const refs = validateRefs(m, plan);

  if (mode === '--write') {
    let wrote = 0;
    for (const [rel, { content }] of plan) {
      const p = abs(rel);
      if (!(existsSync(p) && normalize(readFileSync(p)).equals(content))) {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content);
        wrote += 1;
      }
      // The executable bit on DISK follows the source. With core.fileMode=true
      // (Linux, macOS) git reads the mode from the file, so a mirrored script
      // written 0644 would be staged 100644 and then show as a mode change
      // forever. On Windows chmod is a no-op and the index is repaired below.
      if (plan.get(rel).modeFrom) {
        const from = plan.get(rel).modeFrom;
        // Where git trusts the filesystem (core.fileMode=true) the DISK mode is
        // the truth: it is what `git add` will stage, so a freshly `chmod +x`ed
        // source must produce an executable mirror before anything is staged,
        // and an index-only +x that the next `git add` reverts must not. Where
        // it does not (Windows), the disk carries no mode and the INDEX is all
        // there is.
        const wantExec = FILEMODE_TRUSTED || !modes.has(from)
          ? (statSync(abs(from)).mode & 0o111) !== 0
          : modes.get(from) === '100755';
        const hasExec = (statSync(p).mode & 0o111) !== 0;
        if (wantExec !== hasExec) chmodSync(p, wantExec ? 0o755 : 0o644);
      }
    }
    for (const rel of orphans) {
      if (!abs(rel).startsWith(ROOT + sep)) die(`refusing to delete outside the root: ${rel}`);
      rmSync(abs(rel), { force: true });
      // Drop directories the deletion emptied, up to (not including) the target root.
      for (let d = posix.dirname(rel); d.split('/').length > 2; d = posix.dirname(d)) {
        try {
          rmdirSync(abs(d));
        } catch {
          break;
        }
      }
    }
    // Executable bits. A checkout with `core.fileMode=false` (the Windows
    // default) stages every new file as 100644, so a mirrored script would lose
    // the +x its source carries and the check below would then name 35 files to
    // fix by hand. Repair the INDEX entry for outputs that are already staged;
    // a file not yet added has no index entry to repair, and --check says so.
    let chmod = 0;
    for (const [rel, { modeFrom }] of plan) {
      const want = modeFrom && modes.get(modeFrom);
      if (!want || want === '120000' || !modes.has(rel) || modes.get(rel) === want) continue;
      try {
        execFileSync('git', ['-C', ROOT, 'update-index', `--chmod=${want === '100755' ? '+x' : '-x'}`, '--', rel], {
          stdio: 'ignore',
        });
        modes.set(rel, want);
        chmod += 1;
      } catch {
        // Reported by --check with the exact command.
      }
    }
    console.log(
      `codex-port: wrote ${wrote} file(s), removed ${orphans.length} orphan(s), released ${released.length} path(s) now maintained by hand, fixed ${chmod} executable bit(s) in the index.`,
    );
  }

  const problems = [];
  // Reported in BOTH modes. --write used to print a hint about these and then
  // finish with "in sync", which it was not.
  for (const rel of unstagedExecutables(plan, modes)) {
    problems.push(`mode:     ${rel} must be executable but is not staged — git add it, then run --write again (this checkout, core.fileMode=false, cannot carry the bit on disk)`);
  }
  if (mode === '--check') {
    for (const [rel, { content, modeFrom }] of plan) {
      if (!existsExact(rel)) problems.push(`missing:  ${rel}`);
      else if (!normalize(readFileSync(abs(rel))).equals(content)) problems.push(`stale:    ${rel}`);
      else if (modeFrom && modes.size && modes.has(rel) && modes.get(rel) !== modes.get(modeFrom) && modes.get(modeFrom) !== '120000') {
        problems.push(`mode:     ${rel} is ${modes.get(rel)}, source ${modeFrom} is ${modes.get(modeFrom)} — git update-index --chmod=${modes.get(modeFrom) === '100755' ? '+x' : '-x'} ${rel}`);
      }
    }
    for (const rel of orphans) problems.push(`orphan:   ${rel} is no longer generated — --write will delete it`);
  }
  // BOTH modes, like everything below. --write never deletes a file it did not
  // write, so an unowned file in a generated location survives it — and --write
  // then said "in sync" over a tree the very next --check (and CI) rejected.
  for (const rel of extras) problems.push(`extra:    ${rel} is inside a generated location but is not generated — delete it, or add it to the source under .claude/`);
  for (const rel of modified) {
    problems.push(`modified: ${rel} is no longer generated but differs from what this tool wrote (or the lock has no hash for it) — NOT deleted. Three ways out: delete the file; restore its source under .claude/; or, if it is now maintained by hand, declare it in port.json (skills.independent / agents.handAuthored), which releases it from the lock`);
  }
  const pendingAdds = unignoredUntracked(m.skills.source);
  for (const rel of UNTRACKED_SOURCES) {
    if (pendingAdds.has(rel)) {
      problems.push(`untracked: ${rel} is not tracked by git, so it was not mirrored — \`git add\` it and run --write again, or delete it, or gitignore it`);
    }
  }
  for (const r of refs) problems.push(`ref:      ${r}`);
  const mcp = mcpParity();
  problems.push(...mcp.problems);
  // A workflow command must START its line to be rendered as an annotation.
  if (mcp.note) console.log(mcp.note.startsWith('::') ? mcp.note : `codex-port: ${mcp.note}`);

  if (UNTRACKED_SOURCES.length) {
    const shown = UNTRACKED_SOURCES.slice(0, 20);
    const more = UNTRACKED_SOURCES.length - shown.length;
    console.log(
      `codex-port: ${UNTRACKED_SOURCES.length} file(s) under ${m.skills.source} are not tracked by git and were NOT mirrored ` +
        `(git-ignored ones are only listed; the others are reported as \`untracked:\` problems):\n  ${shown.join('\n  ')}` +
        (more > 0 ? `\n  … and ${more} more` : ''),
    );
  }
  console.log(
    `codex-port: ${skills} skills, ${agents} agents, ${hooks.ported} hooks ported ` +
      `(${hooks.skipped.length} skipped by name, ${hooks.unsupported.length} on events Codex lacks).`,
  );
  if (problems.length) {
    console.error('::error::codex-port: the generated Codex surface is out of date or invalid:');
    for (const p of problems) console.error(`  ${p}`);
    // Only the recipes for what is actually listed above, and never "run
    // --write" as the fix for something --write has just reported.
    const has = (re) => problems.some((p) => re.test(p));
    if (has(/^(missing|stale|orphan):/) || has(/^mode: .* source /)) {
      console.error('Fix `missing`/`stale`/`orphan`/`mode`: node tools/agentic-sync/port.mjs --write   (then commit the result). Those files are GENERATED from .claude/ — never hand-edit them.');
    }
    if (has(/^untracked:/) || has(/^mode: .* is not staged/)) {
      console.error('Fix `untracked` / `mode … not staged`: `git add` the files named above, THEN run node tools/agentic-sync/port.mjs --write again. Running it again without staging prints this same report.');
    }
    if (has(/^(extra|modified):/)) {
      console.error('Fix `extra`/`modified`: --write never deletes a file it cannot prove it wrote; each line above says what to do with that file.');
    }
    if (has(/^ref:/)) console.error('Fix `ref`: correct the path in the SOURCE under .claude/ (or the hand-authored .codex/ file) — the generator copies text, it does not invent paths.');
    if (has(/^mcp:/)) console.error('Fix `mcp`: restate the server in .codex/config.toml, or remove it from both files. If the COMMITTED .codex/config.toml carries a personal server block that was swept into a commit by accident (a `git add -A`, a safety commit), take it back out of the commit — personal servers belong in ~/.codex/config.toml.');
    process.exit(1);
  }
  console.log('codex-port: generated Codex surface is in sync with .claude/.');
}

try {
  main();
} catch (e) {
  die(`unexpected error — treating as could-not-run, not as drift: ${e && e.stack ? e.stack : e}`);
}
