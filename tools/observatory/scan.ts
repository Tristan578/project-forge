/**
 * Observatory inventory scanner (core).
 *
 * Deterministic, read-only mapping of git-tracked files to stable capability
 * IDs. The tracked-file set produced by `git ls-files -z` is the denominator;
 * every tracked file resolves to exactly ONE of four buckets:
 *
 *   - owned         a capability's primary attribution (counted once)
 *   - excluded      a reasoned exclusion (generated | vendored | binary)
 *   - unmapped      inside a covered scope but matched by no rule  -> a GAP
 *   - notYetCovered outside every covered scope  -> an explicit, expected gap
 *
 * Ownership precedence is OWN > EXCLUDE > (in-scope ? UNMAPPED : NOT_YET_COVERED):
 * an explicit mapping rule always wins over a broad exclusion glob, so a mapped
 * file can never be silently swallowed by an exclusion pattern.
 *
 * The exported `scan()` is a pure function over an in-memory {@link ScanConfig}
 * so tests can drive it with fixture catalogs and never touch the working tree.
 * The CLI at the bottom builds the real config from `git ls-files` + the
 * reviewed ruleset and writes the two artifacts.
 *
 * See ./README.md for the mapping-rule schema and how to extend coverage.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Declared confidence in a file-to-capability mapping; not runtime validation. */
export type Confidence = 'extracted' | 'reviewed';
/** Reason category for a tracked file intentionally omitted from ownership. */
export type ExclusionCategory = 'generated' | 'vendored' | 'binary';

/** Ordered ownership and secondary-link patterns for one stable capability ID. */
export interface CapabilityRule {
  capabilityId: string;
  domain: string;
  confidence: Confidence;
  /** First matching rule owns the file; later matches become secondary links. */
  own: string[];
  /**
   * The single representative artifact for the capability. Must be one of the
   * owned files. Missing or differently attributed paths produce an actionable
   * primary-owner gap, even when the path exists in the tracked set.
   */
  primaryOwner?: string;
  /**
   * Glob patterns of files owned by OTHER capabilities that also link here.
   * These become secondary/cross-links; they never re-own a file, so they do
   * not affect the accounting denominator.
   */
  crossLink?: string[];
}

/** Patterns excluded from otherwise unowned files, with a nonblank justification. */
export interface ExclusionRule {
  category: ExclusionCategory;
  /** Human-readable justification. Required — a category alone is not a reason. */
  reason: string;
  patterns: string[];
}

/** A requirement recorded before its implementation artifacts are complete. */
export interface PlannedCapability {
  capabilityId: string;
  domain: string;
  /** The requirement this planned capability tracks before any code exists. */
  requirement: string;
  confidence: Confidence;
}

/** A directed rename from a prior capability ID to another ID in the alias chain. */
export interface Alias {
  from: string;
  to: string;
}

/** Pure scanner inputs: tracked paths, ordered mappings, and explicit coverage scope. */
export interface ScanConfig {
  files: string[];
  rules: CapabilityRule[];
  exclusions?: ExclusionRule[];
  planned?: PlannedCapability[];
  aliases?: Alias[];
  /** Unowned, non-excluded paths outside these prefixes become `notYetCovered`. */
  coveredScopes: string[];
}

/** Normalized attribution and planning information for one capability. */
export interface CapabilityRecord {
  capabilityId: string;
  domain: string;
  confidence: Confidence;
  planned: boolean;
  requirement: string | null;
  primaryOwner: string | null;
  members: string[];
  secondaryLinks: string[];
}

/** One unowned tracked path matched by a reasoned exclusion rule. */
export interface ExcludedFile {
  path: string;
  category: ExclusionCategory;
  reason: string;
}

/** A structural mapping problem reported for repair without dropping its tracked path. */
export type Gap =
  | { type: 'unmapped-in-covered-scope'; path: string }
  | { type: 'missing-primary-owner'; capabilityId: string; path: string }
  | { type: 'primary-owner-not-owned'; capabilityId: string; path: string; actualOwner: string | null; bucket: 'owned' | 'excluded' | 'unmapped' | 'notYetCovered' }
  | { type: 'capability-without-artifact'; capabilityId: string }
  | { type: 'broken-alias'; from: string; to: string }
  | AliasProblem;

type AliasProblem =
  | { type: 'alias-cycle'; cycle: string[] }
  | { type: 'ambiguous-alias'; from: string; targets: string[] };

type AliasResolution = { ok: true; target: string } | { ok: false; problem: AliasProblem };

/** Mutually exclusive file-bucket counts reconciled against unique tracked paths. */
export interface Accounting {
  trackedTotal: number;
  ownedTotal: number;
  excludedTotal: number;
  unmappedTotal: number;
  notYetCoveredTotal: number;
  /** True when the four buckets sum exactly to the tracked denominator. */
  reconciles: boolean;
}

/** Deterministically ordered attribution, diagnostics, and complete file accounting. */
export interface ScanResult {
  capabilities: CapabilityRecord[];
  excluded: ExcludedFile[];
  unmapped: string[];
  notYetCovered: string[];
  gaps: Gap[];
  aliases: Alias[];
  coveredScopes: string[];
  accounting: Accounting;
}

/**
 * Convert a repo-relative glob to an anchored RegExp.
 * Supported tokens: `**` (zero or more path segments), `*` (within one
 * segment), and literal characters. All other regex metacharacters are escaped.
 * @param glob Repository-relative path pattern; separators use forward slashes.
 * @returns A whole-path matcher supporting literal text, `*`, and `**`.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]*/)*';
          i += 2;
        } else {
          re += '[\\s\\S]*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(res: RegExp[], file: string): boolean {
  return res.some((re) => re.test(file));
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function aliasTargets(aliases: Alias[]): Map<string, string[]> {
  const targets = new Map<string, Set<string>>();
  for (const { from, to } of aliases) {
    if (!targets.has(from)) targets.set(from, new Set());
    targets.get(from)!.add(to);
  }
  return new Map([...targets].map(([from, to]) => [from, [...to].sort(byString)]));
}

function resolveAliasTarget(targets: Map<string, string[]>, id: string): AliasResolution {
  const visited: string[] = [];
  let current = id;
  while (targets.has(current)) {
    const cycleStart = visited.indexOf(current);
    if (cycleStart !== -1) {
      const cycle = visited.slice(cycleStart);
      // Normalize the rotation so each cycle is reported once regardless of
      // which alias was followed first.
      const first = cycle.indexOf([...cycle].sort(byString)[0]);
      const ordered = [...cycle.slice(first), ...cycle.slice(0, first)];
      return { ok: false, problem: { type: 'alias-cycle', cycle: [...ordered, ordered[0]] } };
    }
    const next = targets.get(current)!;
    if (next.length !== 1) {
      return { ok: false, problem: { type: 'ambiguous-alias', from: current, targets: next } };
    }
    visited.push(current);
    current = next[0];
  }
  return { ok: true, target: current };
}

function aliasProblems(targets: Map<string, string[]>): AliasProblem[] {
  const problems = new Map<string, AliasProblem>();
  for (const from of [...targets.keys()].sort(byString)) {
    const resolved = resolveAliasTarget(targets, from);
    if (!resolved.ok) problems.set(JSON.stringify(resolved.problem), resolved.problem);
  }
  return [...problems.values()];
}

/**
 * Resolve an ID to its terminal alias target; unchanged when no alias applies.
 * Identical duplicate mappings are allowed. Throws if the table contains any
 * cycle or conflicting targets, including problems outside the requested chain.
 * Target existence is checked by scan(), which has the capability catalog.
 * @param aliases Directed mappings from prior IDs to current IDs.
 * @param id Capability ID to resolve.
 * @returns The terminal target or the unchanged ID when no alias applies.
 * @throws Error when the alias table contains a cycle or conflicting targets.
 */
export function resolveCapabilityId(aliases: Alias[], id: string): string {
  const targets = aliasTargets(aliases);
  const problems = aliasProblems(targets);
  if (problems.length > 0) {
    throw new Error(`Invalid capability alias table: ${JSON.stringify(problems)}`);
  }
  const resolved = resolveAliasTarget(targets, id);
  if (!resolved.ok) throw new Error(`Invalid capability alias: ${JSON.stringify(resolved.problem)}`);
  return resolved.target;
}

/**
 * Pure inventory pass over an in-memory config. Deterministic: every collection
 * in the result is sorted, and no wall-clock value is embedded. Invalid alias
 * graphs produce gaps; an exclusion without a nonblank string reason throws
 * before any files are classified.
 * @param config Tracked paths, ordered ownership rules and reviewed exclusions.
 * @returns Sorted attribution, aliases, gaps and reconciled bucket counts.
 * @throws Error when an exclusion lacks a nonblank string reason.
 */
export function scan(config: ScanConfig): ScanResult {
  const exclusions = config.exclusions ?? [];
  exclusions.forEach((exclusion, index) => {
    if (typeof exclusion.reason !== 'string' || exclusion.reason.trim() === '') {
      throw new Error(`Exclusion rule ${index + 1} requires a non-empty string reason.`);
    }
  });
  const files = [...new Set(config.files)].sort(byString);
  const { rules } = config;
  const planned = config.planned ?? [];
  const aliases = config.aliases ?? [];
  const coveredScopes = [...config.coveredScopes].sort(byString);

  const compiledRules = rules.map((r) => ({
    rule: r,
    own: r.own.map(globToRegExp),
    crossLink: (r.crossLink ?? []).map(globToRegExp),
  }));
  const compiledExclusions = exclusions.map((e) => ({
    exclusion: e,
    res: e.patterns.map(globToRegExp),
  }));

  // 1. Ownership: first matching rule (by declaration order) wins.
  const owner = new Map<string, string>();
  for (const file of files) {
    for (const { rule, own } of compiledRules) {
      if (matchesAny(own, file)) {
        owner.set(file, rule.capabilityId);
        break;
      }
    }
  }

  // 2. Exclusions: only for files no rule owns (OWN > EXCLUDE).
  const excluded: ExcludedFile[] = [];
  const excludedSet = new Set<string>();
  for (const file of files) {
    if (owner.has(file)) continue;
    for (const { exclusion, res } of compiledExclusions) {
      if (matchesAny(res, file)) {
        excluded.push({ path: file, category: exclusion.category, reason: exclusion.reason });
        excludedSet.add(file);
        break;
      }
    }
  }

  // 3. Remaining files: unmapped (in scope) vs notYetCovered (out of scope).
  const unmapped: string[] = [];
  const notYetCovered: string[] = [];
  for (const file of files) {
    if (owner.has(file) || excludedSet.has(file)) continue;
    if (coveredScopes.some((scope) => file.startsWith(scope))) unmapped.push(file);
    else notYetCovered.push(file);
  }

  // 4. Capability records.
  const recById = new Map<string, CapabilityRecord>();
  for (const r of rules) {
    if (!recById.has(r.capabilityId)) {
      recById.set(r.capabilityId, {
        capabilityId: r.capabilityId,
        domain: r.domain,
        confidence: r.confidence,
        planned: false,
        requirement: null,
        primaryOwner: r.primaryOwner ?? null,
        members: [],
        secondaryLinks: [],
      });
    }
  }
  for (const file of files) {
    const id = owner.get(file);
    if (id) recById.get(id)?.members.push(file);
  }
  for (const rec of recById.values()) {
    rec.members.sort(byString);
    if (!rec.primaryOwner && rec.members.length > 0) rec.primaryOwner = rec.members[0];
  }
  for (const { rule, own, crossLink } of compiledRules) {
    const rec = recById.get(rule.capabilityId);
    if (!rec) continue;
    const links = new Set<string>();
    for (const file of files) {
      const id = owner.get(file);
      if (id && id !== rule.capabilityId && (matchesAny(own, file) || matchesAny(crossLink, file))) {
        links.add(file);
      }
    }
    // Preserve any links already recorded from an earlier rule with the same id.
    for (const existing of rec.secondaryLinks) links.add(existing);
    rec.secondaryLinks = [...links].sort(byString);
  }

  // 5. Planned capabilities (no code expected).
  for (const p of planned) {
    const existing = recById.get(p.capabilityId);
    if (existing) {
      existing.planned = true;
      existing.requirement = p.requirement;
    } else {
      recById.set(p.capabilityId, {
        capabilityId: p.capabilityId,
        domain: p.domain,
        confidence: p.confidence,
        planned: true,
        requirement: p.requirement,
        primaryOwner: null,
        members: [],
        secondaryLinks: [],
      });
    }
  }

  const capabilities = [...recById.values()].sort((a, b) =>
    byString(a.capabilityId, b.capabilityId),
  );

  // 6. Gaps.
  const gaps: Gap[] = [];
  const fileSet = new Set(files);
  const capIds = new Set(capabilities.map((c) => c.capabilityId));
  for (const rec of capabilities) {
    if (rec.primaryOwner && !fileSet.has(rec.primaryOwner)) {
      gaps.push({ type: 'missing-primary-owner', capabilityId: rec.capabilityId, path: rec.primaryOwner });
    } else if (rec.primaryOwner && owner.get(rec.primaryOwner) !== rec.capabilityId) {
      const actualOwner = owner.get(rec.primaryOwner) ?? null;
      gaps.push({
        type: 'primary-owner-not-owned',
        capabilityId: rec.capabilityId,
        path: rec.primaryOwner,
        actualOwner,
        bucket: actualOwner !== null ? 'owned' : excludedSet.has(rec.primaryOwner)
          ? 'excluded' : unmapped.includes(rec.primaryOwner) ? 'unmapped' : 'notYetCovered',
      });
    }
    if (!rec.planned && rec.members.length === 0) {
      gaps.push({ type: 'capability-without-artifact', capabilityId: rec.capabilityId });
    }
  }
  const targets = aliasTargets(aliases);
  gaps.push(...aliasProblems(targets));
  for (const from of targets.keys()) {
    const resolved = resolveAliasTarget(targets, from);
    if (resolved.ok && !capIds.has(resolved.target)) {
      gaps.push({ type: 'broken-alias', from, to: resolved.target });
    }
  }
  for (const file of unmapped) gaps.push({ type: 'unmapped-in-covered-scope', path: file });
  gaps.sort((x, y) => byString(JSON.stringify(x), JSON.stringify(y)));

  const ownedTotal = owner.size;
  const accounting: Accounting = {
    trackedTotal: files.length,
    ownedTotal,
    excludedTotal: excluded.length,
    unmappedTotal: unmapped.length,
    notYetCoveredTotal: notYetCovered.length,
    reconciles:
      ownedTotal + excluded.length + unmapped.length + notYetCovered.length === files.length,
  };

  return {
    capabilities,
    excluded: excluded.sort((a, b) => byString(a.path, b.path)),
    unmapped: unmapped.sort(byString),
    notYetCovered: notYetCovered.sort(byString),
    gaps,
    aliases: [...aliases].sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to)),
    coveredScopes,
    accounting,
  };
}

/** Schema version for the machine-readable inventory artifact. */
export const INVENTORY_SCHEMA_VERSION = 1 as const;

/**
 * Build the normalized machine-readable inventory object. Contains no
 * timestamps so identical scan inputs serialize byte-identically.
 * @param result Completed scan with exact, unescaped tracked paths.
 * @returns Versioned machine-readable inventory data.
 */
export function buildInventoryJson(result: ScanResult): Record<string, unknown> {
  return {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    coveredScopes: result.coveredScopes,
    accounting: result.accounting,
    capabilities: result.capabilities,
    exclusions: result.excluded,
    unmapped: result.unmapped,
    notYetCovered: result.notYetCovered,
    gaps: result.gaps,
    aliases: result.aliases,
  };
}

/** Human-readable domain labels explaining the current mapping scope. */
export interface CoverageScope {
  covered: string[];
  notYetCovered: string[];
}

/** Group a file list by its first path segment, for a compact human summary. */
function summarizeByTopDir(files: string[]): Array<{ prefix: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const prefix = f.includes('/') ? `${f.slice(0, f.indexOf('/'))}/` : f;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => byString(a.prefix, b.prefix));
}

/** Escape data as Markdown text, keeping control characters visible on one line. */
function reportLiteral(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, (character) => {
      if (character === '\n') return '\\n';
      if (character === '\r') return '\\r';
      if (character === '\t') return '\\t';
      return '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');
    })
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\\x60*_{}\[\]()#+.!|~-]/g, '\\$&');
}

/** Every structural gap gets a reference and a concrete repair in the report. */
function gapDetails(gap: Gap): [string, string, string] {
  switch (gap.type) {
    case 'unmapped-in-covered-scope':
      return ['Unmapped file', gap.path, 'Add an ownership rule or a justified exclusion.'];
    case 'missing-primary-owner':
      return ['Missing primary owner', gap.capabilityId,
        `Primary artifact ${gap.path} is not tracked. Restore it or choose an owned tracked file.`];
    case 'primary-owner-not-owned':
      return ['Primary owner not owned', gap.capabilityId,
        `${gap.path} belongs to ${gap.actualOwner ?? gap.bucket}. Choose an artifact owned by this capability or correct the ownership rules.`];
    case 'capability-without-artifact':
      return ['Capability without artifact', gap.capabilityId,
        'Map an owned artifact or declare this capability as planned.'];
    case 'broken-alias':
      return ['Broken alias', gap.from,
        `Terminal target ${gap.to} is not declared. Correct the alias chain or declare the target capability.`];
    case 'alias-cycle':
      return ['Alias cycle', gap.cycle.join(' → '), 'Remove the cycle so the alias chain reaches a terminal capability.'];
    case 'ambiguous-alias':
      return ['Ambiguous alias', gap.from,
        `Conflicting targets: ${gap.targets.join(', ')}. Keep one target for this alias source.`];
  }
}

/**
 * Build the human-readable report including every structural gap. Deterministic; the
 * `coverageScope` argument names the domains this slice does and does not cover
 * so uncovered areas are an explicit entry rather than a silent omission. Paths
 * and configuration text are escaped literals; control characters stay visible.
 * @param result Completed inventory scan.
 * @param coverageScope Human-readable covered and uncovered domain labels.
 * @returns Markdown safe from headings or table rows embedded in input text.
 */
export function buildUnmappedReport(result: ScanResult, coverageScope: CoverageScope): string {
  const a = result.accounting;
  const lines: string[] = [];
  lines.push('# Observatory inventory — unmapped & excluded report');
  lines.push('');
  lines.push(
    'Generated by `tools/observatory/scan.ts`. Deterministic and read-only: the ' +
      'tracked-file set from `git ls-files -z` is the denominator. This artifact is ' +
      'derived — do not edit by hand.',
  );
  lines.push('');

  lines.push('## Coverage scope');
  lines.push('');
  lines.push('Domains covered by reviewed/extracted mapping rules in this slice:');
  lines.push('');
  for (const d of [...coverageScope.covered].sort(byString)) lines.push(`- ${reportLiteral(d)}`);
  lines.push('');
  lines.push(
    'Domains **not yet covered** (explicit gap — unowned, non-excluded tracked ' +
      'files here are reported as `notYetCovered`, never silently dropped):',
  );
  lines.push('');
  for (const d of [...coverageScope.notYetCovered].sort(byString)) lines.push(`- ${reportLiteral(d)}`);
  lines.push('');

  lines.push('## Accounting');
  lines.push('');
  lines.push('| Bucket | Count |');
  lines.push('| --- | --- |');
  lines.push(`| Tracked (denominator) | ${a.trackedTotal} |`);
  lines.push(`| Owned | ${a.ownedTotal} |`);
  lines.push(`| Excluded | ${a.excludedTotal} |`);
  lines.push(`| Unmapped (in-scope gap) | ${a.unmappedTotal} |`);
  lines.push(`| Not yet covered | ${a.notYetCoveredTotal} |`);
  lines.push(`| Reconciles | ${a.reconciles ? 'yes' : 'NO'} |`);
  lines.push('');

  lines.push('## Excluded files (reasoned)');
  lines.push('');
  if (result.excluded.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| Path | Category | Reason |');
    lines.push('| --- | --- | --- |');
    for (const e of result.excluded) {
      lines.push(`| ${reportLiteral(e.path)} | ${reportLiteral(e.category)} | ${reportLiteral(e.reason)} |`);
    }
  }
  lines.push('');

  lines.push('## Unmapped (in-scope gaps)');
  lines.push('');
  if (result.unmapped.length === 0) {
    lines.push('_None — every in-scope tracked file is owned or excluded._');
  } else {
    for (const f of result.unmapped) lines.push(`- ${reportLiteral(f)}`);
  }
  lines.push('');

  lines.push('## Structural gaps');
  lines.push('');
  if (result.gaps.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| Gap | Reference | Action |');
    lines.push('| --- | --- | --- |');
    for (const gap of result.gaps) {
      lines.push(`| ${gapDetails(gap).map(reportLiteral).join(' | ')} |`);
    }
  }
  lines.push('');

  lines.push('## Extracted mappings (candidates — need review)');
  lines.push('');
  const extracted = result.capabilities.filter((c) => c.confidence === 'extracted' && !c.planned);
  if (extracted.length === 0) {
    lines.push('_None._');
  } else {
    for (const c of extracted) {
      lines.push(`- ${reportLiteral(c.capabilityId)} (${reportLiteral(c.domain)}) — ${c.members.length} file(s)`);
    }
  }
  lines.push('');

  lines.push('## Not yet covered (by top-level directory)');
  lines.push('');
  if (result.notYetCovered.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| Directory | Count |');
    lines.push('| --- | --- |');
    for (const { prefix, count } of summarizeByTopDir(result.notYetCovered)) {
      lines.push(`| ${reportLiteral(prefix)} | ${count} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/** Run `git ls-files -z` and return sorted, normalized repo-relative paths. */
function listTrackedFiles(repoRoot: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0)
    .sort(byString);
}

/** Validate the required alias array before it can affect persisted rename history. */
function parseAliases(document: unknown): Alias[] {
  if (document === null || typeof document !== 'object' || Array.isArray(document) ||
      !('aliases' in document) || !Array.isArray(document.aliases)) {
    throw new Error('aliases.json must contain an aliases array (use [] for an empty history).');
  }
  return document.aliases.map((entry: unknown, index: number) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        !('from' in entry) || typeof entry.from !== 'string' || entry.from.trim() === '' ||
        !('to' in entry) || typeof entry.to !== 'string' || entry.to.trim() === '') {
      throw new Error(`aliases.json entry ${index + 1} must have nonblank string from and to fields.`);
    }
    return { from: entry.from, to: entry.to };
  });
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here })
    .toString('utf8')
    .trim();

  const rulesMod = await import('./capabilityRules.ts');
  const aliases = parseAliases(JSON.parse(fs.readFileSync(path.join(here, 'aliases.json'), 'utf8')));

  const files = listTrackedFiles(repoRoot);
  const result = scan({
    files,
    rules: rulesMod.CAPABILITY_RULES,
    exclusions: rulesMod.EXCLUSION_RULES,
    planned: rulesMod.PLANNED_CAPABILITIES,
    aliases,
    coveredScopes: rulesMod.COVERED_SCOPES,
  });

  // Default output is the package dir; OBSERVATORY_OUT_DIR redirects it (e.g. to
  // a scratch dir) so an evidence run need not write into the tracked tree.
  const outDir = process.env.OBSERVATORY_OUT_DIR ?? here;
  const inventoryPath = path.join(outDir, 'inventory.json');
  const reportPath = path.join(outDir, 'unmapped-report.md');
  fs.writeFileSync(inventoryPath, `${JSON.stringify(buildInventoryJson(result), null, 2)}\n`);
  fs.writeFileSync(reportPath, buildUnmappedReport(result, rulesMod.COVERAGE_SCOPE));

  const a = result.accounting;
  process.stdout.write(
    `observatory: tracked=${a.trackedTotal} owned=${a.ownedTotal} excluded=${a.excludedTotal} ` +
      `unmapped=${a.unmappedTotal} notYetCovered=${a.notYetCoveredTotal} ` +
      `reconciles=${a.reconciles} gaps=${result.gaps.length}\n`,
  );
  process.stdout.write(`observatory: wrote ${inventoryPath}\nobservatory: wrote ${reportPath}\n`);
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`observatory: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
