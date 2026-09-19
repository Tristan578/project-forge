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
//      Codex discovers skills ONLY under `.agents/skills` (codex-rs
//      core-skills/src/loader.rs) and has no configurable extra directory. A
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
//   4. `tools/agentic-sync/port.lock.json`  the list of generated paths, so a
//      skill or agent DELETED from `.claude/` is removed from the mirror
//      instead of lingering as an orphan nobody owns.
//
// MODES
//   --write   regenerate everything, delete orphans named by the previous lock.
//   --check   exit 1 on any difference. Never writes. Also validates that every
//             repo path named inside a `.codex/` file resolves, CASE-EXACTLY —
//             `existsSync('.Codex/rules')` is TRUE on a case-insensitive
//             filesystem when `.codex/rules` exists, so a plain exists-check
//             would pass the exact defect this gate is here to catch.
//
// DESIGN NOTES
//  * Zero dependencies, like sync.mjs. `git` is used when present, only to learn
//    which source files are symlinks (mode 120000) — on Windows those are text
//    stubs and must be dereferenced by hand — and to compare executable bits.
//  * Deterministic: sorted traversal, no timestamps.
//  * Fail-closed: a malformed manifest, a missing source directory, an empty
//    skill set or an unclassified hook is exit 2, never "in sync".
//
// TEST SEAM (never set in CI; used by scripts/__tests__/check-codex-port.test.sh)
//   CODEX_PORT_ROOT — base directory holding the manifest, sources and targets.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
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
function readSource(rel, modes) {
  const p = abs(rel);
  const st = lstatSync(p);
  if (st.isSymbolicLink()) return readFileSync(p); // follows the link
  if (modes.get(rel) === '120000') {
    const target = readFileSync(p, 'utf8').trim();
    const resolved = posix.normalize(posix.join(posix.dirname(rel), target));
    if (resolved.startsWith('..')) die(`symlink ${rel} points outside the repository (${target})`);
    if (!existsExact(resolved)) die(`symlink ${rel} -> ${target} does not resolve`);
    return readFileSync(abs(resolved));
  }
  return readFileSync(p);
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
  for (const k of ['skills', 'agents', 'hooks']) {
    if (!m[k] || typeof m[k] !== 'object') die(`manifest.${k} must be an object`);
  }
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
      const out = `${target}/${file.slice(source.length + 1)}`;
      plan.set(out, { content: normalize(readSource(file, modes)), modeFrom: file });
    }
    mirrored += 1;
  }
  if (mirrored === 0) die(`no skills found under ${source} — refusing to report an empty mirror as in sync`);
  return mirrored;
}

// --- 2. agents ---------------------------------------------------------------

function parseAgent(rel, text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) die(`${rel}: no YAML frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  for (const k of ['name', 'description']) {
    if (!fm[k]) die(`${rel}: frontmatter is missing a single-line \`${k}\``);
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
  const { fm, body } = parseAgent(rel, readFileSync(abs(rel), 'utf8'));
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
    `Skill tool, and \`spawn_agent\` for the Agent tool.`;
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
  const report = { ported: 0, skipped: [], unsupported: [] };
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    const supported = h.supportedEvents.includes(event);
    if (!supported && !Object.hasOwn(h.unsupportedEvents, event)) {
      die(`hooks: event "${event}" is wired in ${h.source} but is neither in port.json hooks.supportedEvents nor explained in hooks.unsupportedEvents`);
    }
    for (const group of groups) {
      const handlers = [];
      for (const hook of group.hooks || []) {
        const name = /([\w.-]+\.sh)/.exec(hook.command || '')?.[1];
        if (hook.type !== 'command' || !name) die(`hooks: cannot port non-script hook on ${event}: ${JSON.stringify(hook)}`);
        if (!existsExact(`${h.scriptDir}/${name}`)) die(`hooks: ${event} names ${h.scriptDir}/${name}, which does not exist`);
        if (!supported) {
          report.unsupported.push(`${event}:${name}`);
          continue;
        }
        if (Object.hasOwn(h.skipScripts, name)) {
          report.skipped.push(`${event}:${name}`);
          continue;
        }
        const handler = {
          type: 'command',
          // POSIX: resolve from the git root so a session started in a
          // subdirectory still finds the adapter.
          command: `node "$(git rev-parse --show-toplevel)/${h.adapter}" ${name}`,
          // Windows: Codex runs hooks through the session shell, which may be
          // cmd or PowerShell; no quoting of $(...) survives both. A plain
          // relative path does — it requires Codex to be started at the repo
          // root (see docs/guides/codex-cli-support-matrix.md).
          commandWindows: `node ${h.adapter} ${name}`,
        };
        if (Number.isFinite(hook.timeout)) handler.timeout = hook.timeout;
        if (hook.statusMessage) handler.statusMessage = hook.statusMessage;
        handlers.push(handler);
        report.ported += 1;
      }
      if (handlers.length === 0) continue;
      const entry = {};
      const matcher = mapMatcher(group.matcher, event, h);
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
  return report;
}

// --- reference validation (the #9745 negative scenario) ----------------------

// Repo paths named inside the Codex surface must exist, case-exactly.
const REF = /(?<![\w/.-])(\.(?:claude|codex|agents|github)\/[A-Za-z0-9_@./-]*[A-Za-z0-9_/-])/gi;

function unresolvedRefs(relFile, text) {
  const bad = [];
  for (const match of text.matchAll(REF)) {
    const raw = match[1];
    const ref = raw.replace(/\/+$/, '');
    // Placeholders and globs are prose, not paths.
    const after = text[match.index + raw.length] || '';
    if (/[<{*]/.test(after) || /XXX|NNN/.test(ref)) continue;
    if (!existsExact(ref)) bad.push(`${relFile}: unresolved path ${raw}`);
  }
  return [...new Set(bad)];
}

function validateRefs(m, plan) {
  const bad = [];
  const scan = new Map();
  for (const [rel, { content }] of plan) {
    if (rel.startsWith('.codex/') && !isBinary(content)) scan.set(rel, content.toString('utf8'));
  }
  // Hand-authored Codex files are held to the same rule as generated ones.
  for (const rel of ['.codex/AGENTS.md', '.codex/config.toml']) {
    if (existsExact(rel)) scan.set(rel, readFileSync(abs(rel), 'utf8'));
  }
  for (const name of Object.keys(m.agents.handAuthored || {})) {
    const rel = `${m.agents.target}/${name}.toml`;
    if (existsExact(rel)) scan.set(rel, readFileSync(abs(rel), 'utf8'));
  }
  for (const [rel, text] of scan) bad.push(...unresolvedRefs(rel, text));
  return bad;
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
  const have = [];
  for (const line of readFileSync(abs('.codex/config.toml'), 'utf8').split(/\r?\n/)) {
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
  const plan = new Map();
  const skills = planSkills(m, modes, plan);
  const agents = planAgents(m, plan);
  const hooks = planHooks(m, plan);

  const generated = [...plan.keys()].sort();
  const lock = { _README: 'GENERATED by tools/agentic-sync/port.mjs — the paths it owns. Do not edit.', generated };
  plan.set(LOCK_REL, { content: Buffer.from(`${JSON.stringify(lock, null, 2)}\n`, 'utf8') });

  let previous = [];
  if (existsExact(LOCK_REL)) {
    try {
      previous = JSON.parse(readFileSync(abs(LOCK_REL), 'utf8')).generated || [];
    } catch (e) {
      die(`${LOCK_REL} is not valid JSON: ${e.message}`);
    }
  }
  const orphans = previous.filter((p) => !plan.has(p) && existsExact(p));

  const refs = validateRefs(m, plan);

  if (mode === '--write') {
    let wrote = 0;
    for (const [rel, { content }] of plan) {
      const p = abs(rel);
      if (existsSync(p) && normalize(readFileSync(p)).equals(content)) continue;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      wrote += 1;
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
      `codex-port: wrote ${wrote} file(s), removed ${orphans.length} orphan(s), fixed ${chmod} executable bit(s) in the index.`,
    );
  }

  const problems = [];
  if (mode === '--check') {
    for (const [rel, { content, modeFrom }] of plan) {
      if (!existsExact(rel)) problems.push(`missing:  ${rel}`);
      else if (!normalize(readFileSync(abs(rel))).equals(content)) problems.push(`stale:    ${rel}`);
      else if (modeFrom && modes.size && modes.has(rel) && modes.get(rel) !== modes.get(modeFrom) && modes.get(modeFrom) !== '120000') {
        problems.push(`mode:     ${rel} is ${modes.get(rel)}, source ${modeFrom} is ${modes.get(modeFrom)} — git update-index --chmod=${modes.get(modeFrom) === '100755' ? '+x' : '-x'} ${rel}`);
      }
    }
    for (const rel of orphans) problems.push(`orphan:   ${rel} (its source is gone)`);
  }
  for (const r of refs) problems.push(`ref:      ${r}`);
  const mcp = mcpParity();
  problems.push(...mcp.problems);
  // A workflow command must START its line to be rendered as an annotation.
  if (mcp.note) console.log(mcp.note.startsWith('::') ? mcp.note : `codex-port: ${mcp.note}`);

  console.log(
    `codex-port: ${skills} skills, ${agents} agents, ${hooks.ported} hooks ported ` +
      `(${hooks.skipped.length} skipped by name, ${hooks.unsupported.length} on events Codex lacks).`,
  );
  if (problems.length) {
    console.error('::error::codex-port: the generated Codex surface is out of date or invalid:');
    for (const p of problems) console.error(`  ${p}`);
    console.error('Fix `missing`/`stale`/`orphan`/`mode`: node tools/agentic-sync/port.mjs --write   (then commit the result)');
    console.error('Fix `ref`: correct the path in the SOURCE under .claude/ (or the hand-authored .codex/ file) — the generator copies text, it does not invent paths.');
    console.error('Fix `mcp`: restate the server in .codex/config.toml, or remove it from both files.');
    process.exit(1);
  }
  console.log('codex-port: generated Codex surface is in sync with .claude/.');
}

main();
