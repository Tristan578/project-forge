//! Runtime-build drain parity (#9550).
//!
//! `core::commands::*::dispatch` accepts a command and pushes a request onto a
//! `PendingCommands` queue with NO knowledge of Cargo features. The system that
//! drains that queue lives in `bridge/`, and a large share of those systems
//! are `#[cfg(not(feature = "runtime"))]` — defined only in the editor build,
//! registered only inside the editor-only block of `SelectionPlugin::build`.
//! So in a `runtime` build (the binary an exported game embeds) the command is
//! validated, queued, answered `Ok`, and never drained: the `Vec` grows by one
//! entry per call for the life of the process, and the command does nothing.
//! `forge.physics2d.setGravity` called once per frame is the concrete case the
//! ticket found; it is not the only one.
//!
//! No CI job can see this. `cargo test --lib` never compiles `bridge/` (it is
//! `#[cfg(target_arch = "wasm32")]`), and the wasm32 `cargo check` type-checks
//! both feature sets without ever running a system. So this module reads the
//! sources textually, from `core/`, and asserts the property directly:
//!
//! * every `PendingCommands` queue has a drain whose definition AND
//!   registration are reachable in a runtime build, OR is named in
//!   [`RUNTIME_UNDRAINED`] with a reason — a ratchet checked in both
//!   directions, so it cannot rot into a blanket exemption;
//! * the queues #9550 fixed are asserted by name, so the waiver list can
//!   never quietly absorb them again;
//! * the same reachability model is exported for `query.rs`'s deferred-variant
//!   test, which was cfg-blind and reported the joint reads as answered in a
//!   build that could not answer them.
//!
//! Every extraction stage carries a floor, so a scanner that matches nothing
//! fails instead of passing vacuously (lesson #9).

#[cfg(test)]
pub(super) mod scan {
    /// The attribute that makes an item editor-only.
    pub const EDITOR_ONLY: &str = "#[cfg(not(feature = \"runtime\"))]";

    /// Where drains are written: every bridge system file, plus the `core/`
    /// files that drain a queue themselves (their systems are registered by
    /// `bridge/mod.rs` or by a plugin in the same file).
    pub const DRAIN_SOURCES: &[(&str, &str)] = &[
        ("bridge/animation.rs", include_str!("../../bridge/animation.rs")),
        ("bridge/audio.rs", include_str!("../../bridge/audio.rs")),
        ("bridge/core_systems.rs", include_str!("../../bridge/core_systems.rs")),
        ("bridge/edit_mode.rs", include_str!("../../bridge/edit_mode.rs")),
        ("bridge/game.rs", include_str!("../../bridge/game.rs")),
        ("bridge/material.rs", include_str!("../../bridge/material.rs")),
        ("bridge/mesh_ops.rs", include_str!("../../bridge/mesh_ops.rs")),
        ("bridge/particles.rs", include_str!("../../bridge/particles.rs")),
        ("bridge/performance.rs", include_str!("../../bridge/performance.rs")),
        ("bridge/physics.rs", include_str!("../../bridge/physics.rs")),
        ("bridge/procedural.rs", include_str!("../../bridge/procedural.rs")),
        ("bridge/query.rs", include_str!("../../bridge/query.rs")),
        ("bridge/scene_io.rs", include_str!("../../bridge/scene_io.rs")),
        ("bridge/scripts.rs", include_str!("../../bridge/scripts.rs")),
        ("bridge/skeleton2d.rs", include_str!("../../bridge/skeleton2d.rs")),
        ("bridge/sprite.rs", include_str!("../../bridge/sprite.rs")),
        ("core/camera.rs", include_str!("../camera.rs")),
        ("core/camera_presets.rs", include_str!("../camera_presets.rs")),
        ("core/entity_factory.rs", include_str!("../entity_factory.rs")),
        ("core/game_camera.rs", include_str!("../game_camera.rs")),
        ("core/reparent.rs", include_str!("../reparent.rs")),
    ];

    /// Where systems are registered. `bridge/mod.rs` carries almost all of
    /// them; the rest are plugins in `core/` that `bridge/mod.rs` adds.
    pub const REGISTRATION_SOURCES: &[(&str, &str)] = &[
        ("bridge/mod.rs", include_str!("../../bridge/mod.rs")),
        ("core/camera.rs", include_str!("../camera.rs")),
        ("core/game_camera.rs", include_str!("../game_camera.rs")),
        ("core/gizmo.rs", include_str!("../gizmo.rs")),
        ("core/snap.rs", include_str!("../snap.rs")),
        ("core/physics.rs", include_str!("../physics.rs")),
        ("core/physics_2d_sim.rs", include_str!("../physics_2d_sim.rs")),
    ];

    pub const BRIDGE_MOD: &str = include_str!("../../bridge/mod.rs");
    pub const PENDING_MOD: &str = include_str!("mod.rs");

    /// A function definition in one of the drain sources.
    #[derive(Debug, Clone)]
    pub struct Func {
        pub file: &'static str,
        pub name: String,
        /// Its own definition carries `EDITOR_ONLY`.
        pub gated_def: bool,
        /// Text from the signature to the next function (approximate body).
        pub body: String,
        /// The same span taken from `runtime_view`, so an inner block gated by
        /// `EDITOR_ONLY` reads as blank. A drain inside such a block is NOT a
        /// runtime drain, and `body` alone cannot tell the two apart.
        pub runtime_body: String,
    }

    /// The source with everything from its first `#[cfg(test)]` on removed.
    /// Test modules register systems into ad-hoc schedules, which must not
    /// count as a registration.
    pub fn without_tests(source: &str) -> &str {
        // Line-anchored on purpose: `bridge/mod.rs` and `entity_factory.rs`
        // both MENTION `#[cfg(test)]` inside a doc comment long before their
        // test module, and a substring cut there discarded the editor-only
        // block and every drain that followed it.
        let mut offset = 0usize;
        for line in source.split_inclusive('\n') {
            if line.trim() == "#[cfg(test)]" {
                return &source[..offset];
            }
            offset += line.len();
        }
        source
    }

    fn is_ident_byte(b: u8) -> bool {
        b.is_ascii_alphanumeric() || b == b'_'
    }

    /// `fn NAME` at the start of a line (after optional visibility), or None.
    fn fn_name(line: &str) -> Option<String> {
        let t = line.trim_start();
        let rest = if let Some(r) = t.strip_prefix("pub(super) ") {
            r
        } else if let Some(r) = t.strip_prefix("pub(crate) ") {
            r
        } else if let Some(r) = t.strip_prefix("pub ") {
            r
        } else {
            t
        };
        let rest = rest.strip_prefix("fn ")?;
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() {
            return None;
        }
        let after = &rest[name.len()..];
        if after.starts_with('(') || after.starts_with('<') {
            Some(name)
        } else {
            None
        }
    }

    /// Every function in `source`, with whether its definition is gated. The
    /// gate is found by walking back over the attribute and comment lines
    /// directly above the signature.
    pub fn functions(file: &'static str, source: &str) -> Vec<Func> {
        let source = without_tests(source);
        let lines: Vec<&str> = source.lines().collect();
        // `runtime_view` blanks bytes in place and never touches a newline, and
        // `without_tests` is idempotent (it returns a prefix slice), so this
        // view has exactly the same line indices as `lines` above.
        let blanked = runtime_view(source);
        let blanked_lines: Vec<&str> = blanked.lines().collect();
        debug_assert_eq!(lines.len(), blanked_lines.len());
        let mut starts: Vec<(usize, String)> = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            if let Some(name) = fn_name(line) {
                starts.push((i, name));
            }
        }
        let mut out = Vec::new();
        for (k, (i, name)) in starts.iter().enumerate() {
            let mut gated = false;
            let mut j = *i;
            while j > 0 {
                j -= 1;
                let t = lines[j].trim();
                if t.is_empty() || t.starts_with("///") || t.starts_with("//") {
                    continue;
                }
                if t.starts_with("#[") {
                    if t == EDITOR_ONLY {
                        gated = true;
                    }
                    continue;
                }
                break;
            }
            let end = starts.get(k + 1).map(|(n, _)| *n).unwrap_or(lines.len());
            out.push(Func {
                file,
                name: name.clone(),
                gated_def: gated,
                body: lines[*i..end].join("\n"),
                runtime_body: blanked_lines[*i..end].join("\n"),
            });
        }
        out
    }

    /// Byte ranges of `source` that only exist in an editor build: an
    /// `EDITOR_ONLY` attribute followed by a `{ ... }` block covers the block;
    /// followed by anything else it covers the next item or statement.
    pub fn editor_only_ranges(source: &str) -> Vec<(usize, usize)> {
        let bytes = source.as_bytes();
        let mut ranges = Vec::new();
        for (idx, _) in source.match_indices(EDITOR_ONLY) {
            let mut pos = idx + EDITOR_ONLY.len();
            // Skip to the item this attribute gates: blank space, line/doc
            // comments, and any FURTHER attributes stacked on the same item
            // (`#[allow(dead_code)]` under an `EDITOR_ONLY` is routine). Without
            // the last of those, the head below matches no item keyword, the
            // statement branch hunts for a depth-0 `;` that a function body
            // never has, and the scan panics on perfectly ordinary source.
            loop {
                while pos < bytes.len() && (bytes[pos] as char).is_whitespace() {
                    pos += 1;
                }
                if pos >= bytes.len() {
                    break;
                }
                let ahead = &source[pos..];
                if ahead.starts_with("//") {
                    pos += ahead.find('\n').map_or(ahead.len(), |n| n + 1);
                    continue;
                }
                if ahead.starts_with("#[") || ahead.starts_with("#![") {
                    pos = matching_bracket(bytes, pos + ahead.find('[').unwrap());
                    continue;
                }
                break;
            }
            if pos >= bytes.len() {
                break;
            }
            // Whichever comes first OUTSIDE any `(..)`/`[..]` decides the shape:
            // a `{` opens a body (`fn`, `impl`, `mod x { .. }`, a bare block), a
            // `;` ends a declaration or statement (`mod x;`, `use ..;`,
            // `app.add_systems(..);`, `struct Foo;`). Deciding on the leading
            // keyword instead is what broke here: a signature such as
            // `fn f(v: &[[f32; 2]]) -> T {` carries a `;` before its `{`, so the
            // keyword branch handed a whole function to the statement scanner,
            // which then found no depth-0 `;` and panicked on valid source.
            let mut depth = 0i32;
            let mut end = None;
            for (off, b) in bytes[pos..].iter().enumerate() {
                match b {
                    b'(' | b'[' => depth += 1,
                    b')' | b']' => depth -= 1,
                    b'{' if depth == 0 => {
                        end = Some(matching_brace(bytes, pos + off));
                        break;
                    }
                    b';' if depth == 0 => {
                        end = Some(pos + off + 1);
                        break;
                    }
                    _ => {}
                }
            }
            let end = end
                .unwrap_or_else(|| panic!("unterminated item after {EDITOR_ONLY} at byte {idx}"));
            ranges.push((idx, end));
        }
        ranges
    }

    fn matching_brace(bytes: &[u8], open: usize) -> usize {
        let mut depth = 0i32;
        for (off, b) in bytes[open..].iter().enumerate() {
            match b {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return open + off + 1;
                    }
                }
                _ => {}
            }
        }
        panic!("unbalanced braces after byte {open}");
    }

    /// Byte just past the `]` closing the `[` at `open`.
    fn matching_bracket(bytes: &[u8], open: usize) -> usize {
        let mut depth = 0i32;
        for (off, b) in bytes[open..].iter().enumerate() {
            match b {
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return open + off + 1;
                    }
                }
                _ => {}
            }
        }
        panic!("unbalanced brackets after byte {open}");
    }

    /// `source` with every editor-only range blanked, so a text search over it
    /// sees only what a runtime build compiles.
    pub fn runtime_view(source: &str) -> String {
        let source = without_tests(source);
        let mut out = source.as_bytes().to_vec();
        for (a, b) in editor_only_ranges(source) {
            for byte in &mut out[a..b] {
                if *byte != b'\n' {
                    *byte = b' ';
                }
            }
        }
        String::from_utf8(out).expect("blanking ascii bytes keeps the source utf-8")
    }

    /// Bridge modules declared behind `EDITOR_ONLY` in `bridge/mod.rs` — every
    /// item in such a file is editor-only whatever its own attributes say.
    pub fn gated_modules() -> Vec<String> {
        let mut out = Vec::new();
        for (idx, _) in BRIDGE_MOD.match_indices(EDITOR_ONLY) {
            let rest = BRIDGE_MOD[idx + EDITOR_ONLY.len()..].trim_start();
            if let Some(m) = rest.strip_prefix("mod ") {
                let name: String = m.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
                out.push(name);
            }
        }
        out
    }

    /// True when `name` appears, as a whole identifier, inside the argument
    /// list of an `add_systems(` call that a runtime build compiles.
    pub fn registered_in_runtime(name: &str) -> bool {
        for (_, source) in REGISTRATION_SOURCES {
            let view = runtime_view(source);
            let bytes = view.as_bytes();
            for (idx, _) in view.match_indices("add_systems(") {
                let open = idx + "add_systems(".len() - 1;
                let end = {
                    let mut depth = 0i32;
                    let mut end = None;
                    for (off, b) in bytes[open..].iter().enumerate() {
                        match b {
                            b'(' => depth += 1,
                            b')' => {
                                depth -= 1;
                                if depth == 0 {
                                    end = Some(open + off + 1);
                                    break;
                                }
                            }
                            _ => {}
                        }
                    }
                    end.unwrap_or_else(|| panic!("unbalanced add_systems( at byte {idx}"))
                };
                if mentions_ident(&view[open..end], name) {
                    return true;
                }
            }
        }
        false
    }

    /// Whole-identifier containment.
    pub fn mentions_ident(haystack: &str, name: &str) -> bool {
        let hb = haystack.as_bytes();
        for (idx, _) in haystack.match_indices(name) {
            let before_ok = idx == 0 || !is_ident_byte(hb[idx - 1]);
            let after = idx + name.len();
            let after_ok = after >= hb.len() || !is_ident_byte(hb[after]);
            if before_ok && after_ok {
                return true;
            }
        }
        false
    }

    /// A function that a runtime build both compiles and schedules.
    pub fn runtime_reachable(f: &Func, gated_modules: &[String]) -> bool {
        if f.gated_def {
            return false;
        }
        let module = f
            .file
            .rsplit('/')
            .next()
            .and_then(|s| s.strip_suffix(".rs"))
            .unwrap_or("");
        if f.file.starts_with("bridge/") && gated_modules.iter().any(|m| m == module) {
            return false;
        }
        registered_in_runtime(&f.name)
    }

    /// The `PendingCommands` queue fields drained inside `body`.
    pub fn drained_fields(body: &str) -> Vec<String> {
        let mut out = Vec::new();
        for prefix in ["pending.", "&mut pending."] {
            for (idx, _) in body.match_indices(prefix) {
                let rest = &body[idx + prefix.len()..];
                let field: String = rest
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect();
                if field.is_empty() {
                    continue;
                }
                let after = &rest[field.len()..];
                let drains = after.starts_with(".drain(")
                    || after.starts_with(".clear(")
                    || after.starts_with(".take(")
                    || (prefix == "&mut pending." && body[..idx].ends_with("mem::take("));
                if drains && !out.contains(&field) {
                    out.push(field);
                }
            }
        }
        out
    }

    /// Every field of `PendingCommands`, in declaration order.
    pub fn pending_fields() -> Vec<String> {
        let start = PENDING_MOD
            .find("pub struct PendingCommands {")
            .expect("PendingCommands struct not found");
        let body = &PENDING_MOD[start..];
        let end = body.find("\n}").expect("PendingCommands struct end not found");
        let mut out = Vec::new();
        for line in body[..end].lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("pub ") {
                if let Some(colon) = rest.find(':') {
                    out.push(rest[..colon].trim().to_string());
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::scan::*;

    /// Queues a runtime build fills and never drains, each with the reason it
    /// is tolerated for now. Checked in BOTH directions below: an entry that
    /// gains a runtime drain fails ("remove it"), and an undrained queue
    /// missing from the list fails ("drain it or waive it"). Reasons fall into
    /// three classes:
    ///
    /// * `editor-authoring` — the command has no meaning in an exported game
    ///   (selection, gizmos, scene export, CSG, shader authoring, …). A leak
    ///   needs a caller, and nothing in an exported game issues these.
    /// * `runtime-gated dispatch` — `core/commands/performance.rs` answers the
    ///   command differently under `feature = "runtime"` and queues nothing.
    /// * `SCRIPT-REACHABLE` — an allowlisted `forge.*` call reaches this queue
    ///   from an exported game's script and is silently dropped there. These
    ///   are the live defects of #9550's class that this PR does not fix;
    ///   the follow-up ticket is named on each so the reason cannot go stale
    ///   without someone noticing.
    const RUNTIME_UNDRAINED: &[(&str, &str)] = &[
        ("transform_updates", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.transform.setPosition/Rotation/Scale -> update_transform"),
        ("rename_requests", "editor-authoring: rename_entity"),
        ("duplicate_requests", "editor-authoring: duplicate_entity"),
        ("reparent_requests", "editor-authoring: reparent_entity"),
        ("snap_settings_updates", "editor-authoring: set_snap_settings"),
        ("grid_toggles", "editor-authoring: toggle_grid"),
        ("coordinate_mode_update", "editor-authoring: set_coordinate_mode (gizmo)"),
        ("selection_requests", "editor-authoring: select_entity/select_entities"),
        ("visibility_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.entity.setVisible -> set_visibility"),
        ("clear_selection_requests", "editor-authoring: clear_selection"),
        ("gizmo_mode_requests", "editor-authoring: set_gizmo_mode"),
        ("material_updates", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.material.* -> update_material"),
        ("light_updates", "editor-authoring: update_light"),
        ("ambient_light_updates", "editor-authoring: set_ambient_light"),
        ("environment_updates", "editor-authoring: set_environment"),
        ("post_processing_updates", "editor-authoring: set_post_processing"),
        ("shader_updates", "editor-authoring: set_shader"),
        ("shader_removals", "editor-authoring: remove_shader"),
        ("set_skybox_requests", "editor-authoring: set_skybox"),
        ("remove_skybox_requests", "editor-authoring: remove_skybox"),
        ("update_skybox_requests", "editor-authoring: update_skybox"),
        ("custom_skybox_requests", "editor-authoring: set_custom_skybox"),
        ("custom_wgsl_source_updates", "editor-authoring: set_custom_wgsl_source"),
        ("register_custom_shader_requests", "editor-authoring: register_custom_shader"),
        ("apply_custom_shader_requests", "editor-authoring: apply_custom_shader"),
        ("remove_custom_shader_requests", "editor-authoring: remove_custom_shader_slot"),
        ("create_skeleton2d_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.skeleton2d -> create_skeleton2d"),
        ("remove_skeleton2d_requests", "editor-authoring: remove_skeleton2d"),
        ("add_bone2d_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.skeleton2d -> add_bone2d"),
        ("remove_bone2d_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.skeleton2d -> remove_bone2d"),
        ("update_bone2d_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.skeleton2d -> update_bone2d"),
        ("create_skeletal_animation2d_requests", "editor-authoring: create_skeletal_animation2d"),
        ("add_keyframe2d_requests", "editor-authoring: add_keyframe2d"),
        ("play_skeletal_animation2d_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.skeleton2d -> play_skeletal_animation2d / stop_skeletal_animation2d"),
        ("set_skeleton2d_skin_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.skeleton2d -> set_skeleton2d_skin"),
        ("create_ik_chain2d_requests", "editor-authoring: create_ik_chain2d (set_ik_target2d is allowlisted but targets an existing chain)"),
        ("auto_weight_skeleton2d_requests", "editor-authoring: auto_weight_skeleton2d"),
        ("skeleton2d_resyncs", "editor-authoring: undo/redo mirror resync, editor-only by construction"),
        ("csg_requests", "editor-authoring: csg_boolean"),
        ("terrain_spawn_requests", "editor-authoring: create_terrain"),
        ("terrain_updates", "editor-authoring: update_terrain"),
        ("terrain_sculpts", "editor-authoring: sculpt_terrain"),
        ("extrude_requests", "editor-authoring: extrude"),
        ("lathe_requests", "editor-authoring: lathe"),
        ("array_requests", "editor-authoring: array_entity"),
        ("combine_requests", "editor-authoring: combine_meshes"),
        ("game_component_adds", "editor-authoring: add_game_component (exported scenes carry their components in scene data)"),
        ("game_component_updates", "editor-authoring: update_game_component"),
        ("game_component_removals", "editor-authoring: remove_game_component"),
        ("set_game_camera_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.camera.follow/lookAt/setPosition -> set_game_camera"),
        ("set_active_game_camera_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.camera.* -> set_active_game_camera"),
        ("camera_shake_requests", "SCRIPT-REACHABLE, dropped in exported games; #9668: forge.camera / vibrate -> camera_shake"),
        ("add_mesh_attachment2d_requests", "editor-authoring: add_skeleton2d_mesh_attachment"),
        ("scene_export_requests", "editor-authoring: export_scene"),
        ("scene_load_requests", "editor-authoring: load_scene (an exported game boots from embedded scene data)"),
        ("new_scene_requests", "editor-authoring: new_scene"),
        ("gltf_import_requests", "editor-authoring: import_gltf"),
        ("texture_load_requests", "editor-authoring: load_texture"),
        ("place_asset_requests", "editor-authoring: place_asset"),
        ("delete_asset_requests", "editor-authoring: delete_asset"),
        ("remove_texture_requests", "editor-authoring: remove_texture"),
        ("audio_import_requests", "editor-authoring: import_audio"),
        ("instantiate_prefab_requests", "editor-authoring: instantiate_prefab"),
        ("enter_edit_mode_requests", "editor-authoring: enter_edit_mode (mesh editing)"),
        ("exit_edit_mode_requests", "editor-authoring: exit_edit_mode"),
        ("set_selection_mode_requests", "editor-authoring: set_selection_mode"),
        ("select_elements_requests", "editor-authoring: select_elements"),
        ("mesh_operation_requests", "editor-authoring: mesh_operation"),
        ("recalc_normals_requests", "editor-authoring: recalculate_normals"),
        ("set_lod_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
        ("generate_lods_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
        ("set_performance_budget_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
        ("get_performance_stats_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
        ("optimize_scene_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
        ("set_lod_distances_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
        ("set_simplification_backend_requests", "runtime-gated dispatch: core/commands/performance.rs answers this under the runtime feature and queues nothing"),
    ];

    /// The queues #9550 un-gated. Named explicitly so the waiver list above
    /// cannot re-absorb them: these MUST be drained in a runtime build.
    const FIXED_BY_9550: &[&str] = &[
        "debug_physics_toggles",
        "create_joint_requests",
        "update_joint_requests",
        "remove_joint_requests",
        "create_joint2d_requests",
        "update_joint2d_requests",
        "remove_joint2d_requests",
        "gravity2d_updates",
        "debug_physics2d_toggles",
    ];

    fn all_functions() -> Vec<Func> {
        let mut out = Vec::new();
        for (file, source) in DRAIN_SOURCES {
            out.extend(functions(file, source));
        }
        out
    }

    #[test]
    fn scanner_reads_the_shapes_it_claims_to() {
        // Definition gating, with an unrelated attribute between.
        let src = "\
/// doc
#[cfg(not(feature = \"runtime\"))]
#[allow(dead_code)]
pub(super) fn gated(mut pending: ResMut<PendingCommands>) {
    for x in pending.a_requests.drain(..) {}
}

pub fn open(mut pending: ResMut<PendingCommands>) {
    let taken: Vec<_> = std::mem::take(&mut pending.b_requests);
    pending.c_requests.clear();
}
";
        let fns = functions("bridge/x.rs", src);
        assert_eq!(fns.len(), 2);
        assert!(fns[0].gated_def && fns[0].name == "gated");
        assert!(!fns[1].gated_def && fns[1].name == "open");
        assert_eq!(drained_fields(&fns[0].body), vec!["a_requests".to_string()]);
        let mut d = drained_fields(&fns[1].body);
        d.sort();
        assert_eq!(d, vec!["b_requests".to_string(), "c_requests".to_string()]);

        // Block and statement ranges.
        let src = "\
        app.add_systems(Update, keep);
        #[cfg(not(feature = \"runtime\"))]
        app.add_systems(Update, single);
        #[cfg(not(feature = \"runtime\"))]
        {
            app.add_systems(Update, (in_block, other));
        }
        app.add_systems(Update, tail);
";
        let view = runtime_view(src);
        assert!(mentions_ident(&view, "keep"));
        assert!(mentions_ident(&view, "tail"));
        assert!(!mentions_ident(&view, "single"));
        assert!(!mentions_ident(&view, "in_block"));
        assert!(!mentions_ident(&view, "other"));
        // Whole identifiers only: `apply_joint` must not satisfy `joint`.
        assert!(!mentions_ident("apply_joint,", "joint"));
        assert!(mentions_ident("(apply_joint, joint)", "joint"));
    }

    #[test]
    fn the_gated_range_ends_at_the_item_not_at_the_first_semicolon() {
        // A signature carrying a `;` inside brackets — `&[[f32; 2]]` is the real
        // shape from bridge/skeleton2d.rs. Deciding the item's extent from the
        // first `;` anywhere sends the scan hunting for a depth-0 terminator a
        // function body never has, which panics instead of blanking the body.
        let src = "\
#[cfg(not(feature = \"runtime\"))]
/// doc between the attribute and the item
#[allow(dead_code)]
fn gated(v: &[[f32; 2]]) -> Vec<u8> {
    editor_only_call();
}

fn kept() {
    runtime_call();
}
";
        let view = runtime_view(src);
        assert!(!mentions_ident(&view, "editor_only_call"), "gated body survived: {view}");
        assert!(mentions_ident(&view, "runtime_call"), "runtime body was blanked: {view}");

        // A declaration with no body still ends at its own `;`.
        for decl in ["mod gone;", "use crate::gone;", "struct Gone;"] {
            let src = format!("#[cfg(not(feature = \"runtime\"))]\n{decl}\nfn kept() {{ runtime_call(); }}\n");
            let view = runtime_view(&src);
            assert!(!mentions_ident(&view, "Gone") && !mentions_ident(&view, "gone"), "{decl}: {view}");
            assert!(mentions_ident(&view, "runtime_call"), "{decl} swallowed the next item: {view}");
        }

        // A `{` inside a call is not a body: the statement ends at its `;`.
        let src = "\
#[cfg(not(feature = \"runtime\"))]
app.add_systems(Update, (|w: &mut World| { editor_only_call(w); },));
app.add_systems(Update, runtime_call);
";
        let view = runtime_view(src);
        assert!(!mentions_ident(&view, "editor_only_call"), "closure body survived: {view}");
        assert!(mentions_ident(&view, "runtime_call"), "the following statement was blanked: {view}");
    }

    #[test]
    fn extraction_floors() {
        let fields = pending_fields();
        assert!(fields.len() >= 120, "only {} PendingCommands fields parsed", fields.len());
        let fns = all_functions();
        assert!(fns.len() >= 150, "only {} functions parsed across the drain sources", fns.len());
        let gated = fns.iter().filter(|f| f.gated_def).count();
        assert!(gated >= 40, "only {gated} gated definitions found — the attribute walk is broken");
        let modules = gated_modules();
        assert!(modules.contains(&"procedural".to_string()), "gated modules: {modules:?}");
        let ranges = editor_only_ranges(without_tests(BRIDGE_MOD));
        assert!(ranges.iter().any(|(a, b)| b - a > 5_000), "no large editor-only block found in bridge/mod.rs: {ranges:?}");
        assert!(registered_in_runtime("process_query_requests"));
        assert!(!registered_in_runtime("emit_selection_events"));
        assert!(!registered_in_runtime("no_such_system_anywhere"));
    }

    #[test]
    fn every_pending_queue_is_drained_in_a_runtime_build_or_waived() {
        let gated_modules = gated_modules();
        let fns = all_functions();
        let mut runtime_drained: Vec<String> = Vec::new();
        let mut editor_drained: Vec<String> = Vec::new();
        let mut undrained_anywhere: Vec<String> = Vec::new();
        for field in pending_fields() {
            if field == "query_requests" {
                // Owned by the query classification loop; the per-variant
                // reachability is asserted in `pending::query`'s tests.
                continue;
            }
            let drainers: Vec<&Func> = fns.iter().filter(|f| drained_fields(&f.body).contains(&field)).collect();
            if drainers.is_empty() {
                undrained_anywhere.push(field.clone());
            } else if drainers.iter().any(|f| {
                // The drain must survive BOTH gates: the function's own
                // definition must be reachable, and the statement that drains
                // must not sit inside an `EDITOR_ONLY` block within it.
                runtime_reachable(f, &gated_modules) && drained_fields(&f.runtime_body).contains(&field)
            }) {
                runtime_drained.push(field.clone());
            } else {
                editor_drained.push(field.clone());
            }
        }
        // Queues nothing drains in EITHER build. Each has a `queue_*` helper in
        // `core/pending/animation.rs` and no dispatch arm that calls it, so they
        // hold nothing today — vestigial, not leaking. Exact-match ratchet: an
        // entry that gains a drain fails, and a new drain-less queue fails, so a
        // command arm wired to one of these without a system is caught here.
        const DEAD_QUEUES: &[&str] = &[
            "animation_clip_updates",
            "animation_clip_add_keyframes",
            "animation_clip_remove_keyframes",
            "animation_clip_update_keyframes",
            "animation_clip_property_updates",
            "animation_clip_previews",
            "animation_clip_removals",
            "get_skeleton2d_requests",
            "import_skeleton_json_requests",
        ];
        let undead: Vec<&String> = undrained_anywhere.iter().filter(|f| !DEAD_QUEUES.contains(&f.as_str())).collect();
        assert!(
            undead.is_empty(),
            "PendingCommands queues no scanned system drains at all (a queue nothing ever empties, in EITHER build): {undead:?}"
        );
        let revived: Vec<&&str> = DEAD_QUEUES.iter().filter(|f| !undrained_anywhere.iter().any(|u| u == **f)).collect();
        assert!(
            revived.is_empty(),
            "DEAD_QUEUES entries now drained by a system (or no longer queues) — remove them: {revived:?}"
        );
        assert!(
            runtime_drained.len() >= 40,
            "only {} queues drained in a runtime build — the reachability model is probably broken: {runtime_drained:?}",
            runtime_drained.len()
        );
        for field in FIXED_BY_9550 {
            assert!(
                runtime_drained.iter().any(|f| f == field),
                "`{field}` is queued by an unconditional dispatch arm but its drain is not reachable in a runtime build (#9550 regression)"
            );
            assert!(
                !RUNTIME_UNDRAINED.iter().any(|(f, _)| f == field),
                "`{field}` was fixed by #9550 and must not be waived"
            );
        }
        let waived: Vec<&str> = RUNTIME_UNDRAINED.iter().map(|(f, _)| *f).collect();
        let unwaived: Vec<&String> = editor_drained.iter().filter(|f| !waived.contains(&f.as_str())).collect();
        assert!(
            unwaived.is_empty(),
            "queues an unconditional dispatch arm fills that NO system drains in a runtime build. \
             Un-gate the drain (see #9550) or add each to RUNTIME_UNDRAINED with a reason: {unwaived:?}"
        );
        let stale: Vec<&&str> = waived.iter().filter(|f| !editor_drained.iter().any(|e| e == **f)).collect();
        assert!(
            stale.is_empty(),
            "RUNTIME_UNDRAINED entries that are now drained in a runtime build (or are not queues) — remove them: {stale:?}"
        );
        for (field, reason) in RUNTIME_UNDRAINED {
            assert!(
                reason.len() >= 20,
                "waiver for `{field}` needs a real reason, got {reason:?}"
            );
        }
    }
}
