/**
 * The set of engine commands a user script is permitted to dispatch.
 *
 * This module exists so there is exactly ONE copy of the allowlist. It used to
 * live inside `useScriptRunner.ts` and be hand-copied into
 * `__tests__/scriptSandbox.test.ts` and `__tests__/scriptSecurity.test.ts`,
 * which made every allow/deny assertion in those suites tautological: they
 * asserted a literal against itself and could not notice the shipped allowlist
 * changing underneath them. Both copies had in fact drifted, missing the three
 * `audio_*_snapshot` / `audio_detect_loop_points` names.
 *
 * Deliberately dependency-free — no `@/stores`, no `@/hooks`, no React. The
 * security suites import it, and so will the parity pin PF-1180 (#9284) adds;
 * none of them may drag the editor store into their graph.
 *
 * NOTHING CHECKS THIS LIST AGAINST THE ENGINE TODAY. That pin is PF-1180's
 * scope and PF-1180 is open, so what follows is a measurement, not a guarantee:
 *
 * - 36 names are reachable — `fn route_domain` names them AND the domain's
 *   `pub fn dispatch` has a non-stub arm for them. Both halves are required
 *   (see `stores/slices/__tests__/commandArmParity.test.ts`).
 * - 10 are `audioManager` names that never reach the engine by design;
 *   `useScriptRunner` answers them JS-side before dispatch. Marked JS-SIDE.
 * - 16 are PHANTOM: `route_domain` does not name them and no domain module
 *   arms them, and `useScriptRunner` has no case for them either.
 *   A script calling one gets no error and no effect, because `dispatchCommand`
 *   returns void. They are marked PHANTOM inline rather than re-listed here, so
 *   the note sits where a reader looking a name up will find it — and so this
 *   docstring is not a second copy to rot. Fixing the names (deleting them, or
 *   arming them in the engine) is PF-1180's job, not this list's.
 *
 * `set_tile` / `clear_tiles` / `resize_tilemap` were three more phantoms and are
 * gone; none of the three had ever been an engine command (PF-1181).
 */
export const SCRIPT_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // Transform / entity lifecycle
  'update_transform', 'spawn_entity', 'delete_entities',
  'set_visibility', 'update_material',
  // 3D physics — 'set_velocity' is PHANTOM
  'apply_force', 'set_velocity', 'apply_impulse',
  // 2D physics — 'set_velocity2d' and 'set_angular_velocity2d' are PHANTOM
  'apply_force2d', 'apply_impulse2d', 'set_velocity2d',
  'set_angular_velocity2d', 'set_gravity2d',
  // Audio (routed to WASM)
  'play_audio', 'stop_audio', 'pause_audio', 'set_audio', 'update_audio_bus',
  // Audio layering — JS-SIDE: `useScriptRunner` routes these to `audioManager`
  // and never dispatches them.
  'audio_add_layer', 'audio_remove_layer', 'audio_remove_all_layers',
  'audio_crossfade', 'audio_play_one_shot', 'audio_fade_in', 'audio_fade_out',
  // PHANTOM: these two look like the layering names above but have neither an
  // `audioManager` case nor an engine arm.
  'set_music_intensity', 'set_music_stems',
  // 3D animation
  'play_animation', 'pause_animation', 'resume_animation', 'stop_animation',
  'set_animation_speed', 'set_animation_loop',
  'set_animation_blend_weight', 'set_clip_speed',
  // Sprite animation — all four PHANTOM
  'play_sprite_animation', 'stop_sprite_animation',
  'set_sprite_anim_speed', 'set_sprite_anim_param',
  // Particles
  'set_particle_preset', 'toggle_particle', 'burst_particle',
  // Camera — all four PHANTOM. The camera controls a script really has are the
  // `camera_*` worker messages `useScriptRunner` handles, not these commands.
  'camera_follow', 'camera_stop_follow', 'camera_set_position', 'camera_look_at',
  // Tilemap — the engine's own names. `set_tile`/`clear_tiles`/`resize_tilemap`
  // used to sit here and none of the three has ever been an engine command
  // (PF-1181).
  'paint_tile', 'erase_tile', 'fill_tiles',
  // Skeletal 2D
  'create_skeleton2d', 'add_bone2d', 'remove_bone2d', 'update_bone2d',
  // 'stop_skeletal_animation2d' and 'set_ik_target2d' are PHANTOM
  'set_skeleton2d_skin', 'play_skeletal_animation2d', 'stop_skeletal_animation2d',
  'set_ik_target2d',
  // Input — PHANTOM
  'vibrate',
  // Audio snapshots & loop detection — JS-SIDE via `audioManager`
  'audio_save_snapshot', 'audio_load_snapshot', 'audio_detect_loop_points',
  // Scene control
  'stop',
]);

/** True when `name` is a command a user script may dispatch. */
export function isScriptAllowedCommand(name: string): boolean {
  return SCRIPT_ALLOWED_COMMANDS.has(name);
}
