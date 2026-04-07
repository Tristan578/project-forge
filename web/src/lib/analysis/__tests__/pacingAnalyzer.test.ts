import { describe, it, expect } from 'vitest';
import { extractPacingReport, type PacingStoreSnapshot } from '../pacingAnalyzer';

function makeSnapshot(overrides: Partial<PacingStoreSnapshot> = {}): PacingStoreSnapshot {
  return {
    sceneGraph: { nodes: {}, rootIds: [] },
    allGameComponents: {},
    allScripts: {},
    audioBuses: [],
    ...overrides,
  };
}

describe('pacingAnalyzer', () => {
  it('returns a valid report for empty scene', () => {
    const report = extractPacingReport(makeSnapshot());
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.curve).toBeDefined();
    expect(report.analyzedAt).toBeTruthy();
  });

  it('detects combat density from game components', () => {
    const snapshot = makeSnapshot({
      sceneGraph: {
        nodes: {
          'e1': { entityId: 'e1', name: 'Enemy1', parentId: null, children: [], components: [], visible: true },
          'e2': { entityId: 'e2', name: 'Enemy2', parentId: null, children: [], components: [], visible: true },
          'e3': { entityId: 'e3', name: 'Player', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1', 'e2', 'e3'],
      },
      allGameComponents: {
        'e1': [{ type: 'health' }, { type: 'damageZone' }],
        'e2': [{ type: 'projectile' }],
        'e3': [{ type: 'health' }],
      },
    });

    const report = extractPacingReport(snapshot);
    const combatSignals = report.curve.segments.flatMap(s =>
      s.signals.filter(sig => sig.type === 'combat_density')
    );
    expect(combatSignals.length).toBeGreaterThan(0);
    expect(combatSignals[0].value).toBeGreaterThan(0);
  });

  it('computes average intensity across segments', () => {
    const report = extractPacingReport(makeSnapshot({
      sceneGraph: {
        nodes: {
          'a': { entityId: 'a', name: 'Scene1/Box', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['a'],
      },
    }));

    expect(typeof report.curve.averageIntensity).toBe('number');
    expect(report.curve.averageIntensity).toBeGreaterThanOrEqual(0);
    expect(report.curve.averageIntensity).toBeLessThanOrEqual(1);
  });

  it('includes suggestions in the report', () => {
    const report = extractPacingReport(makeSnapshot());
    expect(Array.isArray(report.suggestions)).toBe(true);
  });

  it('handles spawner and collectible components', () => {
    const snapshot = makeSnapshot({
      sceneGraph: {
        nodes: {
          's1': { entityId: 's1', name: 'Spawner', parentId: null, children: [], components: [], visible: true },
          'c1': { entityId: 'c1', name: 'Coin', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['s1', 'c1'],
      },
      allGameComponents: {
        's1': [{ type: 'spawner' }],
        'c1': [{ type: 'collectible' }],
      },
    });

    const report = extractPacingReport(snapshot);
    const signals = report.curve.segments.flatMap(s => s.signals);
    const types = new Set(signals.map(s => s.type));
    expect(types.has('spawner_count')).toBe(true);
    expect(types.has('collectible_density')).toBe(true);
  });

  it('considers audio buses in intensity', () => {
    const withAudio = extractPacingReport(makeSnapshot({
      sceneGraph: {
        nodes: {
          'e1': { entityId: 'e1', name: 'Box', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1'],
      },
      audioBuses: [
        { name: 'master', volume: 1, muted: false },
        { name: 'music', volume: 0.8, muted: false },
        { name: 'sfx', volume: 0.5, muted: true },
      ],
    }));

    // Should detect unmuted audio buses (2 of 3 are unmuted)
    const audioSignals = withAudio.curve.segments.flatMap(s =>
      s.signals.filter(sig => sig.type === 'audio_intensity')
    );
    expect(audioSignals.length).toBeGreaterThan(0);
    // 2 unmuted buses / 8 = 0.25
    expect(audioSignals[0].value).toBe(0.25);
  });

  it('score is between 0 and 100', () => {
    // Large scene with combat
    const report = extractPacingReport(makeSnapshot({
      sceneGraph: {
        nodes: Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [
            `e${i}`,
            { entityId: `e${i}`, name: `Entity${i}`, parentId: null, children: [], components: [], visible: true },
          ])
        ),
        rootIds: Array.from({ length: 20 }, (_, i) => `e${i}`),
      },
      allGameComponents: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`e${i}`, [{ type: 'health' }]])
      ),
    }));

    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});
