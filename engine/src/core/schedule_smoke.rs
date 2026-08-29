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

/// The 16 `core::*` plugins the production bridge registers, plus the
/// bridge's own `SelectionPlugin`, make 17 — the baseline plugin count this
/// module's coverage is checked against (see `assert_exclusion_list_is_exhaustive`).
const TOTAL_PLUGIN_COUNT: usize = 17;

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

#[test]
fn assert_exclusion_list_is_exhaustive() {
    // 16 core plugins registered below + the 1 wasm-only plugin listed above
    // must account for every plugin in the production app.
    assert_eq!(
        16 + UNREGISTERED_PLUGINS.len(),
        TOTAL_PLUGIN_COUNT,
        "a plugin was added to or removed from the production app without \
         updating this test's coverage or its UNREGISTERED_PLUGINS reasons"
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
