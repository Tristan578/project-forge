import { describe, it, expect } from "vitest";
import { parseVoxFile, voxToMesh, VoxModel } from "../voxImporter";

/**
 * Builds a minimal valid .vox file as an ArrayBuffer.
 *
 * Layout:
 *   4 bytes  magic 'VOX '
 *   4 bytes  version (150)
 *   MAIN chunk
 *     4 bytes  'MAIN'
 *     4 bytes  content bytes = 0
 *     4 bytes  children bytes = SIZE_chunk_size + XYZI_chunk_size
 *     SIZE chunk
 *       4 bytes  'SIZE'
 *       4 bytes  content = 12
 *       4 bytes  children = 0
 *       12 bytes x, y, z (int32 LE each)
 *     XYZI chunk
 *       4 bytes  'XYZI'
 *       4 bytes  content = 4 + numVoxels * 4
 *       4 bytes  children = 0
 *       4 bytes  numVoxels
 *       numVoxels * 4 bytes  x, y, z, colorIndex (uint8 each)
 */
function buildVoxBuffer(
  sx: number,
  sy: number,
  sz: number,
  voxels: { x: number; y: number; z: number; colorIndex: number }[]
): ArrayBuffer {
  const sizeChunkContent = 12; // 3 x int32
  const xyziChunkContent = 4 + voxels.length * 4; // numVoxels + data

  const chunkHeaderSize = 12; // id(4) + contentBytes(4) + childrenBytes(4)
  const sizeChunkTotal = chunkHeaderSize + sizeChunkContent;
  const xyziChunkTotal = chunkHeaderSize + xyziChunkContent;
  const mainChildrenBytes = sizeChunkTotal + xyziChunkTotal;

  const totalBytes =
    4 + // magic
    4 + // version
    chunkHeaderSize + // MAIN header
    mainChildrenBytes; // MAIN children

  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  let offset = 0;

  function writeUint32(v: number): void {
    view.setUint32(offset, v, true);
    offset += 4;
  }
  function writeInt32(v: number): void {
    view.setInt32(offset, v, true);
    offset += 4;
  }
  function writeStr(s: string): void {
    for (let i = 0; i < 4; i++) {
      view.setUint8(offset++, s.charCodeAt(i));
    }
  }
  function writeUint8(v: number): void {
    view.setUint8(offset++, v);
  }

  // Magic 'VOX ' = 0x20584f56 little-endian
  writeUint32(0x20584f56);
  writeInt32(150); // version

  // MAIN chunk
  writeStr("MAIN");
  writeInt32(0); // no content
  writeInt32(mainChildrenBytes);

  // SIZE chunk
  writeStr("SIZE");
  writeInt32(sizeChunkContent);
  writeInt32(0);
  writeInt32(sx);
  writeInt32(sy);
  writeInt32(sz);

  // XYZI chunk
  writeStr("XYZI");
  writeInt32(xyziChunkContent);
  writeInt32(0);
  writeInt32(voxels.length);
  for (const v of voxels) {
    writeUint8(v.x);
    writeUint8(v.y);
    writeUint8(v.z);
    writeUint8(v.colorIndex);
  }

  return buf;
}

describe("parseVoxFile", () => {
  it("parses a minimal single-voxel .vox file", () => {
    const buf = buildVoxBuffer(2, 2, 2, [{ x: 1, y: 0, z: 0, colorIndex: 5 }]);
    const model = parseVoxFile(buf);

    expect(model.size).toEqual({ x: 2, y: 2, z: 2 });
    expect(model.voxels).toHaveLength(1);
    expect(model.voxels[0]).toEqual({ x: 1, y: 0, z: 0, colorIndex: 5 });
  });

  it("parses size correctly", () => {
    const buf = buildVoxBuffer(10, 20, 30, []);
    const model = parseVoxFile(buf);
    expect(model.size).toEqual({ x: 10, y: 20, z: 30 });
  });

  it("parses multiple voxels", () => {
    const voxels = [
      { x: 0, y: 0, z: 0, colorIndex: 1 },
      { x: 1, y: 0, z: 0, colorIndex: 2 },
      { x: 0, y: 1, z: 0, colorIndex: 3 },
    ];
    const buf = buildVoxBuffer(4, 4, 4, voxels);
    const model = parseVoxFile(buf);

    expect(model.voxels).toHaveLength(3);
    expect(model.voxels[0]).toEqual({ x: 0, y: 0, z: 0, colorIndex: 1 });
    expect(model.voxels[1]).toEqual({ x: 1, y: 0, z: 0, colorIndex: 2 });
    expect(model.voxels[2]).toEqual({ x: 0, y: 1, z: 0, colorIndex: 3 });
  });

  it("uses the default palette when no RGBA chunk is present", () => {
    const buf = buildVoxBuffer(1, 1, 1, [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const model = parseVoxFile(buf);
    // Default palette is always 256 entries
    expect(model.palette).toHaveLength(256);
  });

  it("throws on invalid magic bytes", () => {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, 0xdeadbeef, true); // wrong magic
    expect(() => parseVoxFile(buf)).toThrow(/invalid .vox file/i);
  });

  it("parses an empty voxel list", () => {
    const buf = buildVoxBuffer(5, 5, 5, []);
    const model = parseVoxFile(buf);
    expect(model.voxels).toHaveLength(0);
    expect(model.size).toEqual({ x: 5, y: 5, z: 5 });
  });
});

describe("voxToMesh", () => {
  it("returns empty arrays for a model with no voxels", () => {
    const model: VoxModel = {
      size: { x: 5, y: 5, z: 5 },
      voxels: [],
      palette: [],
    };
    const mesh = voxToMesh(model);
    expect(mesh.vertices.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
    expect(mesh.colors.length).toBe(0);
  });

  it("produces vertices for a single isolated voxel", () => {
    const buf = buildVoxBuffer(1, 1, 1, [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const model = parseVoxFile(buf);
    const mesh = voxToMesh(model);

    // An isolated voxel has 6 faces, each 4 vertices: 24 vertices
    // vertices is 3 floats per vertex: 24 * 3 = 72
    expect(mesh.vertices.length).toBe(72);
    // 6 faces * 2 triangles * 3 indices = 36
    expect(mesh.indices.length).toBe(36);
    // 4 floats (rgba) per vertex: 24 * 4 = 96
    expect(mesh.colors.length).toBe(96);
  });

  it("culls internal faces between adjacent voxels", () => {
    // Two side-by-side voxels sharing a face — the shared face should be culled
    const buf = buildVoxBuffer(2, 1, 1, [
      { x: 0, y: 0, z: 0, colorIndex: 1 },
      { x: 1, y: 0, z: 0, colorIndex: 2 },
    ]);
    const model = parseVoxFile(buf);
    const mesh = voxToMesh(model);

    // Each voxel has 6 faces, but they share 1 face each (2 shared half-faces removed)
    // So 10 visible faces * 4 verts = 40 verts, 10 * 6 indices = 60
    expect(mesh.vertices.length).toBe(40 * 3);
    expect(mesh.indices.length).toBe(60);
  });

  it("vertex positions are within expected bounds for a single voxel", () => {
    const buf = buildVoxBuffer(1, 1, 1, [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const model = parseVoxFile(buf);
    const mesh = voxToMesh(model);

    // All vertex positions should be 0 or 1 for a unit voxel at origin
    for (let i = 0; i < mesh.vertices.length; i++) {
      expect(mesh.vertices[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.vertices[i]).toBeLessThanOrEqual(1);
    }
  });

  it("color values are normalized to [0, 1]", () => {
    const buf = buildVoxBuffer(1, 1, 1, [{ x: 0, y: 0, z: 0, colorIndex: 1 }]);
    const model = parseVoxFile(buf);
    const mesh = voxToMesh(model);

    for (let i = 0; i < mesh.colors.length; i++) {
      expect(mesh.colors[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.colors[i]).toBeLessThanOrEqual(1);
    }
  });

  it("handles a 2x2x2 solid cube (all internal faces culled)", () => {
    const voxels = [];
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          voxels.push({ x, y, z, colorIndex: 1 });
        }
      }
    }
    const buf = buildVoxBuffer(2, 2, 2, voxels);
    const model = parseVoxFile(buf);
    const mesh = voxToMesh(model);

    // 2x2x2 cube: 6 faces * 4 (side length squared) = 24 visible faces
    // 24 faces * 4 verts = 96 verts, 24 * 6 indices = 144
    expect(mesh.vertices.length).toBe(96 * 3);
    expect(mesh.indices.length).toBe(144);
  });

  it("indices reference valid vertex positions", () => {
    const buf = buildVoxBuffer(1, 1, 1, [{ x: 0, y: 0, z: 0, colorIndex: 2 }]);
    const model = parseVoxFile(buf);
    const mesh = voxToMesh(model);

    const maxIndex = mesh.vertices.length / 3;
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.indices[i]).toBeLessThan(maxIndex);
    }
  });
});
