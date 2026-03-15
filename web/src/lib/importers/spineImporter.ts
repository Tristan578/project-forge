/**
 * Spine 2D JSON Runtime Importer
 *
 * Parses Spine's JSON runtime export format and converts it to SpawnForge's
 * SkeletonData2d / SkeletalAnimation2d types used by the 2D-5 skeletal system.
 *
 * Spine JSON structure (runtime format):
 *   skeleton: { hash, spine, x, y, width, height, images?, audio? }
 *   bones:    [{ name, parent?, length?, x?, y?, rotation?, scaleX?, scaleY?, color? }]
 *   slots:    [{ name, bone, attachment?, color?, blend? }]
 *   skins:    [{ name, attachments: { "<slot>": { "<name>": { type?, x?, y?, rotation?, ... } } } }]
 *   animations: { "<name>": { bones?: { "<bone>": { rotate?, translate?, scale? } }, slots?, ... } }
 */

import type {
  SkeletonData2d,
  Bone2dDef,
  SlotDef,
  SkinData2d,
  AttachmentData2d,
  SkeletalAnimation2d,
  BoneKeyframe2d,
} from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface SpineAnimation {
  name: string;
  animation: SkeletalAnimation2d;
}

export interface SpineImportResult {
  skeleton: SkeletonData2d;
  animations: SpineAnimation[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Raw Spine JSON shapes (leniently typed — Spine has optional fields)
// ---------------------------------------------------------------------------

interface RawSpineBone {
  name: string;
  parent?: string;
  length?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  color?: string; // "RRGGBBAA" hex
}

interface RawSpineSlot {
  name: string;
  bone: string;
  attachment?: string;
  color?: string;
  blend?: string;
}

interface RawSpineAttachment {
  type?: string;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  width?: number;
  height?: number;
  path?: string; // texture region name
  vertices?: number[];
  uvs?: number[];
  triangles?: number[];
}

interface RawSpineSkin {
  name: string;
  attachments?: Record<string, Record<string, RawSpineAttachment>>;
}

interface RawSpineRotateKeyframe {
  time: number;
  angle?: number;
  curve?: string | number[];
}

interface RawSpineTranslateKeyframe {
  time: number;
  x?: number;
  y?: number;
  curve?: string | number[];
}

interface RawSpineScaleKeyframe {
  time: number;
  x?: number;
  y?: number;
  curve?: string | number[];
}

interface RawSpineBoneTimeline {
  rotate?: RawSpineRotateKeyframe[];
  translate?: RawSpineTranslateKeyframe[];
  scale?: RawSpineScaleKeyframe[];
}

interface RawSpineAnimation {
  bones?: Record<string, RawSpineBoneTimeline>;
  // slots, ik, transform, etc. not mapped to our types yet
}

interface RawSpineJson {
  skeleton?: {
    hash?: string;
    width?: number;
    height?: number;
    spine?: string;
    images?: string;
  };
  bones?: RawSpineBone[];
  slots?: RawSpineSlot[];
  skins?: RawSpineSkin[] | Record<string, unknown>;
  animations?: Record<string, RawSpineAnimation>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse Spine's "RRGGBBAA" hex color into [r, g, b, a] 0-1 floats. */
function parseSpineColor(hex: string | undefined): [number, number, number, number] {
  if (!hex || hex.length < 8) return [1, 1, 1, 1];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const a = parseInt(hex.slice(6, 8), 16) / 255;
  return [r, g, b, a];
}

/** Map Spine curve type to SpawnForge easing. */
function mapCurve(curve: string | number[] | undefined): BoneKeyframe2d['easing'] {
  if (!curve || curve === 'linear') return 'linear';
  if (curve === 'stepped') return 'step';
  // Bezier (array of 4 control point values) — approximate as ease_in_out
  if (Array.isArray(curve)) return 'ease_in_out';
  return 'linear';
}

/** Compute duration from the last keyframe time across all tracks. */
function computeDuration(bones: Record<string, RawSpineBoneTimeline>): number {
  let max = 0;
  for (const timeline of Object.values(bones)) {
    const allFrames: Array<{ time: number }> = [
      ...(timeline.rotate ?? []),
      ...(timeline.translate ?? []),
      ...(timeline.scale ?? []),
    ];
    for (const kf of allFrames) {
      if (kf.time > max) max = kf.time;
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Bone parsing
// ---------------------------------------------------------------------------

function parseBones(rawBones: RawSpineBone[], warnings: string[]): Bone2dDef[] {
  return rawBones.map((rb): Bone2dDef => {
    if (!rb.name) {
      warnings.push('Bone missing name field — using "unnamed"');
    }
    return {
      name: rb.name ?? 'unnamed',
      parentBone: rb.parent ?? null,
      localPosition: [rb.x ?? 0, rb.y ?? 0],
      localRotation: rb.rotation ?? 0,
      localScale: [rb.scaleX ?? 1, rb.scaleY ?? 1],
      length: rb.length ?? 0,
      color: parseSpineColor(rb.color),
    };
  });
}

// ---------------------------------------------------------------------------
// Slot parsing
// ---------------------------------------------------------------------------

function parseSlots(rawSlots: RawSpineSlot[], warnings: string[]): SlotDef[] {
  return rawSlots.map((rs): SlotDef => {
    if (!rs.name || !rs.bone) {
      warnings.push(`Slot "${rs.name ?? '?'}" missing required fields`);
    }
    let blendMode: SlotDef['blendMode'] = 'normal';
    if (rs.blend === 'additive') blendMode = 'additive';
    else if (rs.blend === 'multiply') blendMode = 'multiply';
    else if (rs.blend === 'screen') blendMode = 'screen';

    return {
      name: rs.name ?? 'unnamed_slot',
      boneName: rs.bone ?? '',
      spritePart: rs.attachment ?? '',
      blendMode,
      attachment: rs.attachment ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Skin parsing
// ---------------------------------------------------------------------------

function parseSkins(
  rawSkins: RawSpineSkin[] | Record<string, unknown> | undefined,
  warnings: string[],
): Record<string, SkinData2d> {
  if (!rawSkins) return {};

  // Spine 4.x uses array format; Spine 3.x used object format
  let skinArray: RawSpineSkin[];
  if (Array.isArray(rawSkins)) {
    skinArray = rawSkins as RawSpineSkin[];
  } else {
    // Convert legacy object format: { "skinName": { "slot": { "attach": {...} } } }
    skinArray = Object.entries(rawSkins as Record<string, unknown>).map(([name, attachments]) => ({
      name,
      attachments: attachments as Record<string, Record<string, RawSpineAttachment>>,
    }));
  }

  const result: Record<string, SkinData2d> = {};
  for (const skin of skinArray) {
    const skinAttachments: Record<string, AttachmentData2d> = {};
    const rawAttachments = skin.attachments ?? {};

    for (const [slotName, slotAttachments] of Object.entries(rawAttachments)) {
      for (const [attachName, raw] of Object.entries(slotAttachments)) {
        const key = `${slotName}/${attachName}`;
        const attType = raw.type ?? 'region';
        let mapped: AttachmentData2d;

        if (attType === 'mesh' || attType === 'linkedmesh') {
          // Mesh attachment — extract vertices/uvs/triangles
          const rawVerts = raw.vertices ?? [];
          const rawUvs = raw.uvs ?? [];
          const verts: [number, number][] = [];
          const uvs: [number, number][] = [];
          for (let i = 0; i + 1 < rawVerts.length; i += 2) {
            verts.push([rawVerts[i], rawVerts[i + 1]]);
          }
          for (let i = 0; i + 1 < rawUvs.length; i += 2) {
            uvs.push([rawUvs[i], rawUvs[i + 1]]);
          }
          mapped = {
            type: 'mesh',
            textureId: raw.path ?? attachName,
            offset: [raw.x ?? 0, raw.y ?? 0],
            rotation: raw.rotation,
            scale: [raw.scaleX ?? 1, raw.scaleY ?? 1],
            vertices: verts,
            uvs,
            triangles: raw.triangles,
          };
        } else {
          // region / default sprite attachment
          mapped = {
            type: 'sprite',
            textureId: raw.path ?? attachName,
            offset: [raw.x ?? 0, raw.y ?? 0],
            rotation: raw.rotation,
            scale: [raw.scaleX ?? 1, raw.scaleY ?? 1],
          };
        }

        if (!skinAttachments[key]) {
          skinAttachments[key] = mapped;
        } else {
          // Duplicate key — last one wins, emit warning
          warnings.push(`Duplicate attachment key "${key}" in skin "${skin.name}" — overwriting`);
          skinAttachments[key] = mapped;
        }
      }
    }

    result[skin.name] = { name: skin.name, attachments: skinAttachments };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Animation parsing
// ---------------------------------------------------------------------------

function parseAnimations(
  rawAnimations: Record<string, RawSpineAnimation> | undefined,
  warnings: string[],
): SpineAnimation[] {
  if (!rawAnimations) return [];

  const results: SpineAnimation[] = [];

  for (const [animName, rawAnim] of Object.entries(rawAnimations)) {
    const bones = rawAnim.bones ?? {};
    const duration = computeDuration(bones);
    const tracks: Record<string, BoneKeyframe2d[]> = {};

    for (const [boneName, timeline] of Object.entries(bones)) {
      const keyframes: BoneKeyframe2d[] = [];

      // --- rotation keyframes ---
      for (const kf of timeline.rotate ?? []) {
        keyframes.push({
          time: kf.time,
          rotation: kf.angle ?? 0,
          easing: mapCurve(kf.curve),
        });
      }

      // --- translation keyframes ---
      for (const kf of timeline.translate ?? []) {
        // Find or create an entry at this time (merge with rotation if same time)
        const existing = keyframes.find((k) => k.time === kf.time && k.position === undefined);
        if (existing) {
          existing.position = [kf.x ?? 0, kf.y ?? 0];
        } else {
          keyframes.push({
            time: kf.time,
            position: [kf.x ?? 0, kf.y ?? 0],
            easing: mapCurve(kf.curve),
          });
        }
      }

      // --- scale keyframes ---
      for (const kf of timeline.scale ?? []) {
        const existing = keyframes.find((k) => k.time === kf.time && k.scale === undefined);
        if (existing) {
          existing.scale = [kf.x ?? 1, kf.y ?? 1];
        } else {
          keyframes.push({
            time: kf.time,
            scale: [kf.x ?? 1, kf.y ?? 1],
            easing: mapCurve(kf.curve),
          });
        }
      }

      if (keyframes.length === 0) {
        warnings.push(`Bone "${boneName}" in animation "${animName}" has no keyframes`);
        continue;
      }

      // Sort by time ascending
      keyframes.sort((a, b) => a.time - b.time);
      tracks[boneName] = keyframes;
    }

    if (Object.keys(rawAnim).some((k) => k !== 'bones')) {
      warnings.push(
        `Animation "${animName}" contains non-bone timelines (slots/ik/deform) — only bone tracks are imported`,
      );
    }

    results.push({
      name: animName,
      animation: {
        name: animName,
        duration,
        looping: true, // Spine doesn't encode this in JSON — assume looping
        tracks,
      },
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse a Spine JSON runtime export and return SpawnForge-compatible data.
 *
 * @param json - Parsed JSON (unknown type; validated here)
 * @returns SpineImportResult with skeleton, animations, and any non-fatal warnings
 * @throws Error if the input is not a valid Spine JSON object
 */
export function parseSpineJson(json: unknown): SpineImportResult {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid Spine JSON: expected a JSON object at root level');
  }

  const raw = json as RawSpineJson;
  const warnings: string[] = [];

  // Bones are required
  if (!Array.isArray(raw.bones) || raw.bones.length === 0) {
    throw new Error('Invalid Spine JSON: "bones" array is missing or empty');
  }

  const bones = parseBones(raw.bones, warnings);
  const slots = parseSlots(raw.slots ?? [], warnings);
  const skins = parseSkins(raw.skins, warnings);

  // Ensure at least a "default" skin exists
  const activeSkin = skins['default'] ? 'default' : (Object.keys(skins)[0] ?? 'default');
  if (!skins[activeSkin]) {
    skins[activeSkin] = { name: activeSkin, attachments: {} };
    warnings.push('No skins found — created empty default skin');
  }

  const skeleton: SkeletonData2d = {
    bones,
    slots,
    skins,
    activeSkin,
    ikConstraints: [], // IK constraints are not encoded in Spine JSON runtime format
  };

  const animations = parseAnimations(raw.animations, warnings);

  return { skeleton, animations, warnings };
}
