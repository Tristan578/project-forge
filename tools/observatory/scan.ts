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

export type Confidence = 'extracted' | 'reviewed';
export type ExclusionCategory = 'generated' | 'vendored' | 'binary';

export interface CapabilityRule {
  capabilityId: string;
  domain: string;
  confidence: Confidence;
  /** Glob patterns whose matched files this capability OWNS (primary attribution). */
  own: string[];
  /**
   * The single representative artifact for the capability. Must be one of the
   * owned files when the capability has code; a declared owner absent from the
   * tracked set is reported as a `missing-primary-owner` gap.
   */
  primaryOwner?: string;
  /**
   * Glob patterns of files owned by OTHER capabilities that also link here.
   * These become secondary/cross-links; they never re-own a file, so they do
   * not affect the accounting denominator.
   */
  crossLink?: string[];
}

export interface ExclusionRule {
  category: ExclusionCategory;
  /** Human-readable justification. Required — a category alone is not a reason. */
  reason: string;
  patterns: string[];
}

export interface PlannedCapability {
  capabilityId: string;
  domain: string;
  /** The requirement this planned capability tracks before any code exists. */
  requirement: string;
  confidence: Confidence;
}

export interface Alias {
  from: string;
  to: string;
}

export interface ScanConfig {
  files: string[];
  rules: CapabilityRule[];
  exclusions?: ExclusionRule[];
  planned?: PlannedCapability[];
  aliases?: Alias[];
  /** Path prefixes this scan claims to cover; anything else is `notYetCovered`. */
  coveredScopes: string[];
}

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

export interface ExcludedFile {
  path: string;
  category: ExclusionCategory;
  reason: string;
}

export type Gap =
  | { type: 'unmapped-in-covered-scope'; path: string }
  | { type: 'missing-primary-owner'; capabilityId: string; path: string }
  | { type: 'capability-without-artifact'; capabilityId: string }
  | { type: 'broken-alias'; from: string; to: string };

export interface Accounting {
  trackedTotal: number;
  ownedTotal: number;
  excludedTotal: number;
  unmappedTotal: number;
  notYetCoveredTotal: number;
  /** True when the four buckets sum exactly to the tracked denominator. */
  reconciles: boolean;
}

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
          re += '.*';
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

/**
 * Resolve a capability ID through the alias table, following at most `from -> to`
 * chains and guarding against cycles. Returns the input unchanged when no alias
 * applies.
 */
export function resolveCapabilityId(aliases: Alias[], id: string): string {
  const map = new Map(aliases.map((a) => [a.from, a.to]));
  const seen = new Set<string>();
  let current = id;
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current) as string;
  }
  return current;
}

/**
 * Pure inventory pass over an in-memory config. Deterministic: every collection
 * in the result is sorted, and no wall-clock value is embedded.
 */
export function scan(config: ScanConfig): ScanResult {
  const files = [...new Set(config.files)].sort(byString);
  const { rules } = config;
  const exclusions = config.exclusions ?? [];
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
  for (const { rule, crossLink } of compiledRules) {
    if (crossLink.length === 0) continue;
    const rec = recById.get(rule.capabilityId);
    if (!rec) continue;
    const links = new Set<string>();
    for (const file of files) {
      const id = owner.get(file);
      if (id && id !== rule.capabilityId && matchesAny(crossLink, file)) links.add(file);
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
    if (rec.planned) continue;
    if (rec.primaryOwner && !fileSet.has(rec.primaryOwner)) {
      gaps.push({ type: 'missing-primary-owner', capabilityId: rec.capabilityId, path: rec.primaryOwner });
    }
    if (rec.members.length === 0) {
      gaps.push({ type: 'capability-without-artifact', capabilityId: rec.capabilityId });
    }
  }
  for (const a of aliases) {
    if (!capIds.has(a.to)) gaps.push({ type: 'broken-alias', from: a.from, to: a.to });
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
    aliases: [...aliases].sort((a, b) => byString(a.from + a.to, b.from + b.to)),
    coveredScopes,
    accounting,
  };
}

/** Schema version for the machine-readable inventory artifact. */
export const INVENTORY_SCHEMA_VERSION = 1 as const;

/**
 * Build the normalized machine-readable inventory object. Contains no
 * timestamps so two runs on the same commit tree serialize byte-identically.
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

/**
 * Build the human-readable unmapped/excluded report. Deterministic; the
 * `coverageScope` argument names the domains this slice does and does not cover
 * so uncovered areas are an explicit entry rather than a silent omission.
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
  for (const d of [...coverageScope.covered].sort(byString)) lines.push(`- ${d}`);
  lines.push('');
  lines.push(
    'Domains **not yet covered** (explicit gap — tracked files here are reported as ' +
      '`notYetCovered`, never silently dropped):',
  );
  lines.push('');
  for (const d of [...coverageScope.notYetCovered].sort(byString)) lines.push(`- ${d}`);
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
    for (const e of result.excluded) lines.push(`| ${e.path} | ${e.category} | ${e.reason} |`);
  }
  lines.push('');

  lines.push('## Unmapped (in-scope gaps)');
  lines.push('');
  if (result.unmapped.length === 0) {
    lines.push('_None — every in-scope tracked file is owned or excluded._');
  } else {
    for (const f of result.unmapped) lines.push(`- ${f}`);
  }
  lines.push('');

  lines.push('## Extracted mappings (candidates — need review)');
  lines.push('');
  const extracted = result.capabilities.filter((c) => c.confidence === 'extracted' && !c.planned);
  if (extracted.length === 0) {
    lines.push('_None._');
  } else {
    for (const c of extracted) {
      lines.push(`- \`${c.capabilityId}\` (${c.domain}) — ${c.members.length} file(s)`);
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
      lines.push(`| ${prefix} | ${count} |`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/* c8 ignore start -- CLI wiring is exercised manually via `npm run observatory:scan`. */

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

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here })
    .toString('utf8')
    .trim();

  const rulesMod = await import('./capabilityRules.ts');
  const aliasesRaw = JSON.parse(fs.readFileSync(path.join(here, 'aliases.json'), 'utf8')) as {
    aliases: Alias[];
  };

  const files = listTrackedFiles(repoRoot);
  const result = scan({
    files,
    rules: rulesMod.CAPABILITY_RULES,
    exclusions: rulesMod.EXCLUSION_RULES,
    planned: rulesMod.PLANNED_CAPABILITIES,
    aliases: aliasesRaw.aliases,
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

/* c8 ignore stop */
