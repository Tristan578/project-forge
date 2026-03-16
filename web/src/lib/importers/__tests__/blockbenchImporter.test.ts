import { describe, it, expect } from 'vitest';
import { parseBlockbenchModel } from '../blockbenchImporter';
import type { BlockbenchModel } from '../blockbenchImporter';

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function cube(
  from: [number, number, number],
  to: [number, number, number],
  textureIdx = 0,
  rotation?: { angle: number; axis: 'x' | 'y' | 'z'; origin: [number, number, number] },
) {
  const face = (uv: [number, number, number, number] = [0, 0, 16, 16]) => ({
    uv,
    texture: textureIdx,
  });
  return {
    name: 'cube',
    from,
    to,
    faces: {
      north: face(),
      south: face(),
      east: face(),
      west: face(),
      up: face(),
      down: face(),
    },
    ...(rotation ? { rotation } : {}),
  };
}

function minimalModel(elements: unknown[], textures?: unknown[]) {
  return {
    meta: { format_version: '4.10', model_format: 'free' },
    name: 'TestModel',
    resolution: { width: 16, height: 16 },
    elements,
    outliner: [],
    textures: textures ?? [{ name: 'tex0.png', source: 'data:image/png;base64,abc' }],
  };
}

// ---------------------------------------------------------------------------
// Single cube element
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - single cube', () => {
  it('produces 4 vertices per face (6 faces = 24 vertices)', () => {
    const model: BlockbenchModel = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    // 6 faces x 4 vertices = 24 positions x 3 floats = 72
    expect(model.vertices.length).toBe(72);
  });

  it('produces 2 triangles per face (6 faces = 12 triangles = 36 indices)', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    expect(model.indices.length).toBe(36);
  });

  it('produces 2 UV values per vertex (24 vertices = 48 floats)', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    expect(model.uvs.length).toBe(48);
  });

  it('sets correct meta fields', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    expect(model.meta.name).toBe('TestModel');
    expect(model.meta.format).toBe('free');
    expect(model.meta.formatVersion).toBe('4.10');
    expect(model.meta.textureWidth).toBe(16);
    expect(model.meta.textureHeight).toBe(16);
  });

  it('populates textureRefs from textures array', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    expect(model.textureRefs).toHaveLength(1);
    expect(model.textureRefs[0]).toBe('data:image/png;base64,abc');
  });

  it('falls back to texture name when source is absent', () => {
    const noSource = minimalModel(
      [cube([0, 0, 0], [1, 1, 1])],
      [{ name: 'fallback.png' }],
    );
    const model = parseBlockbenchModel(noSource);
    expect(model.textureRefs[0]).toBe('fallback.png');
  });

  it('returns Float32Array for vertices and uvs', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    expect(model.vertices).toBeInstanceOf(Float32Array);
    expect(model.uvs).toBeInstanceOf(Float32Array);
    expect(model.normals).toBeInstanceOf(Float32Array);
  });

  it('returns Uint32Array for indices and Int32Array for faceTextureIndices', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    expect(model.indices).toBeInstanceOf(Uint32Array);
    expect(model.faceTextureIndices).toBeInstanceOf(Int32Array);
  });

  it('all index values are within vertex count bounds', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    const vertexCount = model.vertices.length / 3;
    for (const idx of model.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(vertexCount);
    }
  });

  it('vertex positions match element from/to', () => {
    const model = parseBlockbenchModel(minimalModel([cube([2, 4, 6], [5, 8, 10])]));
    const verts = model.vertices;
    // All X values should be between 2 and 5
    for (let i = 0; i < verts.length; i += 3) {
      expect(verts[i]).toBeGreaterThanOrEqual(2);
      expect(verts[i]).toBeLessThanOrEqual(5);
      expect(verts[i + 1]).toBeGreaterThanOrEqual(4);
      expect(verts[i + 1]).toBeLessThanOrEqual(8);
      expect(verts[i + 2]).toBeGreaterThanOrEqual(6);
      expect(verts[i + 2]).toBeLessThanOrEqual(10);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-element model
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - multi-element model', () => {
  it('accumulates geometry from all elements', () => {
    const model = parseBlockbenchModel(
      minimalModel([cube([0, 0, 0], [1, 1, 1]), cube([2, 0, 0], [3, 1, 1])]),
    );
    // 2 cubes x 6 faces x 4 vertices x 3 floats
    expect(model.vertices.length).toBe(144);
    expect(model.indices.length).toBe(72);
  });

  it('indices for second element are offset correctly', () => {
    const model = parseBlockbenchModel(
      minimalModel([cube([0, 0, 0], [1, 1, 1]), cube([2, 0, 0], [3, 1, 1])]),
    );
    // First element: indices 0..23, second element starts at 24
    const secondStart = model.indices[36]; // first index of second element's first face
    expect(secondStart).toBe(24);
  });

  it('handles three cubes', () => {
    const model = parseBlockbenchModel(
      minimalModel([
        cube([0, 0, 0], [1, 1, 1]),
        cube([1, 0, 0], [2, 1, 1]),
        cube([2, 0, 0], [3, 1, 1]),
      ]),
    );
    expect(model.vertices.length).toBe(216); // 3 x 72
    expect(model.indices.length).toBe(108); // 3 x 36
  });

  it('skips non-element entries gracefully', () => {
    const modelJson = minimalModel([
      cube([0, 0, 0], [1, 1, 1]),
      'not_an_element',
      null,
      42,
      { name: 'group_node' }, // outliner group - no from/to/faces
    ]);
    // Should only produce geometry for the one valid cube
    const model = parseBlockbenchModel(modelJson);
    expect(model.vertices.length).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// Face UV extraction
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - face UV extraction', () => {
  it('normalises UV coordinates to 0..1 range', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    for (const uv of model.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }
  });

  it('maps pixel UV to correct normalised values (16x16 atlas)', () => {
    // north face UV [0, 0, 8, 8] on a 16x16 atlas -> 0..0.5 range
    const modelJson = {
      ...minimalModel([
        {
          name: 'cube',
          from: [0, 0, 0],
          to: [1, 1, 1],
          faces: {
            north: { uv: [0, 0, 8, 8], texture: 0 },
            south: { uv: [0, 0, 16, 16], texture: 0 },
            east: { uv: [0, 0, 16, 16], texture: 0 },
            west: { uv: [0, 0, 16, 16], texture: 0 },
            up: { uv: [0, 0, 16, 16], texture: 0 },
            down: { uv: [0, 0, 16, 16], texture: 0 },
          },
        },
      ]),
    };
    const model = parseBlockbenchModel(modelJson);
    // First face (north): 4 vertices x 2 UV floats = 8 values
    const northUVs = Array.from(model.uvs.slice(0, 8));
    // Values should be in [0, 0.5] range only for north face
    for (const uv of northUVs) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(0.5);
    }
  });

  it('sets faceTextureIndices to the referenced texture index', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1], 0)]));
    // 6 faces x 6 indices each = 36 faceTextureIndices entries
    expect(model.faceTextureIndices.length).toBe(36);
    for (const idx of model.faceTextureIndices) {
      expect(idx).toBe(0);
    }
  });

  it('sets faceTextureIndices to -1 when texture is null', () => {
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: null },
          south: { uv: [0, 0, 16, 16], texture: null },
          east: { uv: [0, 0, 16, 16], texture: null },
          west: { uv: [0, 0, 16, 16], texture: null },
          up: { uv: [0, 0, 16, 16], texture: null },
          down: { uv: [0, 0, 16, 16], texture: null },
        },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);
    for (const idx of model.faceTextureIndices) {
      expect(idx).toBe(-1);
    }
  });

  it('handles face UV rotation of 90 degrees', () => {
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: 0, rotation: 90 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ]);
    const base = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    const rotated = parseBlockbenchModel(modelJson);
    // Rotated UVs for north face should differ from non-rotated
    const baseNorthUVs = Array.from(base.uvs.slice(0, 8));
    const rotatedNorthUVs = Array.from(rotated.uvs.slice(0, 8));
    expect(rotatedNorthUVs).not.toEqual(baseNorthUVs);
  });

  it('handles face UV rotation of 180 degrees', () => {
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [0, 0, 8, 8], texture: 0, rotation: 180 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);
    expect(model.uvs.length).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// UV rotation center regression (PF-440)
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - UV rotation uses face center not (0.5,0.5)', () => {
  it('rotation of offset UV face stays within the face UV bounds', () => {
    // UV rect [8, 0, 16, 8] on 16x16 -> normalised [0.5, 0, 1.0, 0.5]
    // Face center: (0.75, 0.25)
    //
    // BUG: rotating around (0.5, 0.5) would move UVs outside the face bounds,
    // producing incorrect texture sampling.
    //
    // CORRECT: rotating around (0.75, 0.25) keeps all UVs within the face region.
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [8, 0, 16, 8], texture: 0, rotation: 90 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);

    // North face UVs: first 4 vertices x 2 components = indices 0..7
    const northUVs: [number, number][] = [];
    for (let i = 0; i < 8; i += 2) {
      northUVs.push([model.uvs[i], model.uvs[i + 1]]);
    }

    // All U values should stay in [0.5, 1.0] range (the face's U range)
    // All V values should stay in [0.0, 0.5] range (the face's V range)
    // If rotation was done around (0.5, 0.5), some V values would go negative
    for (const [u, v] of northUVs) {
      expect(u).toBeGreaterThanOrEqual(0.5 - 0.01);
      expect(u).toBeLessThanOrEqual(1.0 + 0.01);
      expect(v).toBeGreaterThanOrEqual(0.0 - 0.01);
      expect(v).toBeLessThanOrEqual(0.5 + 0.01);
    }
  });

  it('full-texture UV (0,0,16,16) rotation works identically regardless of center', () => {
    // For a face covering the entire texture [0,0,16,16], center is (0.5,0.5)
    // so the old and new code produce the same result. This is a sanity check.
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: 0, rotation: 90 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);

    // All UV values should remain in [0, 1]
    for (const uv of model.uvs) {
      expect(uv).toBeGreaterThanOrEqual(-0.01);
      expect(uv).toBeLessThanOrEqual(1.01);
    }
  });

  it('270-degree rotation of offset UV stays within face bounds', () => {
    // UV rect [0, 8, 8, 16] on 16x16 -> normalised [0, 0.5, 0.5, 1.0]
    // Face center: (0.25, 0.75)
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [0, 8, 8, 16], texture: 0, rotation: 270 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);

    const northUVs: [number, number][] = [];
    for (let i = 0; i < 8; i += 2) {
      northUVs.push([model.uvs[i], model.uvs[i + 1]]);
    }

    // U should be in [0, 0.5], V should be in [0.5, 1.0]
    for (const [u, v] of northUVs) {
      expect(u).toBeGreaterThanOrEqual(0.0 - 0.01);
      expect(u).toBeLessThanOrEqual(0.5 + 0.01);
      expect(v).toBeGreaterThanOrEqual(0.5 - 0.01);
      expect(v).toBeLessThanOrEqual(1.0 + 0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Rotation and origin handling
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - rotation and origin handling', () => {
  it('applies element rotation to vertex positions', () => {
    const rotatedJson = minimalModel([
      {
        ...cube([0, 0, 0], [1, 1, 1]),
        rotation: { angle: 45, axis: 'y', origin: [0.5, 0.5, 0.5] },
      },
    ]);
    const unrotatedModel = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    const rotatedModel = parseBlockbenchModel(rotatedJson);

    // Vertex positions should differ after rotation
    let differs = false;
    for (let i = 0; i < rotatedModel.vertices.length; i++) {
      if (Math.abs(rotatedModel.vertices[i] - unrotatedModel.vertices[i]) > 0.001) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('rotates around the specified origin', () => {
    // 180 degree Y rotation around origin (0.5, 0.5, 0.5) maps (0,y,0) to (1,y,1)
    const modelJson = minimalModel([
      {
        ...cube([0, 0, 0], [1, 1, 1]),
        rotation: { angle: 180, axis: 'y', origin: [0.5, 0.5, 0.5] },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);
    // After 180 degree Y rotation, all X and Z values should remain within 0..1
    const verts = model.vertices;
    for (let i = 0; i < verts.length; i += 3) {
      expect(verts[i]).toBeGreaterThanOrEqual(-0.01);
      expect(verts[i]).toBeLessThanOrEqual(1.01);
      expect(verts[i + 2]).toBeGreaterThanOrEqual(-0.01);
      expect(verts[i + 2]).toBeLessThanOrEqual(1.01);
    }
  });

  it('handles X-axis rotation', () => {
    const modelJson = minimalModel([
      {
        ...cube([0, 0, 0], [1, 1, 1]),
        rotation: { angle: 22.5, axis: 'x', origin: [0.5, 0.5, 0.5] },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);
    expect(model.vertices.length).toBe(72);
  });

  it('handles Z-axis rotation', () => {
    const modelJson = minimalModel([
      {
        ...cube([0, 0, 0], [1, 1, 1]),
        rotation: { angle: -22.5, axis: 'z', origin: [0, 0, 0] },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);
    expect(model.vertices.length).toBe(72);
  });

  it('preserves vertex count after rotation', () => {
    const rotatedJson = minimalModel([
      {
        ...cube([0, 0, 0], [2, 3, 4]),
        rotation: { angle: 30, axis: 'y', origin: [1, 1.5, 2] },
      },
    ]);
    const model = parseBlockbenchModel(rotatedJson);
    expect(model.vertices.length).toBe(72);
    expect(model.indices.length).toBe(36);
  });
});

// ---------------------------------------------------------------------------
// Invalid / edge-case input
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - invalid input', () => {
  it('throws on null input', () => {
    expect(() => parseBlockbenchModel(null)).toThrow();
  });

  it('throws on array input', () => {
    expect(() => parseBlockbenchModel([])).toThrow();
  });

  it('throws on string input', () => {
    expect(() => parseBlockbenchModel('not a model')).toThrow();
  });

  it('throws on numeric input', () => {
    expect(() => parseBlockbenchModel(42)).toThrow();
  });

  it('returns empty geometry for model with no elements', () => {
    const model = parseBlockbenchModel(minimalModel([]));
    expect(model.vertices.length).toBe(0);
    expect(model.indices.length).toBe(0);
  });

  it('returns empty geometry for model with empty elements array', () => {
    const model = parseBlockbenchModel({ meta: {}, elements: [], textures: [] });
    expect(model.vertices.length).toBe(0);
  });

  it('handles missing meta gracefully', () => {
    const model = parseBlockbenchModel({
      elements: [cube([0, 0, 0], [1, 1, 1])],
      textures: [],
    });
    expect(model.meta.format).toBe('free');
    expect(model.meta.formatVersion).toBe('0.0');
    expect(model.meta.name).toBe('unnamed');
  });

  it('handles missing textures array gracefully', () => {
    const model = parseBlockbenchModel({
      meta: { format_version: '4.0', model_format: 'free' },
      elements: [cube([0, 0, 0], [1, 1, 1])],
    });
    expect(model.textureRefs).toHaveLength(0);
  });

  it('handles elements with missing faces gracefully', () => {
    const badElement = { name: 'bad', from: [0, 0, 0], to: [1, 1, 1] };
    // Should skip this element (no faces property)
    const model = parseBlockbenchModel(minimalModel([badElement]));
    expect(model.vertices.length).toBe(0);
  });

  it('skips faces with malformed UV', () => {
    const modelJson = minimalModel([
      {
        name: 'cube',
        from: [0, 0, 0],
        to: [1, 1, 1],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: 0 },
          south: { uv: 'bad', texture: 0 }, // malformed
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { texture: 0 }, // missing uv
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 },
        },
      },
    ]);
    const model = parseBlockbenchModel(modelJson);
    // Should have 4 valid faces x 4 vertices x 3 = 48
    expect(model.vertices.length).toBe(48);
  });

  it('handles models with multiple textures', () => {
    const modelJson = {
      ...minimalModel([
        {
          name: 'cube',
          from: [0, 0, 0],
          to: [1, 1, 1],
          faces: {
            north: { uv: [0, 0, 16, 16], texture: 1 },
            south: { uv: [0, 0, 16, 16], texture: 0 },
            east: { uv: [0, 0, 16, 16], texture: 0 },
            west: { uv: [0, 0, 16, 16], texture: 0 },
            up: { uv: [0, 0, 16, 16], texture: 0 },
            down: { uv: [0, 0, 16, 16], texture: 0 },
          },
        },
      ]),
      textures: [
        { name: 'tex0.png', source: 'data:image/png;base64,aaa' },
        { name: 'tex1.png', source: 'data:image/png;base64,bbb' },
      ],
    };
    const model = parseBlockbenchModel(modelJson);
    expect(model.textureRefs).toHaveLength(2);
    // north face references texture 1
    const northFaceTexIdx = model.faceTextureIndices[0];
    expect(northFaceTexIdx).toBe(1);
  });

  it('handles element with zero-size dimension', () => {
    // A 2D plane (dz = 0) should produce only geometry for faces with extent
    const model = parseBlockbenchModel(
      minimalModel([cube([0, 0, 0], [1, 1, 0])]),
    );
    // Even degenerate elements still emit vertices (clamped faces may be coplanar but valid)
    expect(model.indices.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Normals
// ---------------------------------------------------------------------------

describe('parseBlockbenchModel - normals', () => {
  it('produces one normal per vertex', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    // 24 vertices x 3 normal components
    expect(model.normals.length).toBe(72);
  });

  it('north face normals point in -Z direction', () => {
    const model = parseBlockbenchModel(minimalModel([cube([0, 0, 0], [1, 1, 1])]));
    // North face is the first face (index 0..3 in normals)
    // Each vertex: nx, ny, nz
    for (let i = 0; i < 12; i += 3) {
      expect(model.normals[i]).toBeCloseTo(0);     // nx
      expect(model.normals[i + 1]).toBeCloseTo(0); // ny
      expect(model.normals[i + 2]).toBeCloseTo(-1); // nz
    }
  });
});
