/**
 * PBR Texture Set Importer
 *
 * Detects which PBR material slot each file belongs to based on filename
 * patterns, then converts the matched files to base64 data URLs ready for
 * the engine texture pipeline.
 */

/** All recognised PBR material slots. */
export type PbrSlot = 'albedo' | 'normal' | 'metallic' | 'roughness' | 'ao';

/** Result of auto-detecting a PBR texture set from a list of files. */
export interface PbrTextureSet {
  albedo?: File;
  normal?: File;
  metallic?: File;
  roughness?: File;
  ao?: File;
  /** Files that did not match any recognised PBR slot pattern. */
  unmatched: File[];
}

/** Base64 data URLs for each matched PBR slot. */
export interface PbrTextureData {
  albedo?: string;
  normal?: string;
  metallic?: string;
  roughness?: string;
  ao?: string;
}

/** Ordered slot patterns — first match wins for each file. */
const SLOT_PATTERNS: Array<{ slot: PbrSlot; patterns: RegExp[] }> = [
  {
    slot: 'albedo',
    patterns: [/_albedo/i, /_color/i, /_diffuse/i, /_basecolor/i],
  },
  {
    slot: 'normal',
    patterns: [/_normal/i, /_nrm/i],
  },
  {
    slot: 'metallic',
    patterns: [/_metallic/i, /_metal/i],
  },
  {
    slot: 'roughness',
    patterns: [/_roughness/i, /_rough/i],
  },
  {
    slot: 'ao',
    patterns: [/_ao/i, /_ambient/i, /_occlusion/i],
  },
];

/**
 * Matches a single filename against all slot patterns.
 * Returns the first matching slot, or null if nothing matches.
 */
function matchSlot(filename: string): PbrSlot | null {
  // Strip extension so that e.g. "rock_normal.png" still matches "_normal"
  const stem = filename.replace(/\.[^.]+$/, '');

  for (const { slot, patterns } of SLOT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(stem)) {
        return slot;
      }
    }
  }
  return null;
}

/**
 * Inspect a list of files and auto-detect which PBR slot each one belongs to.
 *
 * - Returns a `PbrTextureSet` when at least one file matches a known pattern.
 * - Returns `null` when none of the files match any PBR slot pattern.
 * - When multiple files match the same slot, the first one wins and the rest
 *   are placed in `unmatched`.
 */
export function detectPbrTextureSet(files: File[]): PbrTextureSet | null {
  const set: PbrTextureSet = { unmatched: [] };
  let anyMatched = false;

  for (const file of files) {
    const slot = matchSlot(file.name);
    if (slot === null) {
      set.unmatched.push(file);
      continue;
    }

    anyMatched = true;

    if (set[slot] === undefined) {
      set[slot] = file;
    } else {
      // Slot already claimed — treat subsequent files as unmatched
      set.unmatched.push(file);
    }
  }

  return anyMatched ? set : null;
}

/** Read a single File as a base64 data URL. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert each file in a `PbrTextureSet` to a base64 data URL.
 *
 * Slots that are `undefined` in the input set will be `undefined` in the
 * returned `PbrTextureData`.  The `unmatched` list is intentionally omitted
 * from the output — callers can inspect it on the original `PbrTextureSet`.
 */
export async function filesToBase64(set: PbrTextureSet): Promise<PbrTextureData> {
  const data: PbrTextureData = {};

  const slots: PbrSlot[] = ['albedo', 'normal', 'metallic', 'roughness', 'ao'];
  await Promise.all(
    slots.map(async (slot) => {
      const file = set[slot];
      if (file !== undefined) {
        data[slot] = await fileToDataUrl(file);
      }
    }),
  );

  return data;
}
