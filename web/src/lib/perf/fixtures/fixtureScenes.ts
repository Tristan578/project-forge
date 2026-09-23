/**
 * Builders for the pinned performance fixtures (#10013, operation
 * performance.FR-3.OP-01). These are the provenance of the committed
 * `perf-*-v*.scene.json` files: `npm run perf:fixtures` (web/) rewrites them
 * from here, and `perfFixtures.test.ts` fails if the committed JSON and these
 * builders disagree.
 *
 * The output is an engine `.forge` scene file (format 3) — the exact bytes an
 * exported game hands to `handle_command('load_scene', ...)`. Field names follow
 * the Rust serde attributes: `EntitySnapshot` is camelCase, but `SpriteData` and
 * `Physics2dData` keep snake_case fields and PascalCase variants (see the note
 * on `Physics2dData` in `engine/src/core/physics_2d.rs`).
 *
 * Everything is derived from indices — no `Date`, no `Math.random` — so a
 * rebuild is byte-identical. Changing a builder changes the checksum, which the
 * registry pins: bump the fixture version (`perf-3d@2`) instead of editing
 * `@1` in place.
 */

type Vec3 = [number, number, number];

/** A scene-file entity as the engine decoder expects it. */
export type FixtureEntity = Record<string, unknown> & { entityId: string; entityType: string };

/** A complete scene file. */
export interface FixtureScene {
  formatVersion: 3;
  metadata: { name: string; createdAt: string; modifiedAt: string };
  environment: Record<string, unknown>;
  ambientLight: { color: Vec3; brightness: number };
  entities: FixtureEntity[];
}

/** Committed file name per fixture id, relative to this directory. */
export const PERF_FIXTURE_FILES: Readonly<Record<string, string>> = Object.freeze({
  'perf-2d@1': 'perf-2d-v1.scene.json',
  'perf-3d@1': 'perf-3d-v1.scene.json',
});

const IDENTITY_ROTATION = [0, 0, 0, 1];

/** Round to 3 decimals so f32 round trips and float noise cannot move bytes. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A deterministic, well-spread colour for index `i` (golden-ratio hue walk). */
function paletteColor(i: number): Vec3 {
  const h = (i * 0.618033988749895) % 1;
  const k = (n: number) => (n + h * 6) % 6;
  const channel = (n: number) => r3(0.35 + 0.55 * Math.max(0, Math.min(1, Math.abs(k(n) - 3) - 1)));
  return [channel(5), channel(3), channel(1)];
}

function baseEntity(entityId: string, entityType: string, name: string, position: Vec3, scale: Vec3): FixtureEntity {
  return {
    entityId,
    entityType,
    name,
    transform: { position: position.map(r3), rotation: [...IDENTITY_ROTATION], scale: scale.map(r3) },
    parentId: null,
    visible: true,
    physicsEnabled: false,
  };
}

function environment(clearColor: Vec3): Record<string, unknown> {
  return {
    skyboxBrightness: 1000,
    iblIntensity: 900,
    iblRotationDegrees: 0,
    clearColor,
    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.55],
    fogStart: 30,
    fogEnd: 100,
    skyboxPreset: null,
    skyboxAssetId: null,
  };
}

function physics2d(bodyType: 'Dynamic' | 'Static', shape: 'Box' | 'Circle', size: [number, number]) {
  return {
    body_type: bodyType,
    collider_shape: shape,
    size,
    radius: r3(size[0] / 2),
    vertices: [],
    mass: 1,
    friction: 0.5,
    restitution: bodyType === 'Dynamic' ? 0.2 : 0,
    gravity_scale: 1,
    is_sensor: false,
    lock_rotation: false,
    continuous_detection: false,
    one_way_platform: false,
    surface_velocity: [0, 0],
  };
}

function sprite(color: Vec3, size: [number, number], order: number) {
  return {
    texture_asset_id: null,
    color_tint: [...color, 1],
    flip_x: false,
    flip_y: false,
    custom_size: size,
    sorting_layer: 'Default',
    sorting_order: order,
    anchor: 'Center',
  };
}

/**
 * `perf-2d@1`: 256 dynamic sprites (a 16 x 16 grid of alternating boxes and
 * circles) falling under 2D physics onto one static ground sprite. Untextured,
 * so the fixture has no asset dependency.
 *
 * In pixels, because that is the unit of the engine's 2D camera at zoom 1
 * (and of an untextured sprite's 64 px default size): the whole pile fits a
 * 1280 x 720 viewport. The run must be switched to the 2D camera
 * (`set_project_type`), which the export template does for a 2D project.
 */
function buildPerf2d(): FixtureScene {
  const entities: FixtureEntity[] = [];
  const groundSize: [number, number] = [960, 24];
  entities.push({
    ...baseEntity('perf2d-ground', 'sprite', 'Ground', [0, -300, 0], [1, 1, 1]),
    spriteData: sprite([0.3, 0.3, 0.35], groundSize, 0),
    physics2dData: physics2d('Static', 'Box', groundSize),
    physics2dEnabled: true,
  });
  const cols = 16;
  const rows = 16;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const shape = i % 2 === 0 ? 'Box' : 'Circle';
      const size: [number, number] = [20, 20];
      // Odd rows are offset half a cell so the pile does not stack in columns.
      const x = -300 + col * 40 + (row % 2) * 20;
      const y = -150 + row * 28;
      entities.push({
        ...baseEntity(`perf2d-body-${String(i).padStart(3, '0')}`, 'sprite', `Body ${i}`, [x, y, 0], [1, 1, 1]),
        spriteData: sprite(paletteColor(i), size, 1),
        physics2dData: physics2d('Dynamic', shape, size),
        physics2dEnabled: true,
      });
    }
  }
  return {
    formatVersion: 3,
    metadata: { name: 'Perf fixture 2D v1', createdAt: '', modifiedAt: '' },
    environment: environment([0.08, 0.08, 0.1]),
    ambientLight: { color: [1, 1, 1], brightness: 300 },
    entities,
  };
}

function pbrMaterial(color: Vec3, metallic: number, roughness: number) {
  return {
    baseColor: [...color, 1],
    metallic: r3(metallic),
    perceptualRoughness: r3(roughness),
    reflectance: 0.5,
    emissive: [0, 0, 0, 1],
    emissiveExposureWeight: 1,
    alphaMode: 'opaque',
    alphaCutoff: 0.5,
    doubleSided: false,
    unlit: false,
  };
}

function physics3d(bodyType: 'dynamic' | 'fixed', shape: 'cuboid' | 'ball' | 'cylinder') {
  return {
    bodyType,
    colliderShape: shape,
    restitution: 0.2,
    friction: 0.6,
    density: 1,
    gravityScale: 1,
    lockTranslationX: false,
    lockTranslationY: false,
    lockTranslationZ: false,
    lockRotationX: false,
    lockRotationY: false,
    lockRotationZ: false,
    isSensor: false,
  };
}

function light(kind: 'directional' | 'point', color: Vec3, intensity: number, shadows: boolean) {
  return {
    lightType: kind,
    color,
    intensity,
    shadowsEnabled: shadows,
    shadowDepthBias: kind === 'directional' ? 0.02 : 0.08,
    shadowNormalBias: kind === 'directional' ? 1.8 : 0.6,
    range: 20,
    radius: 0,
    innerAngle: 0,
    outerAngle: 0.785,
  };
}

/**
 * `perf-3d@1`: 216 dynamic PBR meshes (a 6 x 6 x 6 lattice cycling cube, sphere
 * and cylinder, with varied metallic/roughness) dropping under 3D physics onto
 * a fixed ground, lit by one shadow-casting directional light and four point
 * lights. Sized to sit inside the default runtime camera's view of the origin.
 */
function buildPerf3d(): FixtureScene {
  const entities: FixtureEntity[] = [];
  entities.push({
    // A thin cube rather than a plane: a plane has no thickness for the
    // cuboid collider to take its height from.
    ...baseEntity('perf3d-ground', 'cube', 'Ground', [0, -1.75, 0], [12, 0.5, 12]),
    materialData: pbrMaterial([0.35, 0.36, 0.4], 0, 0.9),
    physicsData: physics3d('fixed', 'cuboid'),
    physicsEnabled: true,
  });
  entities.push({
    ...baseEntity('perf3d-sun', 'directional_light', 'Sun', [0, 8, 0], [1, 1, 1]),
    transform: { position: [0, 8, 0], rotation: [-0.259, 0.259, 0.07, 0.928], scale: [1, 1, 1] },
    lightData: light('directional', [1, 0.97, 0.92], 10000, true),
  });
  const pointPositions: Vec3[] = [
    [-3, 2, -3],
    [3, 2, -3],
    [-3, 2, 3],
    [3, 2, 3],
  ];
  pointPositions.forEach((position, i) => {
    entities.push({
      ...baseEntity(`perf3d-point-${i}`, 'point_light', `Point ${i}`, position, [1, 1, 1]),
      lightData: light('point', paletteColor(i + 100), 60000, false),
    });
  });
  const kinds = [
    ['cube', 'cuboid'],
    ['sphere', 'ball'],
    ['cylinder', 'cylinder'],
  ] as const;
  const n = 6;
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + z) * n + x;
        const [entityType, collider] = kinds[i % kinds.length];
        const position: Vec3 = [-2 + x * 0.8, 0 + y * 0.8, -2 + z * 0.8];
        entities.push({
          ...baseEntity(`perf3d-body-${String(i).padStart(3, '0')}`, entityType, `Body ${i}`, position, [0.45, 0.45, 0.45]),
          materialData: pbrMaterial(paletteColor(i), (i % 5) / 4, 0.2 + ((i * 7) % 10) / 12),
          physicsData: physics3d('dynamic', collider),
          physicsEnabled: true,
        });
      }
    }
  }
  return {
    formatVersion: 3,
    metadata: { name: 'Perf fixture 3D v1', createdAt: '', modifiedAt: '' },
    environment: environment([0.1, 0.1, 0.12]),
    ambientLight: { color: [1, 1, 1], brightness: 300 },
    entities,
  };
}

const BUILDERS: Readonly<Record<string, () => FixtureScene>> = Object.freeze({
  'perf-2d@1': buildPerf2d,
  'perf-3d@1': buildPerf3d,
});

/**
 * Build a fixture scene by id.
 * @param id A registered fixture id (`perf-2d@1`, `perf-3d@1`).
 * @returns A fresh scene object.
 * @throws When the id has no builder.
 */
export function buildPerfFixtureScene(id: string): FixtureScene {
  if (!Object.prototype.hasOwnProperty.call(BUILDERS, id)) throw new Error(`No perf fixture builder for ${id}`);
  return BUILDERS[id]();
}

/**
 * The committed text of a fixture: two-space JSON with one entity per line, so
 * a diff shows which entity changed without a 5,000-line file. LF endings and a
 * trailing newline.
 * @param scene A fixture scene.
 * @returns File contents.
 */
export function serializeFixtureScene(scene: FixtureScene): string {
  const { entities, ...rest } = scene;
  const head = JSON.stringify(rest, null, 2);
  const body = entities.map((e) => `    ${JSON.stringify(e)}`).join(',\n');
  return `${head.slice(0, -2)},\n  "entities": [\n${body}\n  ]\n}\n`;
}
