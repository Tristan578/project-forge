/**
 * 3D model quality validation and metrics extraction.
 *
 * Parses GLB (binary glTF) files to extract quality metrics:
 * - File size classification
 * - Mesh primitive and material counts
 * - Estimated triangle count from accessor data
 * - Format validation (magic bytes, version)
 *
 * Used in the post-generation pipeline to attach quality
 * metadata and generate warnings before import.
 */

export interface ModelQualityMetrics {
  /** Total file size in bytes */
  fileSize: number;
  /** File size category */
  sizeCategory: 'small' | 'medium' | 'large' | 'oversized';
  /** Whether the GLB header is valid */
  validFormat: boolean;
  /** glTF version from header */
  version: number;
  /** Number of mesh primitives (draw calls) */
  primitiveCount: number;
  /** Number of materials */
  materialCount: number;
  /** Estimated triangle count (from index accessor or vertex count) */
  estimatedTriangles: number;
  /** Triangle budget category */
  polyBudget: 'low' | 'medium' | 'high' | 'over_budget';
  /** Quality warnings */
  warnings: string[];
}

// Size thresholds in bytes
const SIZE_THRESHOLDS = {
  small: 1 * 1024 * 1024,      // < 1 MB
  medium: 5 * 1024 * 1024,     // < 5 MB
  large: 15 * 1024 * 1024,     // < 15 MB
  // >= 15 MB = oversized
};

// Triangle budget thresholds
const POLY_THRESHOLDS = {
  low: 10_000,       // < 10K tris
  medium: 50_000,    // < 50K tris
  high: 200_000,     // < 200K tris
  // >= 200K = over_budget
};

/**
 * Validate and extract quality metrics from a GLB blob.
 */
export async function analyzeModelQuality(blob: Blob): Promise<ModelQualityMetrics> {
  const warnings: string[] = [];
  const fileSize = blob.size;
  const sizeCategory = classifySize(fileSize);

  if (sizeCategory === 'oversized') {
    warnings.push(
      `Model is ${formatBytes(fileSize)} — very large. ` +
      `Consider using a lower quality setting for better performance.`
    );
  } else if (sizeCategory === 'large') {
    warnings.push(
      `Model is ${formatBytes(fileSize)}. May impact load times on mobile devices.`
    );
  }

  // Parse GLB header
  const buffer = await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer();
  const view = new DataView(buffer);

  // Check GLB magic bytes: "glTF" = 0x46546C67
  if (buffer.byteLength < 12) {
    return {
      fileSize,
      sizeCategory,
      validFormat: false,
      version: 0,
      primitiveCount: 0,
      materialCount: 0,
      estimatedTriangles: 0,
      polyBudget: 'low',
      warnings: [...warnings, 'File too small to be a valid GLB'],
    };
  }

  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) {
    return {
      fileSize,
      sizeCategory,
      validFormat: false,
      version: 0,
      primitiveCount: 0,
      materialCount: 0,
      estimatedTriangles: 0,
      polyBudget: 'low',
      warnings: [...warnings, 'Invalid GLB format (bad magic bytes)'],
    };
  }

  const version = view.getUint32(4, true);
  if (version !== 2) {
    warnings.push(`Unexpected glTF version: ${version} (expected 2)`);
  }

  // Parse JSON chunk
  let primitiveCount = 0;
  let materialCount = 0;
  let estimatedTriangles = 0;

  try {
    const jsonChunkLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);

    // JSON chunk type should be 0x4E4F534A ("JSON")
    if (jsonChunkType === 0x4E4F534A && buffer.byteLength >= 20 + jsonChunkLength) {
      const decoder = new TextDecoder();
      const jsonBytes = new Uint8Array(buffer, 20, jsonChunkLength);
      const jsonStr = decoder.decode(jsonBytes);
      const gltf = JSON.parse(jsonStr);

      // Count materials
      materialCount = Array.isArray(gltf.materials) ? gltf.materials.length : 0;

      // Count primitives and estimate triangles from accessors
      if (Array.isArray(gltf.meshes)) {
        for (const mesh of gltf.meshes) {
          if (!Array.isArray(mesh.primitives)) continue;
          primitiveCount += mesh.primitives.length;

          for (const prim of mesh.primitives) {
            // Use indices accessor if available, otherwise position accessor
            const accessorIndex = prim.indices ?? prim.attributes?.POSITION;
            if (accessorIndex !== undefined && Array.isArray(gltf.accessors)) {
              const accessor = gltf.accessors[accessorIndex];
              if (accessor?.count) {
                if (prim.indices !== undefined) {
                  // Index count / 3 = triangle count
                  estimatedTriangles += Math.floor(accessor.count / 3);
                } else {
                  // Vertex count / 3 = triangle count (for non-indexed)
                  estimatedTriangles += Math.floor(accessor.count / 3);
                }
              }
            }
          }
        }
      }
    }
  } catch {
    warnings.push('Could not parse GLB JSON chunk for quality metrics');
  }

  const polyBudget = classifyPolyBudget(estimatedTriangles);
  if (polyBudget === 'over_budget') {
    warnings.push(
      `Model has ~${estimatedTriangles.toLocaleString()} triangles — exceeds recommended budget. ` +
      `Consider requesting a lower quality or poly count.`
    );
  }

  if (primitiveCount > 20) {
    warnings.push(
      `Model has ${primitiveCount} draw calls (mesh primitives). ` +
      `High draw call count may impact rendering performance.`
    );
  }

  return {
    fileSize,
    sizeCategory,
    validFormat: true,
    version,
    primitiveCount,
    materialCount,
    estimatedTriangles,
    polyBudget,
    warnings,
  };
}

/** Classify file size into categories. */
export function classifySize(bytes: number): ModelQualityMetrics['sizeCategory'] {
  if (bytes < SIZE_THRESHOLDS.small) return 'small';
  if (bytes < SIZE_THRESHOLDS.medium) return 'medium';
  if (bytes < SIZE_THRESHOLDS.large) return 'large';
  return 'oversized';
}

/** Classify triangle count into budget categories. */
export function classifyPolyBudget(triangles: number): ModelQualityMetrics['polyBudget'] {
  if (triangles < POLY_THRESHOLDS.low) return 'low';
  if (triangles < POLY_THRESHOLDS.medium) return 'medium';
  if (triangles < POLY_THRESHOLDS.high) return 'high';
  return 'over_budget';
}

/** Format bytes into human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
