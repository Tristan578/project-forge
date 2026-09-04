/**
 * The commands the server gates behind an explicit user approval (PF-8860).
 *
 * This is the CLIENT-side half of the gate and it is security-load-bearing.
 * The AI SDK still emits a gated call's `tool-input-available` chunk before it
 * emits the `tool-approval-request`, so a stream that is truncated between the
 * two hands the browser a complete, executable destructive call with no
 * approval attached. `chatStore.drainBufferedToolInputs()` refuses to execute
 * any name in this set that arrives without an approvalId.
 *
 * Declared rather than derived from `@/data/commands.json`, following the
 * `lib/mcp/manifestStats.ts` convention: the manifest is 333 KB and this list
 * is consumed by the chat store, which is in the editor's main bundle.
 * `__tests__/destructiveCommands.test.ts` asserts the set against the manifest
 * both ways, so a command flagged `destructive` without being added here fails
 * a test rather than silently becoming ungatable on the client.
 *
 * The manifest is the source of truth; `mcp-server/src/manifest.test.ts` owns
 * the criterion and the naming rule that decides what belongs in it.
 */
export const DESTRUCTIVE_COMMANDS: ReadonlySet<string> = new Set([
  'clear_tiles',
  'clear_world',
  'create_scene_from_description',
  'delete_asset',
  'delete_audio_bus',
  'delete_cutscene',
  'delete_entities',
  'delete_leaderboard',
  'delete_library_material',
  'delete_library_script',
  'delete_prefab',
  'delete_scene',
  'delete_ui_screen',
  'despawn_entity',
  'load_scene',
  'load_scene_with_transition',
  'load_template',
  'new_scene',
  'publish_game',
  'remove_animation_clip',
  'remove_dialogue_tree',
  'remove_script',
  'remove_tilemap_layer',
  'remove_ui_widget',
  'resize_tilemap',
  'set_script',
  'setup_game_from_description',
  'start_from_idea',
  'switch_scene',
  'update_library_script',
]);

/** Whether a tool name is gated server-side and must never run unapproved. */
export function isDestructiveCommand(name: string): boolean {
  return DESTRUCTIVE_COMMANDS.has(name);
}
