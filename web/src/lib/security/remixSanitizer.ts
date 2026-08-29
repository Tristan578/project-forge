/**
 * Quarantine untrusted script source when a scene crosses a user boundary.
 *
 * `/api/play/[userId]/[slug]/remix` copies a published game's
 * `projects.sceneData` verbatim into a *different* user's project. That JSON
 * carries `entities[].scriptData.source` — arbitrary TypeScript authored by the
 * publisher (`engine/src/core/scripting.rs` → `ScriptData`, serialized through
 * `scene_io.rs` → `build_scene_file`). Once the remixed project opens in the
 * editor, `scriptWorker.ts` compiles that source with `Function(...)` in the
 * remixer's browser, under the remixer's session.
 *
 * The sandbox is defence in depth, not a boundary — parameter shadowing does
 * not survive `(0).constructor.constructor('return fetch')()` (see SEC-2 in
 * CLAUDE.md, and #8700 for real containment). So the remix path must not
 * auto-run a stranger's code. It doesn't need to: `scriptWorker.ts` skips any
 * script whose `enabled` is false (`if (!s.enabled) continue;`), so flipping
 * that flag keeps the source visible and editable in the remixer's Script
 * Editor while making execution an explicit, deliberate act by the person who
 * now owns the project.
 *
 * This is a quarantine, not a scrub. The source is preserved on purpose —
 * reading and adapting the original's scripts is the point of a remix.
 */

/** A `scriptData` payload as it appears in serialized scene JSON. */
interface ScriptDataLike {
  source?: unknown;
  enabled?: unknown;
  [key: string]: unknown;
}

/**
 * Hard ceiling on how deep the walk will descend.
 *
 * `sceneData` is attacker-controlled: a publisher can store arbitrarily nested
 * JSON and every remixer of that game runs this walk. The traversal below
 * recurses, so without a cap a 100k-deep document would overflow the JS stack
 * and turn a remix into a 500. The cap — not the traversal shape — is what
 * makes that safe. Real scenes nest ~5 levels
 * (root → entities → snapshot → component → field); 64 leaves three orders of
 * magnitude of headroom.
 */
const MAX_DEPTH = 64;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The serde name of the field that carries script source in scene JSON —
 * `EntitySnapshot.script_data` under `#[serde(rename_all = "camelCase")]`
 * (`engine/src/core/history.rs`).
 */
const SCRIPT_FIELD = 'scriptData';

/**
 * Does this value look like an engine `ScriptData` payload?
 *
 * Shape check only — the caller must ALSO have found it under `SCRIPT_FIELD`.
 * A string `source` on its own is far too common to key on: `AssetMetadata`
 * entries under `assets` carry one too, and stamping `enabled: false` onto a
 * texture record would corrupt the scene. Both gates together mean a match
 * requires the engine's own field name and the engine's own shape.
 */
function isScriptData(value: unknown): value is ScriptDataLike {
  return isPlainRecord(value) && typeof value.source === 'string';
}

export interface QuarantineResult {
  /** A structurally-shared copy of the input with every script disabled. */
  sceneData: unknown;
  /** How many scripts were switched off. Zero means nothing was rewritten. */
  quarantined: number;
}

/**
 * Return a copy of `sceneData` with every `scriptData.enabled` forced to false.
 *
 * The input is never mutated — the caller's value comes straight from the
 * source project's row and must not be disturbed. Nodes that contain no script
 * are returned by reference, so the copy costs only the spine down to each
 * script rather than a full deep clone of the scene.
 *
 * Unparseable or non-object input is returned as-is with `quarantined: 0`:
 * a scene we cannot walk is a scene with no script we can find, and failing
 * the remix over it would be a worse outcome than the status quo. Anything
 * genuinely malformed fails later, in the engine's own scene loader.
 */
export function quarantineRemixedScripts(sceneData: unknown): QuarantineResult {
  let quarantined = 0;

  /**
   * Rewrite one node, returning the original reference when nothing below it
   * changed. `depth` is checked before descending, so a document deeper than
   * MAX_DEPTH keeps its tail verbatim instead of throwing — the remix still
   * succeeds, and any script down there stays exactly as deep and as
   * unreachable-by-the-editor as it already was.
   */
  function rewrite(node: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return node;

    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const rewritten = rewrite(item, depth + 1);
        if (rewritten !== item) changed = true;
        return rewritten;
      });
      return changed ? next : node;
    }

    if (!isPlainRecord(node)) return node;

    let changed = false;
    const next: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(node)) {
      if (key === SCRIPT_FIELD && isScriptData(value)) {
        // Already disabled? Leave the object alone so the count reflects what
        // this call actually neutralised, not how many scripts exist.
        if (value.enabled === false) {
          next[key] = value;
          continue;
        }
        quarantined += 1;
        changed = true;
        next[key] = { ...value, enabled: false };
        continue;
      }

      const rewritten = rewrite(value, depth + 1);
      if (rewritten !== value) changed = true;
      next[key] = rewritten;
    }

    return changed ? next : node;
  }

  return { sceneData: rewrite(sceneData, 0), quarantined };
}
