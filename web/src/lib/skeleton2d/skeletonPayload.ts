/**
 * The one place the browser's 2D skeleton shape and the engine's `SkeletonData2d`
 * wire shape meet.
 *
 * They are NOT the same shape, and every difference is a hard
 * `serde_json::from_value` reject rather than a dropped field — `create_skeleton2d`
 * does `.map_err(|e| format!("Invalid skeletonData: {}", e))?`, so one wrong arity
 * anywhere in the tree loses the entire rig. `dispatchCommand` returns `void`, so
 * nothing in the browser sees the refusal.
 *
 * Three differences, all load-bearing (see `engine/src/core/skeleton2d.rs`):
 *
 * - `Bone2dDef::local_position` is `[f32; 3]`. The store and the inspector are
 *   genuinely 2D and carry a 2-tuple; Z exists on the engine side for round-trip
 *   fidelity with 3D rigs. A 2-element array is "invalid length 2, expected an
 *   array of length 3".
 * - `IkConstraint2d::target_entity_id` is a `String` (an entity UUID). The store
 *   type declares `number`, which cannot deserialize into a `String` at all.
 * - `AttachmentData` is an internally-tagged enum (`tag = "type"`) whose variants
 *   have NO optional fields. The store type is one flat struct with everything
 *   after `textureId` optional, so a sprite attachment missing `offset` — or any
 *   mesh attachment, since the store shape has no `weights` field to carry —
 *   refuses the whole skeleton.
 *
 * Numbers are clamped to a finite fallback rather than dropped. A non-finite
 * value is a real defect upstream, but `NaN` survives the JS→Rust conversion as a
 * `NaN` `f32` and poisons a bone transform silently, whereas clamping leaves a
 * rig that is visibly wrong in one place instead of an entity that renders nothing.
 */

// Type-only, deliberately: this module is reachable from an API route, and a value
// import of `@/stores/` drags the client-only store into a server graph and breaks
// `next build` (see `.claude/rules/gotchas.md` → the RSC-boundary entry).
import type {
  SkeletonData2d as StoreSkeletonData2d,
  Bone2dDef as StoreBone2d,
  SlotDef as StoreSlot2d,
  SkinData2d as StoreSkin2d,
  AttachmentData2d as StoreAttachment2d,
  IkConstraint2d as StoreIkConstraint2d,
} from '@/stores/slices/types';

/**
 * Mirror of `MAX_IK_BONE_CHAIN_2D` in `engine/src/core/commands/sprites.rs`, which
 * refuses a longer `bones` array outright. Pinned against the Rust source by this
 * module's test so the two cannot drift into a silent rejection.
 */
export const MAX_IK_BONE_CHAIN_2D = 64;

/** A bone exactly as `Bone2dDef` reads it. */
export interface WireBone2d {
  name: string;
  parentBone: string | null;
  localPosition: [number, number, number];
  localRotation: number;
  localScale: [number, number];
  length: number;
  color: [number, number, number, number];
}

/** A slot exactly as `SlotDef` reads it. */
export interface WireSlot2d {
  name: string;
  boneName: string;
  spritePart: string;
  blendMode: WireBlendMode2d;
  attachment: string | null;
}

export type WireBlendMode2d = 'normal' | 'additive' | 'multiply' | 'screen';

/** Per-vertex skin weights exactly as `VertexWeights` reads them. */
export interface WireVertexWeights2d {
  bones: string[];
  weights: number[];
}

/** An attachment exactly as the `AttachmentData` enum reads it. */
export type WireAttachment2d =
  | {
      type: 'sprite';
      textureId: string;
      offset: [number, number];
      rotation: number;
      scale: [number, number];
    }
  | {
      type: 'mesh';
      textureId: string;
      vertices: [number, number][];
      uvs: [number, number][];
      triangles: number[];
      weights: WireVertexWeights2d[];
    };

/** A skin exactly as `SkinData` reads it. */
export interface WireSkin2d {
  name: string;
  attachments: Record<string, WireAttachment2d>;
}

/** An IK constraint exactly as `IkConstraint2d` reads it. */
export interface WireIkConstraint2d {
  name: string;
  boneChain: string[];
  targetEntityId: string;
  bendDirection: number;
  mix: number;
}

/** `SkeletonData2d` as the engine reads it. */
export interface WireSkeletonData2d {
  bones: WireBone2d[];
  slots: WireSlot2d[];
  skins: Record<string, WireSkin2d>;
  activeSkin: string;
  ikConstraints: WireIkConstraint2d[];
}

/**
 * A `type` rather than an `interface` on purpose: only a type alias of an object
 * type gets TypeScript's implicit index signature, and `rigToCommands` declares
 * its payloads as `Record<string, unknown>`.
 */
export type CreateSkeleton2dPayload = {
  entityId: string;
  skeletonData: WireSkeletonData2d;
};

/**
 * The loose input side. Deliberately wider than the store's `SkeletonData2d`:
 * `rigToCommands` already emits 3-tuple positions and string target ids, and both
 * producers must funnel through here rather than hand-rolling the wire shape a
 * second time.
 */
export interface SkeletonSource2d {
  bones?: readonly SourceBone2d[];
  slots?: readonly SourceSlot2d[];
  skins?: Readonly<Record<string, SourceSkin2d>>;
  activeSkin?: string;
  ikConstraints?: readonly SourceIkConstraint2d[];
}

export interface SourceBone2d {
  name?: string;
  parentBone?: string | null;
  localPosition?: readonly number[];
  localRotation?: number;
  localScale?: readonly number[];
  length?: number;
  color?: readonly number[];
}

export interface SourceSlot2d {
  name?: string;
  boneName?: string;
  spritePart?: string;
  blendMode?: string;
  attachment?: string | null;
}

export interface SourceSkin2d {
  name?: string;
  attachments?: Readonly<Record<string, SourceAttachment2d>>;
}

export interface SourceAttachment2d {
  type?: string;
  textureId?: string;
  offset?: readonly number[];
  rotation?: number;
  scale?: readonly number[];
  vertices?: readonly (readonly number[])[];
  uvs?: readonly (readonly number[])[];
  triangles?: readonly number[];
  weights?: readonly { bones?: readonly string[]; weights?: readonly number[] }[];
}

export interface SourceIkConstraint2d {
  name?: string;
  boneChain?: readonly string[];
  targetEntityId?: string | number;
  bendDirection?: number;
  mix?: number;
}

const BLEND_MODES: readonly WireBlendMode2d[] = ['normal', 'additive', 'multiply', 'screen'];

const DEFAULT_BONE_LENGTH = 50;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Read an indexed slot rather than a callback form. A sparse array skips the
 * callback for a hole entirely, so `.map` would preserve the gap positionally and
 * `JSON.stringify` would then write it as `null` — which is not a number and
 * refuses the whole skeleton.
 */
function vec(source: readonly number[] | undefined, length: number, fallback: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    out.push(finite(source?.[i], fallback));
  }
  return out;
}

function vec2(source: readonly number[] | undefined, fallback: number): [number, number] {
  const [x, y] = vec(source, 2, fallback);
  return [x, y];
}

/** The 2D→3D widening. A missing Z is 0, never absent. */
function position3(source: readonly number[] | undefined): [number, number, number] {
  const [x, y, z] = vec(source, 3, 0);
  return [x, y, z];
}

function color4(source: readonly number[] | undefined): [number, number, number, number] {
  const [r, g, b, a] = vec(source, 4, 1);
  return [r, g, b, a];
}

function wireBone(bone: SourceBone2d, index: number): WireBone2d {
  return {
    name: bone.name ?? `bone_${index}`,
    parentBone: bone.parentBone ?? null,
    localPosition: position3(bone.localPosition),
    localRotation: finite(bone.localRotation, 0),
    localScale: vec2(bone.localScale, 1),
    length: finite(bone.length, DEFAULT_BONE_LENGTH),
    color: color4(bone.color),
  };
}

function wireBlendMode(mode: string | undefined): WireBlendMode2d {
  return BLEND_MODES.find(known => known === mode) ?? 'normal';
}

function wireSlot(slot: SourceSlot2d, index: number): WireSlot2d {
  return {
    name: slot.name ?? `slot_${index}`,
    boneName: slot.boneName ?? '',
    spritePart: slot.spritePart ?? '',
    blendMode: wireBlendMode(slot.blendMode),
    attachment: slot.attachment ?? null,
  };
}

function wireVec2List(source: readonly (readonly number[])[] | undefined): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < (source?.length ?? 0); i += 1) {
    out.push(vec2(source?.[i], 0));
  }
  return out;
}

/**
 * An attachment whose `type` is neither variant cannot be widened into one, and an
 * unknown tag refuses the whole skeleton — so it is dropped. Losing one attachment
 * beats losing the rig, and the return type makes the caller handle the absence.
 */
function wireAttachment(attachment: SourceAttachment2d): WireAttachment2d | null {
  const textureId = attachment.textureId ?? '';

  if (attachment.type === 'sprite') {
    return {
      type: 'sprite',
      textureId,
      offset: vec2(attachment.offset, 0),
      rotation: finite(attachment.rotation, 0),
      scale: vec2(attachment.scale, 1),
    };
  }

  if (attachment.type === 'mesh') {
    const vertices = wireVec2List(attachment.vertices);
    const weights: WireVertexWeights2d[] = [];
    for (let i = 0; i < (attachment.weights?.length ?? 0); i += 1) {
      const entry = attachment.weights?.[i];
      weights.push({
        bones: [...(entry?.bones ?? [])],
        weights: vec(entry?.weights, entry?.weights?.length ?? 0, 0),
      });
    }
    return {
      type: 'mesh',
      textureId,
      vertices,
      uvs: wireVec2List(attachment.uvs),
      // Out-of-range indices reach `Mesh::insert_indices` and cost the WebGPU
      // device, so a triangle that names a vertex the attachment does not have is
      // dropped here rather than sent.
      triangles: wireTriangles(attachment.triangles, vertices.length),
      weights,
    };
  }

  return null;
}

/**
 * `triangles` is a `Vec<u16>`, so an index is only sendable if it fits a u16 AND
 * names a vertex the attachment actually has. Out of range in either direction is
 * two different failures: past `u16::MAX` serde refuses the whole skeleton, and
 * within u16 but past the vertex count it reaches `Mesh::insert_indices` and costs
 * the WebGPU device. A partial triangle at the tail is dropped for the same reason.
 *
 * Indexed reads, not `.every`: a sparse array skips the callback for a hole, so
 * `[0, , 2].every(pred)` is `true` with `pred` called twice — the gate would report
 * itself satisfied for an index it never looked at.
 */
const U16_MAX = 65535;

function wireTriangles(source: readonly number[] | undefined, vertexCount: number): number[] {
  const limit = Math.min(vertexCount, U16_MAX + 1);
  const out: number[] = [];
  for (let i = 0; i + 2 < (source?.length ?? 0); i += 3) {
    const tri: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = source?.[i + corner];
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= limit) {
        break;
      }
      tri.push(index);
    }
    if (tri.length === 3) out.push(tri[0], tri[1], tri[2]);
  }
  return out;
}

function wireSkin(name: string, skin: SourceSkin2d): WireSkin2d {
  const attachments: Record<string, WireAttachment2d> = {};
  for (const key of Object.keys(skin.attachments ?? {})) {
    const source = skin.attachments?.[key];
    if (!source) continue;
    const wired = wireAttachment(source);
    if (wired) attachments[key] = wired;
  }
  return { name: skin.name ?? name, attachments };
}

/**
 * The browser-reachable half of `parse_ik_chain2d`'s validation — with one
 * deliberate difference, and it is the reason this reports.
 *
 * That Rust function bounds `bones`, normalizes `bendDirection` to a sign and
 * clamps `mix`, but it only runs for a `create_ik_chain2d` command. Everything the
 * editor and `import_skeleton_json` send arrives as a whole `SkeletonData2d`
 * instead, which serde deserializes with no validation at all, so this is the only
 * place those bounds exist on that path.
 *
 * Where the engine REFUSES a payload, this BOUNDS it: a reject on the whole-rig
 * path costs the caller every other bone in the skeleton, not just the offending
 * chain. That difference is a choice, not a claim of parity — so each bound is
 * reported through `report` rather than applied silently, which is what let an
 * over-long chain reach the engine at a different length than the one the
 * inspector was showing. Two differences remain unbounded on purpose:
 *
 * - An empty `targetEntityId` is a hard reject in `parse_ik_chain2d` and is legal
 *   here, because the store type documents empty as "no target yet" and the
 *   inspector labels such a chain inactive. The solver skips it either way.
 * - A chain the solver will skip (`< 2` bones) is passed through and reported
 *   rather than padded — there is nothing to pad it with.
 */
function wireIkConstraint(
  constraint: SourceIkConstraint2d,
  index: number,
  report: (message: string) => void,
): WireIkConstraint2d {
  const name = constraint.name ?? `ik_${index}`;

  // `IkConstraint2d::bone_chain` is a `Vec<String>`, so ONE entry that is not a
  // string — a number, a null, or the `undefined` an array hole materializes as —
  // is a hard `Invalid skeletonData` reject that loses the whole rig rather than
  // this chain. Read by index: a callback form skips a hole entirely, so the gap
  // would survive into the payload as the `null` that causes the reject.
  const source = [...(constraint.boneChain ?? [])];
  const chain: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const bone: unknown = source[i];
    if (typeof bone !== 'string' || bone.length === 0) {
      report(
        `IK chain "${name}": bones[${i}] is not a bone name, so it was dropped from the chain.`,
      );
      continue;
    }
    chain.push(bone);
  }

  // `import_skeleton_json` feeds this a bare `JSON.parse` result, so the chain is
  // whatever length the file claims, and the engine refuses a longer one outright.
  if (chain.length > MAX_IK_BONE_CHAIN_2D) {
    report(
      `IK chain "${name}": the chain is ${chain.length} bones and the engine's limit is ` +
        `${MAX_IK_BONE_CHAIN_2D}, so the last ${chain.length - MAX_IK_BONE_CHAIN_2D} were dropped.`,
    );
    chain.length = MAX_IK_BONE_CHAIN_2D;
  }
  if (chain.length < 2) {
    report(
      `IK chain "${name}": ${chain.length} bone(s) in the chain — the solver needs at least 2 ` +
        `and will skip this chain.`,
    );
  }

  // Sign is the whole meaning of this field — magnitude is not a strength dial,
  // and the engine reads only the sign. Match it rather than forwarding 2.5.
  const bendDirection = finite(constraint.bendDirection, 1) < 0 ? -1 : 1;
  if (constraint.bendDirection !== undefined && constraint.bendDirection !== bendDirection) {
    report(
      `IK chain "${name}": bend direction ${String(constraint.bendDirection)} was sent as ` +
        `${bendDirection} — the engine reads the sign and ignores the magnitude.`,
    );
  }

  // Outside 0..1 the solver blends past full IK or past full FK; clamp rather
  // than let an imported file drive it.
  const mix = Math.min(1, Math.max(0, finite(constraint.mix, 1)));
  if (constraint.mix !== undefined && constraint.mix !== mix) {
    report(
      `IK chain "${name}": blend weight ${String(constraint.mix)} is outside 0–1 and was ` +
        `sent as ${mix}.`,
    );
  }

  return {
    name,
    boneChain: chain,
    // A numeric id must become its decimal string, not `undefined` — the engine
    // field is a `String` and there is no coercion on the serde side.
    targetEntityId:
      typeof constraint.targetEntityId === 'number'
        ? String(constraint.targetEntityId)
        : constraint.targetEntityId ?? '',
    bendDirection,
    mix,
  };
}

/**
 * Convert a browser-side skeleton into the shape `SkeletonData2d` deserializes.
 *
 * Pass `warnings` to learn what was bounded on the way through. Every caller has a
 * different channel for that — a tool handler has a `result`, a panel has a status
 * line, a store action has only `console.warn` — so the collector is an out-param
 * rather than a return shape, and omitting it keeps the old signature working.
 */
export function buildWireSkeletonData2d(
  source: SkeletonSource2d,
  warnings?: string[],
): WireSkeletonData2d {
  // `import_skeleton_json` reaches here with a bare `JSON.parse` result cast to the
  // store type, so this can be null, an array, or a string however the signature
  // reads. A throw inside a store action loses more than a degraded rig does.
  const data: SkeletonSource2d =
    typeof source === 'object' && source !== null && !Array.isArray(source) ? source : {};

  const bones: WireBone2d[] = [];
  for (let i = 0; i < (data.bones?.length ?? 0); i += 1) {
    bones.push(wireBone(data.bones?.[i] ?? {}, i));
  }

  const slots: WireSlot2d[] = [];
  for (let i = 0; i < (data.slots?.length ?? 0); i += 1) {
    slots.push(wireSlot(data.slots?.[i] ?? {}, i));
  }

  const skins: Record<string, WireSkin2d> = {};
  for (const key of Object.keys(data.skins ?? {})) {
    const source = data.skins?.[key];
    if (source) skins[key] = wireSkin(key, source);
  }

  const report = (message: string) => {
    warnings?.push(message);
  };
  const ikConstraints: WireIkConstraint2d[] = [];
  for (let i = 0; i < (data.ikConstraints?.length ?? 0); i += 1) {
    ikConstraints.push(wireIkConstraint(data.ikConstraints?.[i] ?? {}, i, report));
  }

  return {
    bones,
    slots,
    skins,
    // `active_skin` is a Rust `String`, so a number here is a reject, not a coercion.
    activeSkin: typeof data.activeSkin === 'string' ? data.activeSkin : 'default',
    ikConstraints,
  };
}

/** Build the whole `create_skeleton2d` payload, nesting included. */
export function buildCreateSkeleton2dPayload(
  entityId: string,
  data: SkeletonSource2d,
  warnings?: string[],
): CreateSkeleton2dPayload {
  return { entityId, skeletonData: buildWireSkeletonData2d(data, warnings) };
}

/**
 * What `buildWireSkeletonData2d` would report for this skeleton, without building it.
 *
 * For callers that dispatch through `setSkeleton2d` rather than the builder — the
 * store owns the payload there, so this is the only way to get the same list into a
 * user-facing channel.
 */
export function collectSkeleton2dWarnings(data: SkeletonSource2d): string[] {
  const warnings: string[] = [];
  buildWireSkeletonData2d(data, warnings);
  return warnings;
}

/**
 * The inbound direction: `SKELETON2D_UPDATED` carries `SkeletonData2d` serialized
 * by the engine, which is the wire shape above and NOT the store shape. Narrowing
 * it here rather than casting keeps the store's declared types true — a 3-tuple
 * `localPosition` written into a `[number, number]` field is a lie the inspector
 * then renders, and `weights` has nowhere to live on the store's flat attachment.
 *
 * Returns `null` for anything that is not a plain object. The engine is a trusted
 * source, so a null here means the payload key was misread — which is exactly the
 * failure this module exists to make visible instead of silently writing an empty
 * rig over a real one.
 */
export function parseSkeletonWire2d(source: unknown): StoreSkeletonData2d | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;

  const wire = source as SkeletonSource2d;

  const bones: StoreBone2d[] = [];
  for (let i = 0; i < (wire.bones?.length ?? 0); i += 1) {
    const bone = wire.bones?.[i] ?? {};
    // The engine's 3-tuple narrows back to the 2D pair the store declares. Z is
    // round-trip fidelity for 3D rigs and has no browser-side reader.
    const [x, y] = vec(bone.localPosition, 2, 0);
    bones.push({
      name: bone.name ?? `bone_${i}`,
      parentBone: bone.parentBone ?? null,
      localPosition: [x, y],
      localRotation: finite(bone.localRotation, 0),
      localScale: vec2(bone.localScale, 1),
      length: finite(bone.length, DEFAULT_BONE_LENGTH),
      color: color4(bone.color),
    });
  }

  const slots: StoreSlot2d[] = [];
  for (let i = 0; i < (wire.slots?.length ?? 0); i += 1) {
    const slot = wire.slots?.[i] ?? {};
    slots.push({
      name: slot.name ?? `slot_${i}`,
      boneName: slot.boneName ?? '',
      spritePart: slot.spritePart ?? '',
      blendMode: wireBlendMode(slot.blendMode),
      attachment: slot.attachment ?? null,
    });
  }

  const skins: Record<string, StoreSkin2d> = {};
  for (const key of Object.keys(wire.skins ?? {})) {
    const skin = wire.skins?.[key];
    if (!skin) continue;
    const attachments: Record<string, StoreAttachment2d> = {};
    for (const slotName of Object.keys(skin.attachments ?? {})) {
      const attachment = skin.attachments?.[slotName];
      if (!attachment) continue;
      const parsed = parseAttachmentWire2d(attachment);
      if (parsed) attachments[slotName] = parsed;
    }
    skins[key] = { name: skin.name ?? key, attachments };
  }

  const ikConstraints: StoreIkConstraint2d[] = [];
  for (let i = 0; i < (wire.ikConstraints?.length ?? 0); i += 1) {
    const constraint = wire.ikConstraints?.[i] ?? {};
    ikConstraints.push({
      name: constraint.name ?? `ik_${i}`,
      boneChain: [...(constraint.boneChain ?? [])],
      targetEntityId:
        typeof constraint.targetEntityId === 'number'
          ? String(constraint.targetEntityId)
          : constraint.targetEntityId ?? '',
      bendDirection: finite(constraint.bendDirection, 1) < 0 ? -1 : 1,
      mix: Math.min(1, Math.max(0, finite(constraint.mix, 1))),
    });
  }

  return {
    bones,
    slots,
    skins,
    activeSkin: typeof wire.activeSkin === 'string' ? wire.activeSkin : 'default',
    ikConstraints,
  };
}

/**
 * The store's attachment is one flat struct; the engine's is a tagged enum. An
 * unknown tag is dropped rather than written with a `type` the store's union
 * forbids. `weights` has no store field and is deliberately not carried — the
 * outbound path rebuilds it from the mesh, and a half-kept copy would drift.
 */
function parseAttachmentWire2d(attachment: SourceAttachment2d): StoreAttachment2d | null {
  const textureId = attachment.textureId ?? '';

  if (attachment.type === 'sprite') {
    return {
      type: 'sprite',
      textureId,
      offset: vec2(attachment.offset, 0),
      rotation: finite(attachment.rotation, 0),
      scale: vec2(attachment.scale, 1),
    };
  }

  if (attachment.type === 'mesh') {
    const vertices = wireVec2List(attachment.vertices);
    return {
      type: 'mesh',
      textureId,
      vertices,
      uvs: wireVec2List(attachment.uvs),
      triangles: wireTriangles(attachment.triangles, vertices.length),
    };
  }

  return null;
}
