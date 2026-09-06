/**
 * A REALISTIC published-game response body, deterministic, shared by the egress
 * guard's tests and by `scripts/bench-egress-guard.ts`.
 *
 * It exists because both the blocker and the unreproducible latency claim came
 * from measuring the wrong body. The guard's "byte-for-byte" test used
 * `{ ok, items:[1,2,3], nested:{ a, b } }` — two levels, small integers, nothing
 * that a JSON round-trip or a depth bound could damage — so it passed while the
 * guard was replacing tilemap tiles with a placeholder string on every real
 * response (lessons-learned #11). And the "+0.339 ms" figure was taken on a
 * 13 KB listing, an order of magnitude smaller than the bodies that actually pay
 * the cost.
 *
 * The shape mirrors what `GET /api/play/[userId]/[slug]` returns, and the depths
 * are the ones that mattered:
 *
 *     game(1).sceneData(2).entities(3)[i](4).tilemap(5).layers(6)[0](7).tiles(8)
 *     game(1).sceneData(2).entities(3)[i](4).skeleton(5).bones(6)[0](7).localPosition(8)
 *     game(1).sceneData(2).entities(3)[i](4).clips(5)[0](6).tracks(7)[0](8).keyframes(9)
 *
 * Every one of those sits AT OR PAST the old `MAX_DEPTH = 8`, and every one is
 * load-bearing on the Rust side: `Vec<Option<u32>>` (engine/src/core/tilemap.rs),
 * `[f32; 2]` (engine/src/core/skeleton2d.rs) and `Vec<Keyframe>`. Replacing any
 * of them with a string makes the player's deserialisation fail outright.
 *
 * Deterministic on purpose — a benchmark whose input changes between runs is not
 * a benchmark, and a fixture whose bytes change breaks a byte-identity assertion
 * for reasons that have nothing to do with the guard.
 */

/** A tiny deterministic PRNG (mulberry32). No dependency, same bytes every run. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DeepSceneOptions {
  /** How many entities the scene carries. 400 is the board's measured case. */
  entities?: number;
  /** Tiles per tilemap layer. */
  tilesPerLayer?: number;
  /**
   * Text spliced into one deeply-nested script source. Used to plant a secret
   * where only a full walk can find it.
   */
  plantedDeepText?: string;
}

/**
 * Build the body. `entities: 400` produces roughly 190 KB of JSON.
 */
export function buildDeepSceneBody(options: DeepSceneOptions = {}): Record<string, unknown> {
  const entityCount = options.entities ?? 400;
  const tilesPerLayer = options.tilesPerLayer ?? 24;
  const rnd = makeRandom(0x5f_09_73_6);

  const entities = Array.from({ length: entityCount }, (_, i) => ({
    id: `entity-${i}`,
    name: `Prop ${i}`,
    transform: {
      position: [rnd() * 100, rnd() * 100, rnd() * 100],
      rotation: [0, rnd(), 0, 1],
      scale: [1, 1, 1],
    },
    material: { baseColor: [rnd(), rnd(), rnd(), 1], texture: `/assets/tex-${i % 17}.png` },
    tilemap: {
      tileset: `tileset-${i % 5}`,
      layers: [
        {
          name: 'ground',
          sortingLayer: 0,
          // DEPTH 8. `Vec<Option<u32>>` on the Rust side; the old bound turned
          // this array into the string '[REDACTED: nesting depth limit]'.
          tiles: Array.from({ length: tilesPerLayer }, () =>
            rnd() < 0.15 ? null : Math.floor(rnd() * 64)),
        },
      ],
    },
    skeleton: {
      name: `rig-${i % 3}`,
      bones: [
        {
          name: 'root',
          // DEPTH 8. `[f32; 2]`.
          localPosition: [rnd() * 10, rnd() * 10],
          localScale: [1, 1],
          color: [1, 1, 1, 1],
        },
      ],
    },
    clips: [
      {
        name: 'idle',
        duration: 1.5,
        tracks: [
          {
            property: 'position',
            // DEPTH 9. `Vec<Keyframe>`.
            keyframes: [
              { time: 0, value: [0, 0, 0], easing: 'linear' },
              { time: 1.5, value: [0, rnd(), 0], easing: 'easeInOut' },
            ],
          },
        ],
      },
    ],
    scriptData: {
      enabled: false,
      source:
        i === Math.floor(entityCount / 2) && options.plantedDeepText
          ? `// ${options.plantedDeepText}\nforge.entity.move(0, 1, 0);`
          : `forge.entity.move(${i % 3}, 0, 0);`,
    },
  }));

  return {
    game: {
      id: 'game-01JZ',
      slug: 'deep-scene',
      title: 'Deep Scene',
      description: 'A published game with a scene graph of realistic depth.',
      createdAt: '2026-09-06T00:00:00.000Z',
      plays: 1234,
      sceneData: {
        version: 3,
        projectType: '2d',
        entities,
      },
    },
  };
}
