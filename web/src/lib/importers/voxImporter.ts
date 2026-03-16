/**
 * MagicaVoxel .vox file importer
 *
 * Format reference:
 * https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 *
 * Structure:
 *   'VOX ' magic (4 bytes) + version (int32) + MAIN chunk
 *   MAIN chunk contains: SIZE, XYZI, RGBA child chunks
 */

export interface VoxSize {
  x: number;
  y: number;
  z: number;
}

export interface VoxVoxel {
  x: number;
  y: number;
  z: number;
  colorIndex: number; // 1-based index into palette (0 = empty)
}

export interface VoxColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface VoxModel {
  size: VoxSize;
  voxels: VoxVoxel[];
  palette: VoxColor[]; // 256 entries (index 0 unused, 1-255 are valid)
}

export interface VoxMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
}

// Default MagicaVoxel palette (256 RGBA entries as per the spec)
const DEFAULT_PALETTE: VoxColor[] = (() => {
  const raw = [
    0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff,
    0xff00ffff, 0xffffccff, 0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff,
    0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff, 0xff6699ff, 0xff3399ff,
    0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff,
    0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff,
    0xff0033ff, 0xffff00ff, 0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff,
    0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc, 0xff66ffcc, 0xff33ffcc,
    0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
    0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc,
    0xff0099cc, 0xffff66cc, 0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc,
    0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc, 0xff6633cc, 0xff3333cc,
    0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc,
    0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99,
    0xff00ff99, 0xffffcc99, 0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99,
    0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999, 0xff669999, 0xff339999,
    0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
    0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399,
    0xff003399, 0xffff0099, 0xffcc0099, 0xff990099, 0xff660099, 0xff330099,
    0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66, 0xff66ff66, 0xff33ff66,
    0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66,
    0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966,
    0xff009966, 0xffff6666, 0xffcc6666, 0xff996666, 0xff666666, 0xff336666,
    0xff006666, 0xffff3366, 0xffcc3366, 0xff993366, 0xff663366, 0xff333366,
    0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
    0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33,
    0xff00ff33, 0xffffcc33, 0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33,
    0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933, 0xff669933, 0xff339933,
    0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633,
    0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333,
    0xff003333, 0xffff0033, 0xffcc0033, 0xff990033, 0xff660033, 0xff330033,
    0xff000033, 0xffffff00, 0xffccff00, 0xff99ff00, 0xff66ff00, 0xff33ff00,
    0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00,
    0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900,
    0xff009900, 0xffff6600, 0xffcc6600, 0xff996600, 0xff666600, 0xff336600,
    0xff006600, 0xffff3300, 0xffcc3300, 0xff993300, 0xff663300, 0xff333300,
    0xff003300, 0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000,
    0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077,
    0xff000055, 0xff000044, 0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00,
    0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700, 0xff005500, 0xff004400,
    0xff002200, 0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000,
    0xff880000, 0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000,
    0xffeeeeee, 0xffdddddd, 0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777,
    0xff555555, 0xff444444, 0xff222222, 0xff111111, 0xff000000,
  ];
  return raw.map((v) => ({
    r: (v >>> 24) & 0xff,
    g: (v >>> 16) & 0xff,
    b: (v >>> 8) & 0xff,
    a: v & 0xff,
  }));
})();

const VOX_MAGIC = 0x20584f56; // 'VOX ' in little-endian

/**
 * Parse a MagicaVoxel .vox file from an ArrayBuffer.
 * Throws if the magic bytes do not match.
 */
export function parseVoxFile(buffer: ArrayBuffer): VoxModel {
  const view = new DataView(buffer);
  let offset = 0;

  function readInt32(): number {
    const v = view.getInt32(offset, true);
    offset += 4;
    return v;
  }

  function readUint32(): number {
    const v = view.getUint32(offset, true);
    offset += 4;
    return v;
  }

  function readBytes(n: number): Uint8Array {
    const bytes = new Uint8Array(buffer, offset, n);
    offset += n;
    return bytes;
  }

  function readChunkId(): string {
    const bytes = readBytes(4);
    return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  }

  // --- Magic + version ---
  const magic = readUint32();
  if (magic !== VOX_MAGIC) {
    throw new Error(
      `Invalid .vox file: expected magic 0x${VOX_MAGIC.toString(16)}, got 0x${magic.toString(16)}`
    );
  }
  const _version = readInt32(); // version (e.g. 150), not used further

  // --- MAIN chunk ---
  const mainId = readChunkId();
  if (mainId !== "MAIN") {
    throw new Error(`Expected MAIN chunk, got '${mainId}'`);
  }
  const _mainContentBytes = readInt32(); // bytes of chunk content (MAIN has none)
  const mainChildrenBytes = readInt32(); // bytes of children
  const mainChildrenEnd = offset + mainChildrenBytes;

  let size: VoxSize = { x: 0, y: 0, z: 0 };
  const voxels: VoxVoxel[] = [];
  let palette: VoxColor[] = [...DEFAULT_PALETTE];

  while (offset < mainChildrenEnd) {
    const chunkId = readChunkId();
    const contentBytes = readInt32();
    const _childrenBytes = readInt32();
    const contentEnd = offset + contentBytes;

    switch (chunkId) {
      case "SIZE": {
        size = {
          x: readInt32(),
          y: readInt32(),
          z: readInt32(),
        };
        break;
      }
      case "XYZI": {
        const numVoxels = readInt32();
        for (let i = 0; i < numVoxels; i++) {
          const x = view.getUint8(offset++);
          const y = view.getUint8(offset++);
          const z = view.getUint8(offset++);
          const colorIndex = view.getUint8(offset++);
          voxels.push({ x, y, z, colorIndex });
        }
        break;
      }
      case "RGBA": {
        // 256 RGBA entries — index 0 is unused, indices 1-255 are valid
        palette = [];
        for (let i = 0; i < 256; i++) {
          palette.push({
            r: view.getUint8(offset++),
            g: view.getUint8(offset++),
            b: view.getUint8(offset++),
            a: view.getUint8(offset++),
          });
        }
        break;
      }
      default: {
        // Skip unknown chunks
        break;
      }
    }

    // Always advance to end of content (handles partial reads of known chunks
    // and skips unknown ones)
    offset = contentEnd;
  }

  return { size, voxels, palette };
}

// --- Mesh generation ---

// Face directions: +X, -X, +Y, -Y, +Z, -Z
// Each face has 4 vertices as offsets from the voxel origin (0,0,0 to 1,1,1)
const FACE_VERTICES: [number, number, number][][] = [
  // +X face
  [
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
    [1, 0, 1],
  ],
  // -X face
  [
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
  ],
  // +Y face
  [
    [0, 1, 0],
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
  ],
  // -Y face
  [
    [0, 0, 1],
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
  ],
  // +Z face
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  // -Z face
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
];

// Neighbour offsets corresponding to the 6 face directions
const FACE_NEIGHBOURS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Convert a VoxModel into a triangle mesh with per-vertex colors.
 * Uses face culling: faces shared with an occupied neighbour voxel are skipped.
 *
 * Returns:
 *   vertices — flat array of (x, y, z) triplets, 3 floats per vertex
 *   indices  — triangle indices (two triangles per quad face)
 *   colors   — flat array of (r, g, b, a) normalized [0,1] values, 4 floats per vertex
 */
export function voxToMesh(model: VoxModel): VoxMesh {
  const { voxels, palette } = model;

  if (voxels.length === 0) {
    return {
      vertices: new Float32Array(0),
      indices: new Uint32Array(0),
      colors: new Float32Array(0),
    };
  }

  // Build occupation set for O(1) neighbour lookup
  const occupied = new Set<string>();
  for (const v of voxels) {
    occupied.add(`${v.x},${v.y},${v.z}`);
  }

  const vertexData: number[] = [];
  const colorData: number[] = [];
  const indexData: number[] = [];

  for (const vox of voxels) {
    // colorIndex is 1-based; palette[0] is unused
    const ci = vox.colorIndex;
    const col = ci > 0 && ci < palette.length ? palette[ci] : palette[1];
    const r = col.r / 255;
    const g = col.g / 255;
    const b = col.b / 255;
    const a = col.a / 255;

    for (let fi = 0; fi < 6; fi++) {
      const [nx, ny, nz] = FACE_NEIGHBOURS[fi];
      const neighbourKey = `${vox.x + nx},${vox.y + ny},${vox.z + nz}`;
      if (occupied.has(neighbourKey)) {
        // Face is internal — skip it
        continue;
      }

      // Emit 4 vertices for this face quad
      const baseIndex = vertexData.length / 3;
      for (const [dx, dy, dz] of FACE_VERTICES[fi]) {
        vertexData.push(vox.x + dx, vox.y + dy, vox.z + dz);
        colorData.push(r, g, b, a);
      }

      // Two triangles (winding: 0,1,2 and 0,2,3)
      indexData.push(
        baseIndex,
        baseIndex + 1,
        baseIndex + 2,
        baseIndex,
        baseIndex + 2,
        baseIndex + 3
      );
    }
  }

  return {
    vertices: new Float32Array(vertexData),
    indices: new Uint32Array(indexData),
    colors: new Float32Array(colorData),
  };
}
