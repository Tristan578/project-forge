/**
 * Blockbench model importer — converts .bbmodel JSON into mesh geometry.
 *
 * .bbmodel format (format_version >= "4.0"):
 *   meta:      { format_version, model_format, box_uv }
 *   name:      string
 *   elements:  Array of cube elements, each with from/to/rotation/origin/faces
 *   outliner:  Array of groups/entity IDs describing the hierarchy
 *   textures:  Array of texture descriptors ({ name, source (data URL) })
 *
 * Each element is an axis-aligned box in Blockbench units (1 unit = 1/16 block).
 * Each face references a texture index and UV coordinates [x1, y1, x2, y2].
 *
 * Output geometry is interleaved: one quad (two triangles, 4 vertices) per face.
 * Vertices are returned as three separate typed arrays for compatibility with
 * typical WebGL/WebGPU upload patterns.
 */

// ---------------------------------------------------------------------------
// Types — raw .bbmodel JSON shape
// ---------------------------------------------------------------------------

interface RawFace {
  uv: [number, number, number, number];
  texture: number | null;
  rotation?: 0 | 90 | 180 | 270;
}

interface RawFaces {
  north?: RawFace;
  south?: RawFace;
  east?: RawFace;
  west?: RawFace;
  up?: RawFace;
  down?: RawFace;
}

interface RawRotation {
  angle: number;
  axis: 'x' | 'y' | 'z';
  origin: [number, number, number];
}

interface RawElement {
  uuid?: string;
  name?: string;
  from: [number, number, number];
  to: [number, number, number];
  faces: RawFaces;
  rotation?: RawRotation;
  origin?: [number, number, number];
}

interface RawTexture {
  name: string;
  source?: string;
  /** Resolved UUID used by format v4 */
  uuid?: string;
  /** Legacy numeric ID */
  id?: number;
}

interface RawMeta {
  format_version?: string;
  model_format?: string;
  box_uv?: boolean;
}

interface RawBlockbenchModel {
  meta?: RawMeta;
  name?: string;
  elements?: unknown[];
  outliner?: unknown[];
  textures?: unknown[];
  resolution?: { width?: number; height?: number };
}

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface BlockbenchModel {
  /** Flat array of XYZ vertex positions — 4 vertices per face, 6 faces per element */
  vertices: Float32Array;
  /** Triangle index list — 2 triangles per face */
  indices: Uint32Array;
  /** Flat array of UV coordinates — one [u,v] pair per vertex */
  uvs: Float32Array;
  /** Normals per vertex */
  normals: Float32Array;
  /** Texture name or data-URL for each referenced texture slot */
  textureRefs: string[];
  /** Per-face texture index into textureRefs (-1 = untextured) */
  faceTextureIndices: Int32Array;
  meta: {
    name: string;
    format: string;
    formatVersion: string;
    /** Resolution of the texture atlas in pixels */
    textureWidth: number;
    textureHeight: number;
  };
}

// ---------------------------------------------------------------------------
// Face direction constants
// ---------------------------------------------------------------------------

// Each face is defined as 4 vertices (a quad) listed in counter-clockwise
// winding when viewed from outside the box.
// Coordinates are relative to the element's local origin (from corner).

type FaceDef = { normal: [number, number, number]; quad: [number, number, number][] };

// dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z
// Quad vertices listed so that two triangles (0,1,2) + (0,2,3) give correct winding.
// All "from"/"to" coords are absolute: we subtract from.x/y/z at the call site.

const FACE_DEFS: Record<keyof RawFaces, FaceDef> = {
  // North = -Z face
  north: {
    normal: [0, 0, -1],
    quad: [
      [1, 1, 0], // top-right
      [0, 1, 0], // top-left
      [0, 0, 0], // bottom-left
      [1, 0, 0], // bottom-right
    ],
  },
  // South = +Z face
  south: {
    normal: [0, 0, 1],
    quad: [
      [0, 1, 1], // top-left
      [1, 1, 1], // top-right
      [1, 0, 1], // bottom-right
      [0, 0, 1], // bottom-left
    ],
  },
  // East = +X face
  east: {
    normal: [1, 0, 0],
    quad: [
      [1, 1, 0], // top-near
      [1, 1, 1], // top-far
      [1, 0, 1], // bottom-far
      [1, 0, 0], // bottom-near
    ],
  },
  // West = -X face
  west: {
    normal: [-1, 0, 0],
    quad: [
      [0, 1, 1], // top-far
      [0, 1, 0], // top-near
      [0, 0, 0], // bottom-near
      [0, 0, 1], // bottom-far
    ],
  },
  // Up = +Y face
  up: {
    normal: [0, 1, 0],
    quad: [
      [0, 1, 0], // front-left
      [1, 1, 0], // front-right
      [1, 1, 1], // back-right
      [0, 1, 1], // back-left
    ],
  },
  // Down = -Y face
  down: {
    normal: [0, -1, 0],
    quad: [
      [0, 0, 1], // back-left
      [1, 0, 1], // back-right
      [1, 0, 0], // front-right
      [0, 0, 0], // front-left
    ],
  },
};

// ---------------------------------------------------------------------------
// UV rotation helper
// ---------------------------------------------------------------------------

/**
 * Rotate UV coordinates around the centre of the face quad by `degrees`
 * (0, 90, 180, 270).  Input/output are normalised [0..1] UV pairs.
 */
function rotateUVs(
  uvs: [number, number][],
  degrees: 0 | 90 | 180 | 270,
): [number, number][] {
  if (degrees === 0) return uvs;
  // Rotate each point around (0.5, 0.5)
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return uvs.map(([u, v]) => {
    const du = u - 0.5;
    const dv = v - 0.5;
    return [cos * du - sin * dv + 0.5, sin * du + cos * dv + 0.5];
  });
}

// ---------------------------------------------------------------------------
// Rotation helpers
// ---------------------------------------------------------------------------

function applyRotation(
  vx: number,
  vy: number,
  vz: number,
  rotation: RawRotation,
): [number, number, number] {
  const ox = rotation.origin[0];
  const oy = rotation.origin[1];
  const oz = rotation.origin[2];

  // Translate to rotation origin
  const x = vx - ox;
  const y = vy - oy;
  const z = vz - oz;

  const rad = (rotation.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let nx: number;
  let ny: number;
  let nz: number;

  switch (rotation.axis) {
    case 'x':
      nx = x;
      ny = y * cos - z * sin;
      nz = y * sin + z * cos;
      break;
    case 'y':
      nx = x * cos + z * sin;
      ny = y;
      nz = -x * sin + z * cos;
      break;
    case 'z':
      nx = x * cos - y * sin;
      ny = x * sin + y * cos;
      nz = z;
      break;
  }

  return [nx + ox, ny + oy, nz + oz];
}

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

function isRawElement(v: unknown): v is RawElement {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    Array.isArray(obj['from']) &&
    Array.isArray(obj['to']) &&
    typeof obj['faces'] === 'object' &&
    obj['faces'] !== null
  );
}

function isRawTexture(v: unknown): v is RawTexture {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj['name'] === 'string';
}

function isRawFace(v: unknown): v is RawFace {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj['uv']) && (obj['uv'] as unknown[]).length === 4;
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

/**
 * Parse a .bbmodel JSON object into renderable mesh geometry.
 *
 * @param json - Parsed JSON value (must be an object conforming to .bbmodel spec)
 * @throws {Error} if the input is not a valid .bbmodel JSON object
 */
export function parseBlockbenchModel(json: unknown): BlockbenchModel {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('Invalid .bbmodel: expected a JSON object');
  }

  const raw = json as RawBlockbenchModel;

  // Validate meta presence (any version >= 4 should work)
  const meta = raw.meta ?? {};
  const modelFormat = meta.model_format ?? 'free';
  const formatVersion = meta.format_version ?? '0.0';
  const modelName = raw.name ?? 'unnamed';

  const textureWidth = raw.resolution?.width ?? 16;
  const textureHeight = raw.resolution?.height ?? 16;

  // Build texture ref list
  const textureRefs: string[] = [];
  const rawTextures = Array.isArray(raw.textures) ? raw.textures : [];
  for (const t of rawTextures) {
    if (isRawTexture(t)) {
      textureRefs.push(t.source ?? t.name);
    }
  }

  // Validate elements array
  const rawElements = Array.isArray(raw.elements) ? raw.elements : [];

  // Pre-allocate: worst case 6 faces x 4 vertices x 3 floats per element
  const positionsList: number[] = [];
  const normalsList: number[] = [];
  const uvsList: number[] = [];
  const indicesList: number[] = [];
  const faceTextureIndicesList: number[] = [];

  let vertexOffset = 0;

  for (const rawEl of rawElements) {
    if (!isRawElement(rawEl)) continue;

    const from = rawEl.from as [number, number, number];
    const to = rawEl.to as [number, number, number];

    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];

    const facesObj = rawEl.faces as Record<string, unknown>;

    for (const [dirKey, faceDef] of Object.entries(FACE_DEFS)) {
      const rawFace = facesObj[dirKey];
      if (!isRawFace(rawFace)) continue;

      const uv = rawFace.uv;
      const texIdx = rawFace.texture ?? -1;

      // Normalise UV from pixel coords to 0..1
      const u0 = uv[0] / textureWidth;
      const v0 = uv[1] / textureHeight;
      const u1 = uv[2] / textureWidth;
      const v1 = uv[3] / textureHeight;

      // Four UV corners for the quad (top-left, top-right, bottom-right, bottom-left)
      // Mapped to quad vertices: [0]=top-right, [1]=top-left, [2]=bottom-left, [3]=bottom-right
      // for north; we use a generalised mapping matching the quad winding.
      let faceUVs: [number, number][] = [
        [u1, v0], // vertex 0
        [u0, v0], // vertex 1
        [u0, v1], // vertex 2
        [u1, v1], // vertex 3
      ];

      const faceRotation = (rawFace.rotation ?? 0) as 0 | 90 | 180 | 270;
      if (faceRotation !== 0) {
        faceUVs = rotateUVs(faceUVs, faceRotation);
      }

      const normal = faceDef.normal;
      const quad = faceDef.quad;

      // Emit 4 vertices
      for (let vi = 0; vi < 4; vi++) {
        const [qx, qy, qz] = quad[vi];
        // Scale to element dimensions
        let vx = from[0] + qx * dx;
        let vy = from[1] + qy * dy;
        let vz = from[2] + qz * dz;

        // Apply element rotation if present
        if (rawEl.rotation) {
          [vx, vy, vz] = applyRotation(vx, vy, vz, rawEl.rotation);
        }

        positionsList.push(vx, vy, vz);
        normalsList.push(normal[0], normal[1], normal[2]);
        uvsList.push(faceUVs[vi][0], faceUVs[vi][1]);
      }

      // Two triangles: (0,1,2) and (0,2,3)
      const base = vertexOffset;
      indicesList.push(base, base + 1, base + 2, base, base + 2, base + 3);
      faceTextureIndicesList.push(texIdx, texIdx, texIdx, texIdx, texIdx, texIdx);

      vertexOffset += 4;
    }
  }

  return {
    vertices: new Float32Array(positionsList),
    indices: new Uint32Array(indicesList),
    uvs: new Float32Array(uvsList),
    normals: new Float32Array(normalsList),
    textureRefs,
    faceTextureIndices: new Int32Array(faceTextureIndicesList),
    meta: {
      name: modelName,
      format: modelFormat,
      formatVersion,
      textureWidth,
      textureHeight,
    },
  };
}
