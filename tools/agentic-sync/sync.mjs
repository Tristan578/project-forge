#!/usr/bin/env node
// Cross-provider agentic-config source-of-truth generator.
//
// PROBLEM IT SOLVES
// SpawnForge ships onboarding instructions for several AI coding assistants —
// AGENTS.md (Codex/Gemini/Copilot/Antigravity), .github/copilot-instructions.md,
// .codex/AGENTS.md, .cursorrules — and they hand-mirrored the same volatile facts
// (taskboard project/team IDs, pinned versions, coverage thresholds). They drifted:
// every file carried a STALE taskboard Project ID and a dead Engineering team ID,
// and one told contributors to start the board with a `--db` flag the runbook
// forbids. A Codex/Gemini/Copilot contributor was onboarded against wrong facts.
//
// THE FIX
// One source of truth — tools/agentic-sync/canonical.json — is rendered into a
// fenced block and injected between `<!-- AGENTIC-SYNC:START -->` and
// `<!-- AGENTIC-SYNC:END -->` markers in each target file. Edit canonical.json,
// run `--write`, every provider file updates identically. `--check` (run by
// scripts/check-agentic-sync.sh in CI) fails the PR if any target drifted from
// the source, so the files can never silently diverge again.
//
// DESIGN NOTES
//  * Zero dependencies (node: builtins only) so it runs anywhere node does.
//  * Marker-injection is non-destructive: only the text between the markers is
//    replaced. Tool-specific prose outside the markers is hand-authored and
//    untouched, so each file keeps its own voice while sharing identical facts.
//  * Deterministic output (no timestamps / no Math.random) → idempotent writes
//    and a stable drift check.
//  * Fail-safe: a malformed canonical.json, a missing target, or a target whose
//    markers are absent/misordered is a hard error (exit 1), NEVER a silent
//    "in sync" — a swallowed parse error reading as green is the exact failure
//    mode the lockfile/ci-success gates were also hardened against.
//
// TEST SEAMS (never set in CI; used only by the hermetic bash suite)
//   AGENTIC_SYNC_ROOT       — base dir for canonical.json + targets
//   AGENTIC_SYNC_CANONICAL  — explicit path to the canonical.json
//
// Unit-tested by scripts/__tests__/check-agentic-sync.test.sh.

import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AGENTIC_SYNC_ROOT
  ? resolve(process.env.AGENTIC_SYNC_ROOT)
  : resolve(HERE, '..', '..');
// Real (symlink-resolved) root for the I/O boundary check. resolve() is lexical
// only, so ROOT can carry symlinked components (e.g. macOS /tmp -> /private/tmp);
// realpath BOTH sides before comparing or legitimate in-root files would
// false-trip the symlink guard below. Falls back to ROOT if it doesn't exist yet
// (a missing root surfaces as a canonical-not-found die downstream).
const REAL_ROOT = existsSync(ROOT) ? realpathSync(ROOT) : ROOT;
const CANONICAL =
  process.env.AGENTIC_SYNC_CANONICAL || join(ROOT, 'tools', 'agentic-sync', 'canonical.json');

function die(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function loadCanonical() {
  if (!existsSync(CANONICAL)) die(`canonical source not found: ${CANONICAL}`);
  let raw;
  try {
    raw = readFileSync(CANONICAL, 'utf8');
  } catch (e) {
    die(`cannot read canonical source ${CANONICAL}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    die(`canonical source is not valid JSON (${CANONICAL}): ${e.message}`);
  }
  if (!data || typeof data !== 'object') die('canonical source must be a JSON object');
  if (typeof data.markerId !== 'string' || !data.markerId)
    die('canonical.markerId must be a non-empty string');
  // markerId is interpolated raw into the literal marker comments. Constrain it to
  // a marker-safe charset so it cannot carry spaces or HTML-comment syntax that
  // would break or forge `<!-- ID:START -->` / `<!-- ID:END -->`.
  if (!/^[A-Za-z0-9:_-]+$/.test(data.markerId))
    die('canonical.markerId must match [A-Za-z0-9:_-]+ (no spaces or comment syntax)');
  if (!data.facts || typeof data.facts !== 'object') die('canonical.facts must be an object');
  if (!Array.isArray(data.targets) || data.targets.length === 0)
    die('canonical.targets must be a non-empty array of file paths');
  if (!data.targets.every((t) => typeof t === 'string' && t.length > 0))
    die('canonical.targets must all be non-empty strings');
  return data;
}

// Resolve a target relative to ROOT and refuse anything that escapes it.
// canonical.json is repo-controlled, but a `../` entry or a planted symlink
// slipping through review must NOT let the generator read or (on --write)
// rewrite a file outside the repo — fail safe rather than follow the escape.
function resolveTarget(rel) {
  const abs = resolve(ROOT, rel);
  // 1. Lexical guard — rejects `../`, absolute escapes, and ROOT itself (a `.`
  //    target: ROOT does not start with ROOT + sep, so it dies cleanly here
  //    rather than falling through to an unhandled EISDIR crash on readFileSync).
  if (!abs.startsWith(ROOT + sep)) {
    die(`target path escapes repo root: ${rel}`);
  }
  // 2. Symlink guard — resolve() is lexical and does not follow symlinks, but
  //    readFileSync/writeFileSync do. A symlink planted at an in-root target
  //    path but pointing outside the root passes the lexical check, so resolve
  //    its real destination and re-check against the real root. existsSync is
  //    false for a broken symlink (handled as "target not found" downstream).
  if (existsSync(abs)) {
    const real = realpathSync(abs);
    if (!real.startsWith(REAL_ROOT + sep)) {
      die(`target path escapes repo root via symlink: ${rel}`);
    }
  }
  return abs;
}

// Render the deterministic facts block, including the surrounding marker lines.
// Pure function of `canonical`; identical input always yields identical output.
function renderBlock(canonical) {
  const { markerId, facts } = canonical;
  // Strip comment tokens from every interpolated fact value so a fact can never
  // smuggle the marker sentinel (`<!-- AGENTIC-SYNC:END -->`) into the block. A
  // stray sentinel would terminate the managed span early and corrupt the target
  // on the next --write/--check. canonical.json is repo-controlled, so this is
  // defense in depth — it keeps one careless edit from silently breaking every
  // provider target. Removal strips whole comments — accepting BOTH the
  // standard `-->` close and the malformed-but-parser-accepted `--!>` close
  // (CodeQL js/bad-tag-filter: comment regexes that only handle `-->` are
  // bypassable via `--!>`) — plus unpaired stray tokens, and must run to a
  // FIXED POINT: a single pass can splice a fresh opener out of the
  // surrounding bytes (`<!<!-- x -->--` → `<!--`), so loop until the value is
  // stable — then it provably contains no `<!--`, `-->`, or `--!>` at all.
  // Terminates because every changing pass strictly shortens the string.
  const s = (v) => {
    let out = String(v ?? '');
    for (let prev = null; prev !== out; ) {
      prev = out;
      out = out.replace(/<!--[\s\S]*?(?:--!>|-->)|<!--|--!>|-->/g, '');
    }
    return out;
  };
  const tb = facts.taskboard || {};
  const teams = tb.teams || {};
  const versions = facts.versions || {};
  const cov = facts.coverageThresholds || {};

  const teamList = Object.entries(teams)
    .map(([name, id]) => `${s(name)} \`${s(id)}\``)
    .join(', ');
  const versionList = Object.entries(versions)
    .map(([name, v]) => `${s(name)} ${s(v)}`)
    .join(' · ');
  const covList = Object.entries(cov)
    .map(([name, v]) => `${s(name)} ${s(v)}`)
    .join(' · ');

  const lines = [
    `<!-- ${markerId}:START -->`,
    `<!-- Generated from tools/agentic-sync/canonical.json by tools/agentic-sync/sync.mjs.`,
    `     Do NOT hand-edit between these markers — edit canonical.json and run`,
    `     \`node tools/agentic-sync/sync.mjs --write\`. CI gate: scripts/check-agentic-sync.sh. -->`,
    '',
    '### Canonical Project Facts',
    '',
    '**Taskboard** — the single source of truth for all work:',
  ];
  if (tb.projectName || tb.projectId) {
    lines.push(
      `- Project: **${s(tb.projectName)}** (\`${s(tb.projectId)}\`, prefix \`${s(tb.projectPrefix)}\`)`,
    );
  }
  if (teamList) lines.push(`- Teams: ${teamList}`);
  if (tb.apiBaseUrl || tb.webUrl) {
    lines.push(`- API: \`${s(tb.apiBaseUrl)}\` · Web UI: \`${s(tb.webUrl)}\``);
  }
  if (tb.startCommand) {
    lines.push(`- Start: \`${s(tb.startCommand)}\`  *(do not pass \`--db\` — it uses the OS-default DB)*`);
  }
  if (tb.apiBaseUrl) {
    lines.push(
      `- These IDs are board-local; if a query 404s, rediscover with \`curl -s ${s(tb.apiBaseUrl)}/projects\``,
    );
  }
  if (versionList) {
    // The pin-discipline note is a project FACT, so it is co-located with the
    // versions it annotates in canonical.json (facts.versionsNote) rather than
    // hardcoded here — a renderer that hardcodes it would stamp a wrong note onto
    // any project that adopts this generator.
    const note = facts.versionsNote ? ` *(${s(facts.versionsNote)})*` : '';
    lines.push('', `**Pinned versions:** ${versionList}${note}`);
  }
  if (covList) lines.push('', `**Coverage thresholds (CI-enforced):** ${covList}`);
  if (facts.quickValidation) lines.push('', `**Quick validation:** \`${s(facts.quickValidation)}\``);
  lines.push(`<!-- ${markerId}:END -->`);
  return lines.join('\n');
}

// Replace the [START..END] marker span (inclusive, line-based) with `block`.
// Returns { content, changed } or throws a string describing the misconfiguration.
function inject(original, markerId, block) {
  const startMark = `<!-- ${markerId}:START -->`;
  const endMark = `<!-- ${markerId}:END -->`;
  const lines = original.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(startMark));
  if (startIdx === -1) throw `missing start marker (${startMark})`;
  // Find the END marker AFTER the START. A stray END appearing before the START
  // (e.g. quoted in prose) is ignored rather than mistaken for the span terminator.
  const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes(endMark));
  if (endIdx === -1) throw `missing end marker (${endMark})`;
  // Reject a second start marker inside the span — ambiguous region.
  const dupStart = lines.findIndex((l, i) => i > startIdx && i < endIdx && l.includes(startMark));
  if (dupStart !== -1) throw `duplicate start marker before end marker`;
  // Reject a second end marker after the span — equally ambiguous. Without this,
  // inject() would terminate at the first END and silently strand the trailing END
  // in the footer (a quiet corruption), instead of failing loudly.
  const dupEnd = lines.findIndex((l, i) => i > endIdx && l.includes(endMark));
  if (dupEnd !== -1) throw `duplicate end marker after block`;

  const blockLines = block.split('\n');
  const next = [...lines.slice(0, startIdx), ...blockLines, ...lines.slice(endIdx + 1)];
  const content = next.join('\n');
  return { content, changed: content !== original };
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('usage: sync.mjs --check | --write');
    process.exit(2);
  }
  const canonical = loadCanonical();
  const block = renderBlock(canonical);

  const drifted = [];
  const wrote = [];
  for (const rel of canonical.targets) {
    const path = resolveTarget(rel);
    if (!existsSync(path)) die(`target file not found: ${rel} (looked in ${ROOT})`);
    // Normalize CRLF->LF on read so drift is driven by FACTS, not line endings:
    // a Windows / git-autocrlf checkout could otherwise present a byte-different
    // (but semantically identical) target and trip --check / churn --write. The
    // committed form is pinned to LF by .gitattributes, so CI always sees LF.
    const original = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    let result;
    try {
      result = inject(original, canonical.markerId, block);
    } catch (msg) {
      die(`target ${rel}: ${msg}`);
    }
    if (mode === '--write') {
      if (result.changed) {
        writeFileSync(path, result.content);
        wrote.push(rel);
      }
    } else if (result.changed) {
      drifted.push(rel);
    }
  }

  if (mode === '--write') {
    if (wrote.length) console.log(`agentic-sync: updated ${wrote.length} file(s):\n  ${wrote.join('\n  ')}`);
    else console.log('agentic-sync: all targets already in sync — nothing to write.');
    process.exit(0);
  }

  if (drifted.length) {
    console.error('::error::agentic-config drift — these files no longer match canonical.json:');
    for (const f of drifted) console.error(`  - ${f}`);
    console.error('Run `node tools/agentic-sync/sync.mjs --write` and commit the result.');
    process.exit(1);
  }
  console.log('agentic-sync: all targets in sync with canonical.json.');
  process.exit(0);
}

main();
