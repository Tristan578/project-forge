/**
 * Plain-language descriptions of the actions behind a tool call (PF-8860).
 *
 * The server-side approval card used to present nothing but
 * `JSON.stringify(input)`, so the decision a user was being asked to make read
 * as `{"entityIds":["4f3a-…","9c21-…"]}`. Approving what you cannot read is
 * not approval, and entity ids are the one part of an input a user has no way
 * to interpret — the editor only ever shows them names.
 *
 * `lookupEntityName` is injected rather than imported so this stays a pure
 * function: the card passes a reader over `editorStore.sceneGraph.nodes`, and
 * the tests pass a fixture. An id the scene graph does not know (already
 * despawned, or a hallucinated id) falls back to a shortened id rather than
 * pretending to a name — an unresolvable id is itself information.
 *
 * Parameter names below are taken from `@/data/commands.json`, not guessed;
 * `__tests__/approvalSummary.test.ts` asserts every destructive command in the
 * manifest gets a non-empty description, so a new one cannot ship with a blank
 * card.
 */

/** Resolve an entity id to its display name, or undefined if unknown. */
export type EntityNameLookup = (entityId: string) => string | undefined;

const MAX_LISTED_ENTITIES = 4;

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function entityLabel(value: unknown, lookup: EntityNameLookup): string {
  if (typeof value !== 'string' || value.length === 0) return 'an entity';
  const name = lookup(value);
  return name ? `"${name}"` : `entity ${shortId(value)}`;
}

function entityListLabel(value: unknown, lookup: EntityNameLookup): string {
  if (!Array.isArray(value) || value.length === 0) return 'no entities';
  const labels = value.slice(0, MAX_LISTED_ENTITIES).map((id) => entityLabel(id, lookup));
  const rest = value.length - labels.length;
  const joined = labels.join(', ');
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

function quoted(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? `"${value}"` : fallback;
}

/**
 * One sentence saying what this call will do, in the user's vocabulary.
 *
 * Returns `''` for a command with no specific phrasing — callers fall back to
 * the tool label plus the raw arguments, which is what every non-destructive
 * card already shows.
 */
export function describeToolAction(
  name: string,
  input: Record<string, unknown>,
  lookup: EntityNameLookup,
): string {
  switch (name) {
    // --- deletes entities -------------------------------------------------
    case 'despawn_entity':
      return `Delete ${entityLabel(input.entityId, lookup)} from the scene`;
    case 'delete_entities': {
      const ids = Array.isArray(input.entityIds) ? input.entityIds : [];
      return `Delete ${ids.length} ${ids.length === 1 ? 'entity' : 'entities'} from the scene: ${entityListLabel(ids, lookup)}`;
    }

    // --- replaces the whole scene ----------------------------------------
    case 'new_scene':
      return 'Discard the current scene and start an empty one';
    case 'clear_world':
      return 'Delete every entity in the current world';
    case 'load_scene':
      return 'Replace the current scene with the contents of a scene file';
    case 'switch_scene':
      return `Leave the current scene and open ${quoted(input.sceneId, 'another scene')}`;
    case 'load_scene_with_transition':
      return `Leave the current scene and open ${quoted(input.sceneName, 'another scene')}`;
    case 'load_template':
      return `Replace the current scene with the ${quoted(input.templateId, 'chosen')} template`;
    case 'create_scene_from_description':
      return input.clearExisting === true
        ? 'Delete everything in the scene and build a new one from a description'
        : 'Build a scene from a description';
    case 'setup_game_from_description':
      return 'Replace the current project setup with a game built from a description';
    case 'start_from_idea':
      return `Replace the current scene with a new game scaffolded from ${quoted(input.title, 'an idea')}`;

    // --- overwrites authored source --------------------------------------
    case 'set_script':
      return `Overwrite the script on ${entityLabel(input.entityId, lookup)}`;
    case 'remove_script':
      return `Delete the script attached to ${entityLabel(input.entityId, lookup)}`;
    case 'update_library_script':
      return `Overwrite the library script ${quoted(input.scriptId, '')}`.trim();
    case 'delete_library_script':
      return `Delete the library script ${quoted(input.scriptId, '')}`.trim();
    case 'delete_library_material':
      return `Delete the saved material ${quoted(input.materialId, '')}`.trim();
    case 'remove_animation_clip':
      return `Delete an animation clip from ${entityLabel(input.entityId, lookup)}`;
    case 'remove_dialogue_tree':
      return `Delete the dialogue tree ${quoted(input.treeId, '')}`.trim();
    case 'delete_cutscene':
      return `Delete the cutscene ${quoted(input.cutsceneId, '')}`.trim();
    case 'delete_prefab':
      return `Delete the prefab ${quoted(input.prefabId, '')}`.trim();
    case 'delete_scene':
      return `Delete the scene ${quoted(input.sceneId, '')} and everything in it`.trim();
    case 'delete_asset':
      return `Permanently delete the asset ${quoted(input.assetId, '')}`.trim();
    case 'delete_audio_bus':
      return `Delete the audio bus ${quoted(input.busName, '')}`.trim();
    case 'delete_ui_screen':
      return `Delete the UI screen ${quoted(input.screenId, '')} and its widgets`.trim();
    case 'remove_ui_widget':
      return `Delete the widget ${quoted(input.widgetId, '')} from ${quoted(input.screenId, 'a screen')}`;

    // --- tilemaps ---------------------------------------------------------
    case 'clear_tiles':
      return `Erase painted tiles on layer ${String(input.layerIndex ?? '?')} of ${entityLabel(input.entityId, lookup)}`;
    case 'remove_tilemap_layer':
      return `Delete layer ${String(input.layerIndex ?? '?')} and its tiles from ${entityLabel(input.entityId, lookup)}`;
    case 'resize_tilemap':
      return `Resize ${entityLabel(input.entityId, lookup)} to ${String(input.width ?? '?')}x${String(input.height ?? '?')}, discarding tiles outside the new bounds`;

    // --- outside the editor session --------------------------------------
    case 'publish_game':
      return `Publish this game publicly as ${quoted(input.title, 'an untitled game')}`;
    case 'delete_leaderboard':
      return `Delete the leaderboard ${quoted(input.name, '')} and every score on it`.trim();

    default:
      return '';
  }
}
