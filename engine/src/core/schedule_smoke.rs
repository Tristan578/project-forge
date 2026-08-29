//! Native-App schedule smoke test (PF-9452).
//!
//! `win_condition_tests` in `game_components.rs` proves one system, in
//! isolation, has no B0002-class resource-access conflict (`Res<T>` +
//! `ResMut<T>` of the same resource in one schedule). It says nothing about
//! conflicts that only appear once every system in the real, fully-registered
//! `Update` schedule is present together — which is exactly how the
//! `system_win_condition` regression (#8661/PF-837) shipped to production:
//! the isolated test was green, but the real app panicked at Edit->Play.
//!
//! This module builds the closest thing to the real production `App` that a
//! native (non-wasm32) test can construct — using the actual `Plugin::build`
//! implementations below, not restatements of them — and runs one real
//! `Update` tick. Bevy's B0002 detection is static: it walks the declared
//! `SystemParam` access of every system at `Schedule::initialize` time,
//! independent of `run_if` conditions or of whether the resource is even
//! present in the `World` at runtime. So a single `app.update()` with every
//! system registered is sufficient to catch a conflict regardless of
//! `EngineMode` — we don't need to drive Play/Edit transitions here.
//!
//! `App::new()` supplies almost nothing (`MainSchedulePlugin`, type
//! registry, `AppExit`) — every one of the plugins below was added because
//! removing it produced a real "resource does not exist" / "message not
//! initialized" panic when this test was written, not by guessing:
//! `TaskPoolPlugin`/`FrameCountPlugin`/`TimePlugin`/`TransformPlugin`/
//! `AssetPlugin`/input/`GizmoPlugin` for baseline engine services;
//! `PickingPlugin`+`InteractionPlugin`+`MeshPickingPlugin` because
//! `ForgeGizmoPlugin` wraps `transform-gizmo-bevy`, whose systems read
//! `PointerHits`/`RayMap`/`HoverMap` (normally supplied by `DefaultPlugins`'
//! picking group); `ScenePlugin` because `bevy_rapier`'s async-collider
//! systems read `Res<SceneSpawner>` unconditionally. None of this pulls in
//! a renderer or window — confirmed by this test actually passing headless.
//!
//! Test-only: never compiled into the wasm build (see `parity_util`'s doc
//! comment for the same pattern), and nothing outside `#[cfg(test)]` may
//! depend on it.

#![cfg(test)]

use bevy::app::{App, TaskPoolPlugin};
use bevy::asset::AssetPlugin;
use bevy::diagnostic::FrameCountPlugin;
use bevy::gizmos::GizmoPlugin;
// `core::input::InputPlugin` / `core::material::MaterialPlugin` shadow Bevy's
// own `InputPlugin` / generic `MaterialPlugin<M>` — alias both sides so the
// import list stays unambiguous instead of relying on `bevy::prelude`'s glob
// silently losing the collision.
use bevy::input::InputPlugin as BevyInputPlugin;
use bevy::pbr::StandardMaterial;
use bevy::picking::mesh_picking::MeshPickingPlugin;
use bevy::picking::{InteractionPlugin, PickingPlugin};
use bevy::prelude::*;
use bevy::scene::ScenePlugin;
use bevy::time::TimePlugin;

use super::animation::AnimationPlugin;
use super::asset_manager::{AssetRegistry, TextureHandleMap};
use super::audio::AudioBusConfig;
use super::camera::CameraControlPlugin;
use super::custom_wgsl::{CustomShaderRegistry, CustomWgslPlugin};
use super::engine_mode::{EngineMode, SceneSnapshot};
use super::environment::{EnvironmentPlugin, SkyboxHandles};
use super::game_camera::GameCameraPlugin;
use super::game_components::GameComponentsPlugin;
use super::gizmo::ForgeGizmoPlugin;
use super::history::HistoryStack;
use super::input::InputPlugin as ForgeInputPlugin;
use super::lighting::LightingPlugin;
use super::lod::{PerformanceMetrics, SimplificationBackend};
use super::material::MaterialPlugin as ForgeMaterialPlugin;
use super::observability::ObservabilityPlugin;
use super::pending::PendingCommands;
use super::physics::PhysicsPlugin;
use super::physics_2d_sim::Physics2dPlugin;
use super::post_processing::PostProcessingPlugin;
use super::project_type::ProjectType;
use super::quality::QualitySettings;
use super::scene_file::SceneName;
use super::scene_graph::SceneGraphCache;
use super::selection::{Selection, SelectionChangedEvent};
use super::shader_effects::ShaderEffectsPlugin;
use super::snap::SnapPlugin;
use super::sprite::SortingLayerConfig;
use super::terrain::TerrainChangeEvents;
use super::tilemap::Grid2dConfig;

/// The production plugin roster, read from the real source rather than
/// restated as a number.
///
/// `bridge/mod.rs` is `#[cfg(target_arch = "wasm32")]`-gated at the crate root,
/// so it is never *compiled* into this native test — but `include_str!` reads
/// the file regardless of cfg. That is what lets the exhaustiveness assertion
/// below compare against what production actually registers today instead of
/// against a hand-maintained count that agrees with itself by construction.
const BRIDGE_SRC: &str = include_str!("../bridge/mod.rs");

/// Plugins `bridge::init_engine` registers that belong to Bevy or a dependency.
/// They carry none of our `core::*` systems, so they are not what this module's
/// coverage is measured against. `DefaultPlugins` is absent on purpose: it is
/// registered as a builder chain (`DefaultPlugins.set(...)`), not a bare path,
/// so the parser below never sees it as a candidate at all.
const THIRD_PARTY_PLUGINS: &[&str] = &["MeshPickingPlugin", "HanabiPlugin"];

/// The first-party plugins `build_full_app` registers for real, spelled the way
/// `bridge/mod.rs` spells them (this module imports two of them under aliases —
/// `ForgeMaterialPlugin`, `ForgeInputPlugin` — because `core::material` and
/// `core::input` shadow Bevy's own types).
const REGISTERED_PLUGINS: &[&str] = &[
    "AnimationPlugin",
    "CameraControlPlugin",
    "CustomWgslPlugin",
    "EnvironmentPlugin",
    "ForgeGizmoPlugin",
    "GameCameraPlugin",
    "GameComponentsPlugin",
    "InputPlugin",
    "LightingPlugin",
    "MaterialPlugin",
    "ObservabilityPlugin",
    "Physics2dPlugin",
    "PhysicsPlugin",
    "PostProcessingPlugin",
    "ShaderEffectsPlugin",
    "SnapPlugin",
];

/// Plugins this native test cannot register, with the one-line reason each.
/// Every plugin NOT listed here is registered for real below — this list is
/// the full, explicit account of what native coverage does not reach.
const UNREGISTERED_PLUGINS: &[(&str, &str)] = &[
    (
        "bridge::SelectionPlugin",
        "lives in `bridge/`, which is `#[cfg(target_arch = \"wasm32\")]`-gated \
         at the crate root (engine/src/lib.rs) and does not exist in a native build",
    ),
];

/// Every first-party plugin `bridge/mod.rs` registers, by bare name.
///
/// Deliberately conservative: it counts only `add_plugins(<path>)` where the
/// argument is a single bare path expression, which is the only form the file
/// uses. A tuple registration would slip past it silently and make the
/// exhaustiveness check under-count, so that form is rejected outright rather
/// than quietly tolerated.
fn production_first_party_plugins() -> Vec<String> {
    assert!(
        !BRIDGE_SRC.contains("add_plugins(("),
        "bridge/mod.rs now registers a plugin TUPLE. This parser only understands \
         one plugin per `add_plugins` call and would silently under-count, which \
         would turn the exhaustiveness assertion below into a test that passes \
         because it looked at nothing. Extend the parser first."
    );

    let mut found: Vec<String> = Vec::new();
    for chunk in BRIDGE_SRC.split("add_plugins(").skip(1) {
        let Some(end) = chunk.find(')') else { continue };
        let arg = chunk[..end].trim();
        // Only a bare path is a registration we can attribute. Builder chains
        // (`DefaultPlugins.set(..)`) and struct literals contain characters
        // this rejects, so they are skipped rather than misread.
        if arg.is_empty() || !arg.chars().all(|c| c.is_alphanumeric() || c == '_' || c == ':') {
            continue;
        }
        let name = arg.rsplit("::").next().unwrap_or(arg);
        if THIRD_PARTY_PLUGINS.contains(&name) {
            continue;
        }
        found.push(name.to_string());
    }
    found.sort();
    found.dedup();
    found
}

/// Fails when production gains or loses a plugin without this module following.
///
/// This is the assertion that has to be non-vacuous: the regression it guards
/// (#8661/PF-837) shipped precisely because the production app changed while a
/// test kept measuring an older shape. It therefore compares plugin *names*
/// parsed out of `bridge/mod.rs` against the union of what `build_full_app`
/// registers and what `UNREGISTERED_PLUGINS` excuses — never a count against a
/// count.
#[test]
fn assert_exclusion_list_is_exhaustive() {
    let production = production_first_party_plugins();
    assert!(
        !production.is_empty(),
        "parsed zero plugins out of bridge/mod.rs — the registration shape changed \
         and this check is now measuring nothing"
    );

    let mut accounted: Vec<&str> = REGISTERED_PLUGINS.to_vec();
    accounted.extend(
        UNREGISTERED_PLUGINS
            .iter()
            .map(|(name, _)| name.rsplit("::").next().unwrap_or(name)),
    );

    let unaccounted: Vec<&String> = production
        .iter()
        .filter(|p| !accounted.contains(&p.as_str()))
        .collect();
    assert!(
        unaccounted.is_empty(),
        "bridge/mod.rs registers {unaccounted:?}, which this test neither builds \
         into `build_full_app` nor excuses in UNREGISTERED_PLUGINS. Its schedule \
         is therefore NOT the production schedule. Add the plugin to \
         `build_full_app` (preferred) or record why it cannot be reached natively."
    );

    let stale: Vec<&&str> = accounted
        .iter()
        .filter(|a| !production.iter().any(|p| p == *a))
        .collect();
    assert!(
        stale.is_empty(),
        "this test still accounts for {stale:?}, which bridge/mod.rs no longer \
         registers. Drop them so the coverage claim stays true."
    );
}

/// Builds an `App` carrying every substrate resource/plugin the 16 registered
/// `core::*` plugins need to build and run without a "resource does not
/// exist" panic — a different (and uninteresting, for this test) panic class
/// from the B0002 conflicts under test. Mirrors `bridge::init_engine`'s and
/// `bridge::SelectionPlugin::build`'s registrations; nothing here is invented.
fn build_full_app() -> App {
    let mut app = App::new();

    // Runtime substrate `App::new()` doesn't provide (see bevy_app::App::default):
    // task pool, frame counting, Time<T> (Res<Time> is read widely), transform
    // propagation (TransformSystems::Propagate, used as an ordering anchor by
    // bevy_panorbit_camera), asset storage (Assets<T> for meshes/materials/shaders),
    // keyboard/mouse input (ButtonInput<T>, read by capture_input and camera
    // systems), and gizmos (Gizmos system param, read by snap::render_grid_overlay).
    app.add_plugins((
        TaskPoolPlugin::default(),
        FrameCountPlugin,
        TimePlugin,
        TransformPlugin,
        AssetPlugin::default(),
        BevyInputPlugin::default(),
        GizmoPlugin,
        // `ForgeGizmoPlugin` wraps `transform-gizmo-bevy`, whose picking
        // integration reads `PointerHits`/`RayMap` — normally supplied by
        // `DefaultPlugins`' picking group, which we don't have here.
        PickingPlugin,
        InteractionPlugin,
        MeshPickingPlugin,
        // bevy_rapier's async-collider-from-scene systems read `Res<SceneSpawner>`
        // unconditionally; normally supplied by `DefaultPlugins`.
        ScenePlugin,
    ));

    // Some plugins reach into `Assets<T>` directly (custom_wgsl, shader_effects
    // via `resource_mut::<Assets<Shader>>()`; material.rs's `sync_material_data`
    // via `ResMut<Assets<StandardMaterial>>`) instead of depending on a plugin
    // that registers them — `init_asset` is the generic, render-pipeline-free
    // way to satisfy that (see `bevy_asset::AssetApp`).
    app.init_asset::<Shader>();
    app.init_asset::<Mesh>();
    app.init_asset::<StandardMaterial>();

    // Mirrors `bridge::SelectionPlugin::build`'s resource-init list minus the
    // bridge-private resources (`scripts::PlayTickCache`, `core_systems::PickBuffer`)
    // that only bridge-only systems (excluded above) ever touch.
    app.init_resource::<Selection>()
        .init_resource::<SceneGraphCache>()
        .init_resource::<PendingCommands>()
        .init_resource::<HistoryStack>()
        .init_resource::<EngineMode>()
        .init_resource::<SceneSnapshot>()
        .init_resource::<SceneName>()
        .init_resource::<AssetRegistry>()
        .init_resource::<TextureHandleMap>()
        .init_resource::<AudioBusConfig>()
        .init_resource::<QualitySettings>()
        .init_resource::<SkyboxHandles>()
        .init_resource::<ProjectType>()
        .init_resource::<Grid2dConfig>()
        .init_resource::<PerformanceMetrics>()
        .init_resource::<SimplificationBackend>()
        .init_resource::<CustomShaderRegistry>()
        .init_resource::<SortingLayerConfig>()
        .init_resource::<TerrainChangeEvents>()
        .add_message::<SelectionChangedEvent>();

    // The 16 `core::*` plugins that own `fn build`. Registration order
    // mirrors `bridge::init_engine` so `.after(...)`/`.before(...)` edges
    // resolve against the same set of already-declared systems/sets.
    app.add_plugins((
        AnimationPlugin,
        ForgeMaterialPlugin,
        LightingPlugin,
        EnvironmentPlugin,
        PostProcessingPlugin,
        ForgeInputPlugin,
        PhysicsPlugin,
        Physics2dPlugin,
        ShaderEffectsPlugin,
        CustomWgslPlugin,
        CameraControlPlugin,
        GameCameraPlugin,
        GameComponentsPlugin,
        ObservabilityPlugin,
    ));

    // Editor-only plugins, gated exactly as `bridge::init_engine` gates them.
    #[cfg(not(feature = "runtime"))]
    app.add_plugins((ForgeGizmoPlugin, SnapPlugin));

    app
}

/// The core assertion: constructing the real app and ticking it once must
/// not panic. A B0002 conflict panics inside `app.update()` (schedule
/// initialization happens on first run), before any of our own assertions
/// even execute — so "the test function returns" IS the pass condition.
#[test]
fn full_schedule_has_no_b0002_conflicts() {
    let mut app = build_full_app();
    app.update();
}
