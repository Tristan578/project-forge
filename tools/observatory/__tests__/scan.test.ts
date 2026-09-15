import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scan,
  globToRegExp,
  resolveCapabilityId,
  buildInventoryJson,
  buildUnmappedReport,
  type ScanConfig,
  type ScanResult,
  type CapabilityRecord,
} from '../scan.ts';
import {
  CAPABILITY_RULES,
  EXCLUSION_RULES,
  PLANNED_CAPABILITIES,
  COVERED_SCOPES,
  COVERAGE_SCOPE,
} from '../capabilityRules.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'fixtures');

interface Scenario extends ScanConfig {
  description: string;
  expected: Record<string, unknown>;
}

function loadScenario(name: string): Scenario {
  const raw = fs.readFileSync(path.join(fixturesDir, name, 'scenario.json'), 'utf8');
  return JSON.parse(raw) as Scenario;
}

function findCapability(result: ScanResult, id: string): CapabilityRecord | undefined {
  return result.capabilities.find((c) => c.capabilityId === id);
}

// Every fixture, once run, must reconcile exactly and be stable across two runs.
const FIXTURE_NAMES = [
  'new-route',
  'removed-command',
  'renamed-file',
  'shared-helper',
  'planned-feature',
  'justified-generated-file',
] as const;

describe('globToRegExp', () => {
  it('matches exact paths, single-segment wildcards, and recursive globs', () => {
    expect(globToRegExp('a/b.ts').test('a/b.ts')).toBe(true);
    expect(globToRegExp('a/*.ts').test('a/b.ts')).toBe(true);
    expect(globToRegExp('a/*.ts').test('a/nested/b.ts')).toBe(false);
    expect(globToRegExp('a/**').test('a/nested/b.ts')).toBe(true);
    expect(globToRegExp('**/*.png').test('deep/dir/x.png')).toBe(true);
    expect(globToRegExp('**/*.png').test('x.png')).toBe(true);
    expect(globToRegExp('a/**/b.ts').test('a/b.ts')).toBe(true);
    expect(globToRegExp('a/**/b.ts').test('a/x/y/b.ts')).toBe(true);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(globToRegExp('a.b/c+d.ts').test('a.b/c+d.ts')).toBe(true);
    expect(globToRegExp('a.b/c+d.ts').test('aXb/cYd.ts')).toBe(false);
  });
});

describe('scan — accounting reconciles for every fixture', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: four buckets sum to the tracked denominator`, () => {
      const s = loadScenario(name);
      const result = scan(s);
      const a = result.accounting;
      expect(a.reconciles).toBe(true);
      expect(a.ownedTotal + a.excludedTotal + a.unmappedTotal + a.notYetCoveredTotal).toBe(
        a.trackedTotal,
      );
      expect(a.trackedTotal).toBe(s.expected.trackedTotal);
      expect(a.ownedTotal).toBe(s.expected.ownedTotal);
      expect(a.excludedTotal).toBe(s.expected.excludedTotal);
      expect(a.unmappedTotal).toBe(s.expected.unmappedTotal);
      expect(a.notYetCoveredTotal).toBe(s.expected.notYetCoveredTotal);
    });
  }
});

describe('scan — output is deterministic across two runs on the same input', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: identical serialized inventory on a repeat run`, () => {
      const s = loadScenario(name);
      const first = JSON.stringify(buildInventoryJson(scan(s)));
      const second = JSON.stringify(buildInventoryJson(scan(s)));
      expect(second).toBe(first);
    });
  }
});

describe('scan — no double counting (shared-helper fixture)', () => {
  it('counts a file matched by two rules exactly once and cross-links the other', () => {
    const s = loadScenario('shared-helper');
    const result = scan(s);
    const shared = s.expected.sharedFile as string;

    // The shared file appears in exactly one capability's members (owned once).
    const owningMemberships = result.capabilities.filter((c) => c.members.includes(shared));
    expect(owningMemberships).toHaveLength(1);
    expect(owningMemberships[0].capabilityId).toBe(s.expected.sharedFileOwner);

    // And it is recorded as a secondary/cross-link on the other capability.
    const crossLinked = findCapability(result, s.expected.sharedFileSecondaryLinkOn as string);
    expect(crossLinked?.secondaryLinks).toContain(shared);

    // Secondary links never inflate the denominator.
    const totalMembers = result.capabilities.reduce((n, c) => n + c.members.length, 0);
    expect(totalMembers).toBe(result.accounting.ownedTotal);
    expect(result.gaps).toHaveLength(s.expected.gapCount as number);
  });
});

describe('scan — new route surfaces as an in-scope gap (new-route fixture)', () => {
  it('reports the unmapped route rather than excluding it silently', () => {
    const s = loadScenario('new-route');
    const result = scan(s);
    expect(result.unmapped).toContain(s.expected.unmappedIncludes);
    expect(result.gaps).toContainEqual({
      type: s.expected.gapType,
      path: s.expected.gapPath,
    });
  });
});

describe('scan — removed command is a broken reference, not a silent drop (removed-command fixture)', () => {
  it('emits a missing-primary-owner gap naming the file and capability', () => {
    const s = loadScenario('removed-command');
    const result = scan(s);
    expect(result.gaps).toContainEqual({
      type: 'missing-primary-owner',
      capabilityId: s.expected.missingPrimaryOwnerCapability,
      path: s.expected.missingPrimaryOwnerPath,
    });
    expect(result.gaps).toContainEqual({
      type: 'capability-without-artifact',
      capabilityId: s.expected.capabilityWithoutArtifact,
    });
  });
});

describe('scan — renamed file keeps stable identity via aliases (renamed-file fixture)', () => {
  it('resolves the old capability ID to the current one with no broken-alias gap', () => {
    const s = loadScenario('renamed-file');
    const result = scan(s);
    expect(resolveCapabilityId(result.aliases, s.expected.resolveFrom as string)).toBe(
      s.expected.resolveTo,
    );
    expect(result.gaps).toHaveLength(s.expected.gapCount as number);
    expect(findCapability(result, s.expected.resolveTo as string)?.members).toContain(
      'lib/newName.ts',
    );
  });

  it('flags an alias whose target capability does not exist as a broken-alias gap', () => {
    const s = loadScenario('renamed-file');
    const result = scan({ ...s, aliases: [{ from: 'lib.legacy', to: 'lib.doesNotExist' }] });
    expect(result.gaps).toContainEqual({
      type: 'broken-alias',
      from: 'lib.legacy',
      to: 'lib.doesNotExist',
    });
  });
});

describe('scan — planned capability exists before code (planned-feature fixture)', () => {
  it('keeps a planned capability with stable identity and no artifact gap', () => {
    const s = loadScenario('planned-feature');
    const result = scan(s);
    const planned = findCapability(result, s.expected.plannedCapability as string);
    expect(planned).toBeDefined();
    expect(planned?.planned).toBe(true);
    expect(planned?.requirement).toBe(s.expected.plannedRequirement);
    expect(planned?.members).toHaveLength(0);
    // A planned capability must not be counted as owned nor produce a gap.
    expect(result.gaps).toHaveLength(s.expected.gapCount as number);
    expect(result.accounting.ownedTotal).toBe(s.expected.ownedTotal);
  });
});

describe('scan — justified generated file is excluded with a reason (justified-generated-file fixture)', () => {
  it('excludes a generated in-scope file with a category and reason instead of flagging it unmapped', () => {
    const s = loadScenario('justified-generated-file');
    const result = scan(s);
    const excluded = result.excluded.find((e) => e.path === s.expected.excludedInScopePath);
    expect(excluded).toBeDefined();
    expect(excluded?.category).toBe(s.expected.excludedInScopeCategory);
    expect(excluded?.reason.length).toBeGreaterThan(0);
    expect(result.unmapped).toHaveLength(0);
    expect(result.gaps).toHaveLength(s.expected.gapCount as number);
  });
});

describe('real ruleset — the two covered domains reconcile with no in-scope gaps', () => {
  // A synthetic tracked set for the two covered domains plus one out-of-scope
  // file. This proves the reviewed ruleset owns 100% of its covered scopes
  // without depending on the live tree (which drifts commit to commit).
  const files = [
    'web/src/stores/chatStore.ts',
    'web/src/stores/__tests__/chatStore.test.ts',
    'web/src/stores/editorStore.ts',
    'web/src/stores/editorStore.test.ts',
    'web/src/stores/generationStore.ts',
    'web/src/stores/scriptLibraryStore.ts',
    'web/src/stores/userStore.ts',
    'web/src/stores/marketplaceStore.ts',
    'web/src/stores/slices/index.ts',
    'web/src/stores/slices/sceneSlice.ts',
    'web/src/lib/workspace/panelRegistry.ts',
    'web/src/lib/workspace/keybindings.ts',
    'mcp-server/manifest/commands.json',
    'mcp-server/manifest/visibility-review.md',
    // out of scope + generated:
    'web/src/data/commands.json',
    // out of scope, not covered:
    'engine/src/core/lib.rs',
  ];

  function realScan(): ScanResult {
    return scan({
      files,
      rules: CAPABILITY_RULES,
      exclusions: EXCLUSION_RULES,
      planned: PLANNED_CAPABILITIES,
      aliases: [
        { from: 'stores.chat', to: 'shell-stores.chat' },
        { from: 'mcp-manifest.commands', to: 'mcp.command-manifest' },
      ],
      coveredScopes: COVERED_SCOPES,
    });
  }

  it('accounts for every tracked file with reconciling totals', () => {
    const result = realScan();
    expect(result.accounting.reconciles).toBe(true);
  });

  it('owns 100% of files inside the covered scopes (no in-scope unmapped)', () => {
    const result = realScan();
    const inScope = files.filter((f) => COVERED_SCOPES.some((s) => f.startsWith(s)));
    const owned = new Set(result.capabilities.flatMap((c) => c.members));
    for (const f of inScope) expect(owned.has(f)).toBe(true);
    expect(result.unmapped).toHaveLength(0);
  });

  it('excludes the generated manifest mirror with a reason', () => {
    const result = realScan();
    const mirror = result.excluded.find((e) => e.path === 'web/src/data/commands.json');
    expect(mirror?.category).toBe('generated');
    expect(mirror?.reason.length).toBeGreaterThan(0);
  });

  it('lists the out-of-scope engine file as notYetCovered, not a gap', () => {
    const result = realScan();
    expect(result.notYetCovered).toContain('engine/src/core/lib.rs');
    expect(result.gaps.some((g) => 'path' in g && g.path === 'engine/src/core/lib.rs')).toBe(false);
  });

  it('carries the planned capabilities with stable IDs and no artifact gap', () => {
    const result = realScan();
    const planned = result.capabilities.filter((c) => c.planned);
    expect(planned.map((c) => c.capabilityId).sort()).toEqual([
      'mcp.dependency-edges',
      'shell-stores.telemetry-denominator',
    ]);
    expect(
      result.gaps.some(
        (g) =>
          g.type === 'capability-without-artifact' &&
          planned.some((p) => p.capabilityId === g.capabilityId),
      ),
    ).toBe(false);
  });

  it('resolves the real aliases to declared capabilities', () => {
    const result = realScan();
    expect(resolveCapabilityId(result.aliases, 'stores.chat')).toBe('shell-stores.chat');
    expect(resolveCapabilityId(result.aliases, 'mcp-manifest.commands')).toBe(
      'mcp.command-manifest',
    );
    expect(result.gaps.some((g) => g.type === 'broken-alias')).toBe(false);
  });

  it('renders a deterministic report naming covered and not-yet-covered domains', () => {
    const result = realScan();
    const first = buildUnmappedReport(result, COVERAGE_SCOPE);
    const second = buildUnmappedReport(result, COVERAGE_SCOPE);
    expect(second).toBe(first);
    expect(first).toContain('## Coverage scope');
    expect(first).toContain('shell\\-stores');
    expect(first).toContain('engine\\-core');
  });
});


describe('scan — ownership and primary artifacts', () => {
  it('deduplicates overlapping ownership and explicit links while preserving OWN over EXCLUDE', () => {
    const fixture = loadScenario('shared-helper');
    const result = scan({
      ...fixture,
      rules: [...fixture.rules, {
        ...fixture.rules[1],
        own: ['app/shared/**'],
        crossLink: ['app/shared/helper.ts', 'app/featureA/index.ts'],
      }],
      exclusions: [{ category: 'generated', reason: 'Broad exclusion must not override ownership.', patterns: ['app/**'] }],
    });
    expect(findCapability(result, 'feat.a')?.members).toContain('app/shared/helper.ts');
    expect(findCapability(result, 'feat.b')?.secondaryLinks).toEqual([
      'app/featureA/index.ts', 'app/shared/helper.ts',
    ]);
    expect(findCapability(result, 'feat.a')?.secondaryLinks).toEqual([]);
    expect(result.accounting).toEqual({
      trackedTotal: 4, ownedTotal: 4, excludedTotal: 0,
      unmappedTotal: 0, notYetCoveredTotal: 0, reconciles: true,
    });
  });

  it.each([
    ['app/other.ts', 'owned', 'other'],
    ['app/free.ts', 'unmapped', null],
    ['app/generated.ts', 'excluded', null],
    ['outside/free.ts', 'notYetCovered', null],
  ] as const)('reports tracked primary %s classified as %s instead of owned', (primaryOwner, bucket, actualOwner) => {
    const result = scan({
      files: ['app/main.ts', 'app/other.ts', 'app/free.ts', 'app/generated.ts', 'outside/free.ts'],
      rules: [
        { capabilityId: 'subject', domain: 'demo', confidence: 'reviewed', own: ['app/main.ts'], primaryOwner },
        { capabilityId: 'other', domain: 'demo', confidence: 'reviewed', own: ['app/other.ts'] },
      ],
      exclusions: [{ category: 'generated', reason: 'Generated fixture.', patterns: ['app/generated.ts'] }],
      coveredScopes: ['app/'],
    });
    expect(result.gaps).toContainEqual({
      type: 'primary-owner-not-owned', capabilityId: 'subject', path: primaryOwner, bucket, actualOwner,
    });
    expect(findCapability(result, 'subject')?.members).toEqual(['app/main.ts']);
    expect(result.accounting.reconciles).toBe(true);
  });
});

describe('scan — alias graph validity', () => {
  it('follows valid multi-hop aliases to their terminal capability', () => {
    const fixture = loadScenario('renamed-file');
    const target = fixture.expected.resolveTo as string;
    const aliases = [{ from: 'old', to: 'intermediate' }, { from: 'intermediate', to: target }];
    const result = scan({ ...fixture, aliases });
    expect(result.gaps).toEqual([]);
    expect(resolveCapabilityId(aliases, 'old')).toBe(target);
    expect(resolveCapabilityId(aliases, 'unaliased')).toBe('unaliased');
  });

  it('reports the missing terminal target rather than a valid intermediate alias', () => {
    const fixture = loadScenario('renamed-file');
    const result = scan({ ...fixture, aliases: [
      { from: 'old', to: 'intermediate' }, { from: 'intermediate', to: 'missing' },
    ] });
    expect(result.gaps).toEqual([
      { type: 'broken-alias', from: 'intermediate', to: 'missing' },
      { type: 'broken-alias', from: 'old', to: 'missing' },
    ]);
  });

  it.each([
    [{ from: 'a', to: 'a' }],
    [{ from: 'prefix', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'b' }],
  ])('reports a cycle once and refuses to resolve an invalid table', (...aliases) => {
    const result = scan({ ...loadScenario('renamed-file'), aliases });
    const cycle = aliases.length === 1 ? ['a', 'a'] : ['b', 'c', 'b'];
    expect(result.gaps).toEqual([{ type: 'alias-cycle', cycle }]);
    expect(resolveCapabilityId.bind(null, aliases, aliases[0].from)).toThrow(/alias-cycle/);
    expect(() => resolveCapabilityId(aliases, 'unrelated')).toThrow(/Invalid capability alias table/);
    expect(scan({ ...loadScenario('renamed-file'), aliases: [...aliases].reverse() }).gaps).toEqual(result.gaps);
  });

  it('reports conflicting duplicate sources instead of silently choosing the last target', () => {
    const fixture = loadScenario('renamed-file');
    const aliases = [{ from: 'old', to: 'one' }, { from: 'old', to: 'two' }];
    const result = scan({ ...fixture, aliases });
    expect(result.gaps).toEqual([{ type: 'ambiguous-alias', from: 'old', targets: ['one', 'two'] }]);
    expect(() => resolveCapabilityId(aliases, 'old')).toThrow(/ambiguous-alias/);
    expect(scan({ ...fixture, aliases: [...aliases].reverse() })).toEqual(result);
  });

  it('allows repeated identical mappings because they have one unambiguous target', () => {
    const fixture = loadScenario('renamed-file');
    const target = fixture.expected.resolveTo as string;
    const aliases = [{ from: 'old', to: target }, { from: 'old', to: target }];
    expect(scan({ ...fixture, aliases }).gaps).toEqual([]);
    expect(resolveCapabilityId(aliases, 'old')).toBe(target);
  });
});

describe('scan — justified exclusions are mandatory', () => {
  it.each([undefined, null, '', ' \t\r\n', 12])('rejects an invalid exclusion reason before processing files', (reason) => {
    const exclusion = { category: 'generated', patterns: ['never-matches/**'], reason } as unknown as NonNullable<ScanConfig['exclusions']>[number];
    expect(() => scan({
      files: [], rules: [], exclusions: [exclusion], coveredScopes: [],
    })).toThrow('Exclusion rule 1 requires a non-empty string reason.');
  });
});

describe('artifact contracts', () => {
  it('serializes every inventory bucket, attribution, diagnostic and alias with the schema version', () => {
    const result = scan({
      files: ['src/main.ts', 'src/shared.ts', 'src/linked.ts', 'src/generated.ts', 'src/unmapped.ts', 'future/feature.ts'],
      rules: [
        { capabilityId: 'cap.core', domain: 'core', confidence: 'reviewed', own: ['src/main.ts', 'src/shared.ts'], primaryOwner: 'src/main.ts' },
        { capabilityId: 'cap.links', domain: 'links', confidence: 'extracted', own: ['src/linked.ts', 'src/shared.ts'], crossLink: ['src/main.ts'] },
      ],
      exclusions: [{ category: 'generated', reason: 'Generated mirror.', patterns: ['src/generated.ts'] }],
      planned: [{ capabilityId: 'cap.future', domain: 'future', requirement: 'Deliver the future feature.', confidence: 'reviewed' }],
      aliases: [{ from: 'old.core', to: 'cap.core' }],
      coveredScopes: ['src/'],
    });
    expect(buildInventoryJson(result)).toEqual({
      schemaVersion: 1,
      coveredScopes: ['src/'],
      accounting: {
        trackedTotal: 6, ownedTotal: 3, excludedTotal: 1,
        unmappedTotal: 1, notYetCoveredTotal: 1, reconciles: true,
      },
      capabilities: [
        { capabilityId: 'cap.core', domain: 'core', confidence: 'reviewed', planned: false, requirement: null,
          primaryOwner: 'src/main.ts', members: ['src/main.ts', 'src/shared.ts'], secondaryLinks: [] },
        { capabilityId: 'cap.future', domain: 'future', confidence: 'reviewed', planned: true, requirement: 'Deliver the future feature.',
          primaryOwner: null, members: [], secondaryLinks: [] },
        { capabilityId: 'cap.links', domain: 'links', confidence: 'extracted', planned: false, requirement: null,
          primaryOwner: 'src/linked.ts', members: ['src/linked.ts'], secondaryLinks: ['src/main.ts', 'src/shared.ts'] },
      ],
      exclusions: [{ path: 'src/generated.ts', category: 'generated', reason: 'Generated mirror.' }],
      unmapped: ['src/unmapped.ts'],
      notYetCovered: ['future/feature.ts'],
      gaps: [{ type: 'unmapped-in-covered-scope', path: 'src/unmapped.ts' }],
      aliases: [{ from: 'old.core', to: 'cap.core' }],
    });
  });

  it('renders every structural gap with a reference and repair in the human report', () => {
    const result = scan({
      files: ['src/owned.ts', 'src/free.ts'],
      rules: [
        { capabilityId: 'owner', domain: 'demo', confidence: 'reviewed', own: ['src/owned.ts'] },
        { capabilityId: 'foreign', domain: 'demo', confidence: 'reviewed', own: [], primaryOwner: 'src/owned.ts' },
        { capabilityId: 'removed', domain: 'demo', confidence: 'reviewed', own: [], primaryOwner: 'src/missing.ts' },
      ],
      aliases: [
        { from: 'broken', to: 'absent' },
        { from: 'cycle', to: 'cycle' },
        { from: 'ambiguous', to: 'owner' }, { from: 'ambiguous', to: 'foreign' },
      ],
      coveredScopes: ['src/'],
    });
    const report = buildUnmappedReport(result, { covered: [], notYetCovered: [] });
    const structural = report.split('## Structural gaps\n')[1].split('\n## ')[0];
    for (const label of ['Unmapped file', 'Missing primary owner', 'Primary owner not owned',
      'Capability without artifact', 'Broken alias', 'Alias cycle', 'Ambiguous alias']) {
      expect(structural).toContain(label);
    }
    expect(structural).toContain('src/missing\\.ts');
    expect(structural).toContain('belongs to owner');
    expect(structural).toContain('Terminal target absent');
    expect(structural).toContain('Conflicting targets: foreign, owner');
    expect(structural.split('\n').filter(line => line.startsWith('| '))).toHaveLength(result.gaps.length + 2);
  });
});
