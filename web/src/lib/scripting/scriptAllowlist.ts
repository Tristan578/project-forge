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
 * PF-1180 parity pin (which checks every name here against the engine's
 * `route_domain` table and its domain `dispatch` arms) imports this module, and
 * so do the security suites; none of them may drag the editor store into their
 * graph.
 *
 * Every name here must be an engine command that `commands::dispatch` really
 * arms, EXCEPT where noted inline (the audio-layering names are handled JS-side
 * by `audioManager`). `set_tile` / `clear_tiles` / `resize_tilemap` used to sit
 * in this list and none of the three has ever been an engine command — the
 * dispatcher returns void, so those calls vanished in silence (PF-1181).
 */
export const SCRIPT_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  // Transform / entity lifecycle
  'update_transform', 'spawn_entity', 'delete_entities',
  'set_visibility', 'update_material',
  // 3D physics
  'apply_force', 'set_velocity', 'apply_impulse',
  // 2D physics
  'apply_force2d', 'apply_impulse2d', 'set_velocity2d',
  'set_angular_velocity2d', 'set_gravity2d',
  // Audio (routed to WASM)
  'play_audio', 'stop_audio', 'pause_audio', 'set_audio', 'update_audio_bus',
  // Audio layering (handled JS-side via audioManager but listed for completeness)
  'audio_add_layer', 'audio_remove_layer', 'audio_remove_all_layers',
  'audio_crossfade', 'audio_play_one_shot', 'audio_fade_in', 'audio_fade_out',
  'set_music_intensity', 'set_music_stems',
  // 3D animation
  'play_animation', 'pause_animation', 'resume_animation', 'stop_animation',
  'set_animation_speed', 'set_animation_loop',
  'set_animation_blend_weight', 'set_clip_speed',
  // Sprite animation
  'play_sprite_animation', 'stop_sprite_animation',
  'set_sprite_anim_speed', 'set_sprite_anim_param',
  // Particles
  'set_particle_preset', 'toggle_particle', 'burst_particle',
  // Camera
  'camera_follow', 'camera_stop_follow', 'camera_set_position', 'camera_look_at',
  // Tilemap — the engine's own names. `set_tile`/`clear_tiles`/`resize_tilemap`
  // used to sit here and none of the three has ever been an engine command
  // (PF-1181).
  'paint_tile', 'erase_tile', 'fill_tiles',
  // Skeletal 2D
  'create_skeleton2d', 'add_bone2d', 'remove_bone2d', 'update_bone2d',
  'set_skeleton2d_skin', 'play_skeletal_animation2d', 'stop_skeletal_animation2d',
  'set_ik_target2d',
  // Input
  'vibrate',
  // Audio snapshots & loop detection
  'audio_save_snapshot', 'audio_load_snapshot', 'audio_detect_loop_points',
  // Scene control
  'stop',
]);

/** True when `name` is a command a user script may dispatch. */
export function isScriptAllowedCommand(name: string): boolean {
  return SCRIPT_ALLOWED_COMMANDS.has(name);
}
