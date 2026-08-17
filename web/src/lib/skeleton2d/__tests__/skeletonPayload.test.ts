import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCreateSkeleton2dPayload,
  buildWireSkeletonData2d,
  MAX_IK_BONE_CHAIN_2D,
  type SkeletonSource2d,
} from '../skeletonPayload';

describe('buildCreateSkeleton2dPayload', () => {
  it('nests the skeleton under skeletonData', () => {
    expect(buildCreateSkeleton2dPayload('e1', {})).toEqual({
      entityId: 'e1',
      skeletonData: {
        bones: [],
        slots: [],
        skins: {},
        activeSkin: 'default',
        ikConstraints: [],
      },
    });
  });
});

describe('bones', () => {
  it('widens a 2D localPosition to the three coordinates the engine reads', () => {
    const [bone] = buildWireSkeletonData2d({
      bones: [{ name: 'root', localPosition: [12, -4] }],
    }).bones;

    // Not `[12, -4]`: `Bone2dDef::local_position` is `[f32; 3]`, and serde reports a
    // 2-element array as "invalid length 2" — refusing the entire skeleton.
    expect(bone.localPosition).toEqual([12, -4, 0]);
  });

  it('passes a 3D localPosition through unchanged', () => {
    // `rigToCommands` already produces three coordinates. The builder is the only
    // path to the engine for both producers, so it must not truncate this one.
    const [bone] = buildWireSkeletonData2d({
      bones: [{ name: 'root', localPosition: [1, 2, 3] }],
    }).bones;

    expect(bone.localPosition).toEqual([1, 2, 3]);
  });

  it('fills every field the engine requires, none of them optional', () => {
    const [bone] = buildWireSkeletonData2d({ bones: [{}] }).bones;

    // A store-shaped bone with nothing set still has to arrive complete: none of
    // `Bone2dDef`'s fields are `Option`, so one missing key is a hard reject.
    expect(bone).toEqual({
      name: 'bone_0',
      parentBone: null,
      localPosition: [0, 0, 0],
      localRotation: 0,
      localScale: [1, 1],
      length: 50,
      color: [1, 1, 1, 1],
    });
  });

  it('replaces non-finite numbers with a usable default', () => {
    const [bone] = buildWireSkeletonData2d({
      bones: [
        {
          name: 'root',
          localPosition: [Number.NaN, Number.POSITIVE_INFINITY, 0],
          localRotation: Number.NaN,
          length: Number.NEGATIVE_INFINITY,
        },
      ],
    }).bones;

    // NaN survives the JS→Rust conversion as a NaN f32 and poisons a bone transform
    // silently. Clamping leaves one visibly-wrong bone instead of a dead rig.
    expect(bone.localPosition).toEqual([0, 0, 0]);
    expect(bone.localRotation).toBe(0);
    expect(bone.length).toBe(50);
  });

  it('fills a hole rather than sending a null', () => {
    // The hole is the input under test. `.map` would skip the callback for it and
    // preserve the gap positionally; `JSON.stringify` then writes it as `null`,
    // which is not an f32 and refuses the whole skeleton.
    const holed = [1] as number[];
    holed[2] = 3;

    const [bone] = buildWireSkeletonData2d({ bones: [{ localPosition: holed }] }).bones;

    expect(Array.from(bone.localPosition)).toEqual([1, 0, 3]);
  });
});

describe('slots', () => {
  it('keeps a known blend mode and falls back for an unknown one', () => {
    const { slots } = buildWireSkeletonData2d({
      slots: [
        { name: 'body', boneName: 'root', spritePart: 'torso', blendMode: 'additive' },
        { name: 'hat', blendMode: 'dissolve' },
      ],
    });

    // `BlendMode2d` is a plain camelCase enum, so an unlisted variant name is a
    // reject rather than a dropped field.
    expect(slots).toEqual([
      { name: 'body', boneName: 'root', spritePart: 'torso', blendMode: 'additive', attachment: null },
      { name: 'hat', boneName: '', spritePart: '', blendMode: 'normal', attachment: null },
    ]);
  });
});

describe('attachments', () => {
  it('completes a sprite attachment the store left half-specified', () => {
    const { skins } = buildWireSkeletonData2d({
      skins: { default: { attachments: { body: { type: 'sprite', textureId: 'tex-1' } } } },
    });

    // `AttachmentData::Sprite` has no optional fields, but the store type marks
    // everything after `textureId` optional — so this used to refuse in full.
    expect(skins.default).toEqual({
      name: 'default',
      attachments: {
        body: { type: 'sprite', textureId: 'tex-1', offset: [0, 0], rotation: 0, scale: [1, 1] },
      },
    });
  });

  it('gives a mesh attachment the weights field the store type cannot hold', () => {
    const { skins } = buildWireSkeletonData2d({
      skins: {
        default: {
          attachments: {
            cloak: {
              type: 'mesh',
              textureId: 'tex-2',
              vertices: [[0, 0], [1, 0], [0, 1]],
              uvs: [[0, 0], [1, 0], [0, 1]],
              triangles: [0, 1, 2],
            },
          },
        },
      },
    });

    expect(skins.default.attachments.cloak).toEqual({
      type: 'mesh',
      textureId: 'tex-2',
      vertices: [[0, 0], [1, 0], [0, 1]],
      uvs: [[0, 0], [1, 0], [0, 1]],
      triangles: [0, 1, 2],
      weights: [],
    });
  });

  it('drops a triangle that names a vertex the mesh does not have', () => {
    const { skins } = buildWireSkeletonData2d({
      skins: {
        default: {
          attachments: {
            cloak: {
              type: 'mesh',
              textureId: 'tex-2',
              vertices: [[0, 0], [1, 0], [0, 1]],
              triangles: [0, 1, 2, 0, 1, 99, 1, 2],
            },
          },
        },
      },
    });

    const cloak = skins.default.attachments.cloak;
    // Index 99 reaches `Mesh::insert_indices` and costs the WebGPU device; the
    // trailing `[1, 2]` is an incomplete triangle. Both go, the valid one stays.
    expect(cloak.type === 'mesh' && cloak.triangles).toEqual([0, 1, 2]);
  });

  it('drops an attachment whose type is neither variant', () => {
    const { skins } = buildWireSkeletonData2d({
      skins: {
        default: {
          attachments: {
            body: { type: 'sprite', textureId: 'tex-1' },
            weird: { type: 'hologram', textureId: 'tex-3' },
          },
        },
      },
    });

    // An unknown tag refuses the whole skeleton, so losing one attachment is the
    // lesser failure — but the valid sibling must survive.
    expect(Object.keys(skins.default.attachments)).toEqual(['body']);
  });
});

describe('ik constraints', () => {
  it('sends a numeric target id as the string the engine field is', () => {
    const { ikConstraints } = buildWireSkeletonData2d({
      ikConstraints: [{ name: 'arm', boneChain: ['a', 'b'], targetEntityId: 7 }],
    });

    // `target_entity_id` is a Rust `String`. The store type declares `number`,
    // which serde cannot deserialize into a String at all.
    expect(ikConstraints[0].targetEntityId).toBe('7');
  });

  it('sends an absent target id as empty, never undefined', () => {
    const { ikConstraints } = buildWireSkeletonData2d({ ikConstraints: [{ name: 'arm' }] });

    expect(ikConstraints[0]).toEqual({
      name: 'arm',
      boneChain: [],
      targetEntityId: '',
      bendDirection: 1,
      mix: 1,
    });
  });

  // `parse_ik_chain2d` bounds all three of these, but it only runs for a
  // `create_ik_chain2d` command. Everything the editor and `import_skeleton_json`
  // send arrives as a whole skeleton through this builder instead, so the same
  // invariants have to hold here or a rig can carry values the engine's own
  // command path would have refused.

  it('truncates a bone chain past the engine bound rather than sending it', () => {
    const { ikConstraints } = buildWireSkeletonData2d({
      ikConstraints: [{
        name: 'arm',
        boneChain: Array.from({ length: MAX_IK_BONE_CHAIN_2D + 5 }, (_, i) => `b${i}`),
      }],
    });

    expect(ikConstraints[0].boneChain).toHaveLength(MAX_IK_BONE_CHAIN_2D);
    // Truncated from the tail, so the chain still starts at the root it was
    // authored against — dropping the head would re-parent the whole constraint.
    expect(ikConstraints[0].boneChain[0]).toBe('b0');
  });

  it('normalizes bendDirection to a sign, matching the engine', () => {
    const cases: Array<[number | undefined, number]> = [
      [-1, -1], [-2.5, -1], [0, 1], [1, 1], [4.5, 1], [undefined, 1],
    ];
    for (const [given, expected] of cases) {
      const { ikConstraints } = buildWireSkeletonData2d({
        ikConstraints: [{ name: 'arm', bendDirection: given }],
      });
      // Magnitude is not a strength dial — the solver reads only the sign, so a
      // forwarded 4.5 is indistinguishable from 1 in the engine and misleading
      // everywhere else.
      expect(ikConstraints[0].bendDirection, `bendDirection ${given}`).toBe(expected);
    }
  });

  it('clamps mix into the range the solver blends over', () => {
    const cases: Array<[number | undefined, number]> = [
      [-0.5, 0], [0, 0], [0.25, 0.25], [1, 1], [1.5, 1], [undefined, 1],
    ];
    for (const [given, expected] of cases) {
      const { ikConstraints } = buildWireSkeletonData2d({
        ikConstraints: [{ name: 'arm', mix: given }],
      });
      // 0 survives — full FK is a legal authored value, and `mix ?? 1` would
      // silently promote it to full IK.
      expect(ikConstraints[0].mix, `mix ${given}`).toBe(expected);
    }
  });
});

describe('the MCP manifest publishes the vocabulary this builder speaks', () => {
  const MANIFEST = join(
    __dirname, '..', '..', '..', '..', '..',
    'mcp-server', 'manifest', 'commands.json',
  );

  it('declares create_ik_chain2d.targetEntityId as a string', () => {
    // The manifest is what an LLM reads before composing a call. It declared this
    // field a number for as long as the command existed, documenting a value the
    // engine's `EntityId` String can never hold — so a model following the docs
    // produced a constraint the solver silently skipped.
    const raw = readFileSync(MANIFEST, 'utf8');
    const manifest = JSON.parse(raw) as {
      commands: Array<{
        name: string;
        parameters?: { properties?: Record<string, { type?: string }> };
      }>;
    };
    const command = manifest.commands.find(c => c.name === 'create_ik_chain2d');
    expect(command, `no create_ik_chain2d in ${MANIFEST}`).toBeDefined();
    expect(command!.parameters?.properties?.targetEntityId?.type).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// The wire shape above is a hand-written mirror of Rust types, and nothing else
// can catch it drifting: `cargo test` cannot see this module, and this suite
// cannot call serde. So the contract is read out of the Rust source textually.
// Fails closed — an unreadable file, a missing type, or a field it cannot parse
// is a failure, never a skip.
// ---------------------------------------------------------------------------

describe('the wire shape matches engine/src/core/skeleton2d.rs', () => {
  const RUST = join(
    __dirname, '..', '..', '..', '..', '..',
    'engine', 'src', 'core', 'skeleton2d.rs',
  );

  function source(): string {
    const text = readFileSync(RUST, 'utf8');
    expect(text.length, `empty ${RUST}`).toBeGreaterThan(0);
    return text;
  }

  it('mirrors the engine bound on an IK bone chain', () => {
    // Lives in the command module rather than the data module — it bounds what a
    // caller may send, not what the struct can hold.
    const SPRITES = join(
      __dirname, '..', '..', '..', '..', '..',
      'engine', 'src', 'core', 'commands', 'sprites.rs',
    );
    const raw = readFileSync(SPRITES, 'utf8');
    expect(raw.length, `empty ${SPRITES}`).toBeGreaterThan(0);
    // A commented-out declaration would satisfy a raw scan while the real const is
    // gone — the pin would then report agreement with a value the engine no longer
    // has. `//` is stripped per line, and the count is pinned so a second (live)
    // declaration cannot hide behind the first.
    const text = raw.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
    const pattern = /pub const MAX_IK_BONE_CHAIN_2D: usize = (\d+);/g;
    const matches = [...text.matchAll(pattern)];
    expect(matches, `expected exactly one MAX_IK_BONE_CHAIN_2D in ${SPRITES}`).toHaveLength(1);
    expect(Number(matches[0][1])).toBe(MAX_IK_BONE_CHAIN_2D);
  });

  /**
   * The body of a `pub struct`/`pub enum`, cut at the closing brace in column 0.
   * These declarations carry no string literals, so stripping `//` per line is
   * safe here in a way it would not be over arbitrary Rust.
   */
  function body(kind: 'struct' | 'enum', name: string): string {
    const text = source();
    const head = `pub ${kind} ${name} {`;
    const start = text.indexOf(head);
    expect(start, `no \`${head}\` in ${RUST}`).toBeGreaterThan(-1);
    const rest = text.slice(start + head.length);
    const end = rest.indexOf('\n}');
    expect(end, `unterminated \`${head}\` in ${RUST}`).toBeGreaterThan(-1);
    return rest
      .slice(0, end)
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n');
  }

  /** `pub field: Type,` declarations of a struct, keyed by the Rust field name. */
  function structFields(name: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const match of body('struct', name).matchAll(/^\s*pub (\w+):\s*(.+),\s*$/gm)) {
      fields[match[1]] = match[2].trim();
    }
    expect(Object.keys(fields).length, `no fields parsed from ${name}`).toBeGreaterThan(0);
    return fields;
  }

  function camel(snake: string): string {
    return snake.replace(/_([a-z])/g, (_all, c: string) => c.toUpperCase());
  }

  /** Every field name a struct declares, in the camelCase serde puts on the wire. */
  function wireKeys(name: string): string[] {
    return Object.keys(structFields(name)).map(camel).sort();
  }

  it('serializes these types in camelCase', () => {
    // Every key the builder emits assumes `rename_all = "camelCase"`. Drop that
    // attribute and `activeSkin` becomes `active_skin` — a missing field, i.e. a
    // reject, for every one of them at once.
    for (const type of ['SkeletonData2d', 'Bone2dDef', 'SlotDef', 'SkinData', 'IkConstraint2d']) {
      const decl = source().slice(0, source().indexOf(`pub struct ${type} {`));
      expect(
        decl.lastIndexOf('rename_all = "camelCase"') > decl.lastIndexOf('#[derive'),
        `${type} is not rename_all = "camelCase"`,
      ).toBe(true);
    }
  });

  it('reads localPosition as three f32 and targetEntityId as a String', () => {
    // The two defects this module exists for. Either one is a hard reject.
    expect(structFields('Bone2dDef').local_position).toBe('[f32; 3]');
    expect(structFields('IkConstraint2d').target_entity_id).toBe('String');
  });

  it('declares no Option field, so every key the builder omits is a reject', () => {
    // `parent_bone` and `attachment` are the only nullable fields, and the builder
    // sends both as an explicit `null`. Anything else turning `Option` would make an
    // omission legal — which is fine — but a NEW required field must fail this suite
    // rather than ship as a silent reject, which is what the key-set tests below do.
    const optional: string[] = [];
    for (const type of ['SkeletonData2d', 'Bone2dDef', 'SlotDef', 'SkinData', 'IkConstraint2d']) {
      for (const [field, ty] of Object.entries(structFields(type))) {
        if (ty.startsWith('Option<')) optional.push(`${type}.${field}`);
      }
    }
    expect(optional).toEqual(['Bone2dDef.parent_bone', 'SlotDef.attachment']);
  });

  it('declares exactly the keys the builder sends', () => {
    const built = buildWireSkeletonData2d({
      bones: [{ name: 'root' }],
      slots: [{ name: 'body' }],
      skins: { default: { attachments: {} } },
      ikConstraints: [{ name: 'arm' }],
    });

    expect(Object.keys(built).sort()).toEqual(wireKeys('SkeletonData2d'));
    expect(Object.keys(built.bones[0]).sort()).toEqual(wireKeys('Bone2dDef'));
    expect(Object.keys(built.slots[0]).sort()).toEqual(wireKeys('SlotDef'));
    expect(Object.keys(built.skins.default).sort()).toEqual(wireKeys('SkinData'));
    expect(Object.keys(built.ikConstraints[0]).sort()).toEqual(wireKeys('IkConstraint2d'));
  });

  it('tags AttachmentData on `type` with the variant names the builder uses', () => {
    const text = source();
    const decl = text.slice(0, text.indexOf('pub enum AttachmentData {'));
    expect(decl.lastIndexOf('tag = "type"') > decl.lastIndexOf('#[derive')).toBe(true);

    const renames = [...body('enum', 'AttachmentData').matchAll(
      /#\[serde\(rename = "(\w+)"\)\]\s*\n\s*(\w+)\s*\{/g,
    )].map(m => m[1]);
    // Internally tagged: an unknown tag value is "unknown variant", a reject of the
    // whole skeleton — so these two strings are the entire accepted vocabulary.
    expect(renames.sort()).toEqual(['mesh', 'sprite']);
  });

  it('declares exactly the keys the builder sends for each attachment variant', () => {
    const enumBody = body('enum', 'AttachmentData');
    const heads = [...enumBody.matchAll(/^ {4}(\w+)\s*\{$/gm)];
    expect(heads.length, 'no AttachmentData variants parsed').toBe(2);

    const variantKeys: Record<string, string[]> = {};
    heads.forEach((head, i) => {
      const from = head.index! + head[0].length;
      const to = i + 1 < heads.length ? heads[i + 1]!.index! : enumBody.length;
      const fields = [...enumBody.slice(from, to).matchAll(/^\s*(\w+):\s*(.+),\s*$/gm)]
        .map(m => camel(m[1]));
      expect(fields.length, `no fields parsed from variant ${head[1]}`).toBeGreaterThan(0);
      variantKeys[head[1]] = fields.sort();
    });

    const mesh: SkeletonSource2d = {
      skins: { s: { attachments: { a: { type: 'mesh', textureId: 't' } } } },
    };
    const sprite: SkeletonSource2d = {
      skins: { s: { attachments: { a: { type: 'sprite', textureId: 't' } } } },
    };

    // `type` is the tag, added by serde rather than declared as a field.
    const sent = (data: SkeletonSource2d) =>
      Object.keys(buildWireSkeletonData2d(data).skins.s.attachments.a)
        .filter(key => key !== 'type')
        .sort();

    expect(sent(sprite)).toEqual(variantKeys.Sprite);
    expect(sent(mesh)).toEqual(variantKeys.Mesh);
  });

  it('reads triangle indices as u16, which is what bounds them', () => {
    const enumBody = body('enum', 'AttachmentData');
    // The builder refuses an index past `u16::MAX` for this reason. Widen the Rust
    // type and that bound becomes an unnecessary silent truncation.
    expect(/triangles:\s*Vec<u16>,/.test(enumBody)).toBe(true);
  });
});
