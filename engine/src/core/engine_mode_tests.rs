//! Test module for [`super::engine_mode`].
//!
//! Split out of `engine_mode.rs` purely to keep that file under the
//! repository's 800-line ceiling (`.claude/tools/validate-rust.sh`), the same
//! reason `component_carry_tests.rs` is a sibling of `component_carry.rs`.

#[cfg(test)]
mod restore_scene_removal_tests {
    //! Play → Stop must not leak components that Play created.
    //!
    //! [`snapshot_scene`] captures the scene the instant Play is pressed and
    //! [`restore_scene`] rebuilds it on Stop. A restore that only *inserts* the
    //! snapshot value is half a restore: it puts back what was recorded and
    //! silently keeps whatever Play added. A component created at runtime on an
    //! entity that had none then survives Stop, leaks into the edit scene, and
    //! is written into `projects.sceneData` on the next save — user data the
    //! user never authored.
    //!
    //! Every test here spawns an entity WITHOUT the component under test, plays,
    //! creates the component the way a script or a game system would, stops, and
    //! asserts the component is gone. Each also asserts the component really was
    //! created before Stop, so a fixture that silently stopped exercising the
    //! path fails loudly instead of passing vacuously.
    //!
    //! `MaterialData` / `LightData` / `PhysicsData` are reached through the
    //! restore query rather than `Commands`, so they get the mirror case too:
    //! a component REMOVED during Play must come back on Stop.
    //!
    //! Both functions take `&Query<..>` rather than `SystemParam`s, so the tests
    //! drive them through the two thin wrapper systems below — the same shapes
    //! `bridge::core_systems::apply_mode_change_requests` passes at the real
    //! call site.

    use crate::core::asset_manager::AssetRef;
    use crate::core::audio::{AudioData, AudioEnabled};
    use crate::core::csg::CsgMeshData;
    use crate::core::engine_mode::{restore_scene, snapshot_scene, RuntimeEntity, SceneSnapshot};
    use crate::core::entity_factory::Undeletable;
    use crate::core::entity_id::{EntityId, EntityName, EntityVisible};
    use crate::core::game_camera::{ActiveGameCamera, GameCameraData};
    use crate::core::game_components::{GameComponentData, GameComponents, HealthData};
    use crate::core::lighting::{LightData, LightType};
    use crate::core::lod::LodData;
    use crate::core::material::MaterialData;
    use crate::core::particles::{ParticleData, ParticleEnabled};
    use crate::core::pending_commands::EntityType;
    use crate::core::physics::{JointData, JointType, PhysicsData, PhysicsEnabled};
    use crate::core::physics_2d::{Physics2dData, Physics2dEnabled, PhysicsJoint2d};
    use crate::core::procedural_mesh::ProceduralMeshData;
    use crate::core::reverb_zone::{ReverbZoneData, ReverbZoneEnabled};
    use crate::core::scripting::ScriptData;
    use crate::core::selection::Selection;
    use crate::core::shader_effects::ShaderEffectData;
    use crate::core::skeletal_animation2d::SkeletalAnimation2d;
    use crate::core::skeleton2d::{SkeletonData2d, SkeletonEnabled2d};
    use crate::core::sprite::SpriteData;
    use crate::core::tilemap::{TilemapData, TilemapEnabled};
    use bevy::prelude::*;

    // ---------------------------------------------------------------------
    // Harness
    // ---------------------------------------------------------------------

    /// Writes the Play-time snapshot into the `SceneSnapshot` resource, exactly
    /// as the bridge does on `ModeChangeRequest::Play`.
    #[allow(clippy::type_complexity, clippy::too_many_arguments)]
    fn snapshot_system(
        query: Query<(
            Entity,
            &EntityId,
            &EntityName,
            &Transform,
            &EntityVisible,
            Option<&EntityType>,
            Option<&MaterialData>,
            Option<&LightData>,
            Option<&PhysicsData>,
            Option<&PhysicsEnabled>,
            Option<&Mesh3d>,
            Option<&PointLight>,
            Option<&DirectionalLight>,
            Option<&SpotLight>,
            Option<&AssetRef>,
        )>,
        script_audio_query: Query<(
            &EntityId,
            Option<&ScriptData>,
            Option<&AudioData>,
            Option<&AudioEnabled>,
        )>,
        reverb_particle_shader_query: Query<(
            &EntityId,
            Option<&ReverbZoneData>,
            Option<&ReverbZoneEnabled>,
            Option<&ParticleData>,
            Option<&ParticleEnabled>,
            Option<&ShaderEffectData>,
        )>,
        csg_sprite_physics2d_query: Query<(
            &EntityId,
            Option<&CsgMeshData>,
            Option<&SpriteData>,
            Option<&Physics2dData>,
            Option<&Physics2dEnabled>,
            Option<&PhysicsJoint2d>,
        )>,
        procedural_joint_gc_camera_query: Query<(
            &EntityId,
            Option<&ProceduralMeshData>,
            Option<&JointData>,
            Option<&GameComponents>,
            Option<&GameCameraData>,
            Option<&ActiveGameCamera>,
        )>,
        tilemap_skeleton2d_query: Query<(
            &EntityId,
            Option<&TilemapData>,
            Option<&TilemapEnabled>,
            Option<&SkeletonData2d>,
            Option<&SkeletonEnabled2d>,
            Option<&SkeletalAnimation2d>,
            Option<&LodData>,
            Option<&crate::core::terrain::TerrainData>,
            Option<&crate::core::terrain::TerrainMeshData>,
            Option<&crate::core::animation_clip::AnimationClipData>,
        )>,
        selection: Res<Selection>,
        mut out: ResMut<SceneSnapshot>,
    ) {
        *out = snapshot_scene(
            &query,
            &script_audio_query,
            &reverb_particle_shader_query,
            &csg_sprite_physics2d_query,
            &procedural_joint_gc_camera_query,
            &tilemap_skeleton2d_query,
            &selection,
        );
    }

    /// Rebuilds the scene from the stored snapshot, as the bridge does on
    /// `ModeChangeRequest::Stop`.
    #[allow(clippy::type_complexity)]
    fn restore_system(
        mut commands: Commands,
        snapshot: Res<SceneSnapshot>,
        mut entity_query: Query<
            (
                Entity,
                &EntityId,
                &mut Transform,
                &mut EntityName,
                &mut EntityVisible,
                Option<&mut MaterialData>,
                Option<&mut LightData>,
                Option<&mut PhysicsData>,
            ),
            Without<Undeletable>,
        >,
        runtime_query: Query<Entity, With<RuntimeEntity>>,
        mut meshes: ResMut<Assets<Mesh>>,
        mut materials: ResMut<Assets<StandardMaterial>>,
    ) {
        restore_scene(
            &mut commands,
            &snapshot,
            &mut entity_query,
            &runtime_query,
            &mut meshes,
            &mut materials,
        );
    }

    fn test_world() -> World {
        let mut world = World::new();
        world.insert_resource(Assets::<Mesh>::default());
        world.insert_resource(Assets::<StandardMaterial>::default());
        world.insert_resource(Selection::default());
        world.insert_resource(SceneSnapshot::default());
        world
    }

    /// Press Play: capture the scene.
    fn press_play(world: &mut World) {
        let mut schedule = Schedule::default();
        schedule.add_systems(snapshot_system);
        schedule.run(world);
    }

    /// Press Stop: rebuild the scene from the captured snapshot.
    fn press_stop(world: &mut World) {
        let mut schedule = Schedule::default();
        schedule.add_systems(restore_system);
        schedule.run(world);
        // `restore_scene` queues its inserts and removes through `Commands`;
        // the assertions that follow must see them applied.
        world.flush();
    }

    const ID: &str = "entity-under-test";

    /// A forge entity carrying only the components every snapshot row needs.
    /// `EntityType` is what keeps `snapshot_scene` from `continue`-ing past it.
    fn spawn_bare(world: &mut World) -> Entity {
        world
            .spawn((
                EntityId(ID.to_string()),
                EntityName("Authored Name".to_string()),
                Transform::from_xyz(1.5, -2.25, 3.75),
                EntityVisible(true),
                EntityType::Cube,
            ))
            .id()
    }

    fn has<T: Component>(world: &World, entity: Entity) -> bool {
        world.entity(entity).contains::<T>()
    }

    fn get<T: Component + Clone>(world: &World, entity: Entity) -> Option<T> {
        world.entity(entity).get::<T>().cloned()
    }

    /// Spawn an entity WITHOUT `component`, press Play, create the component at
    /// runtime, press Stop. Returns whether it survived — it must not.
    fn survives_stop<T: Component + Clone>(component: T) -> bool {
        let mut world = test_world();
        let entity = spawn_bare(&mut world);
        press_play(&mut world);
        world.entity_mut(entity).insert(component);
        assert!(
            has::<T>(&world, entity),
            "inert fixture: the component was never created during Play, so Stop had nothing to leak"
        );
        press_stop(&mut world);
        has::<T>(&world, entity)
    }

    /// Spawn an entity WITH `component`, press Play, delete the component at
    /// runtime, press Stop. Returns what Stop put back — it must be the
    /// authored value.
    fn restored_after_loss<T: Component + Clone>(component: T) -> Option<T> {
        let mut world = test_world();
        let entity = spawn_bare(&mut world);
        world.entity_mut(entity).insert(component);
        press_play(&mut world);
        world.entity_mut(entity).remove::<T>();
        assert!(
            !has::<T>(&world, entity),
            "inert fixture: the component was never removed during Play, so Stop had nothing to restore"
        );
        press_stop(&mut world);
        get::<T>(&world, entity)
    }

    // ---------------------------------------------------------------------
    // Fixtures — every value below is off its type's Default on purpose, so a
    // regression that inserts a blank struct cannot satisfy an assertion.
    // ---------------------------------------------------------------------

    fn authored_script() -> ScriptData {
        ScriptData {
            source: "forge.entity.setPosition(0, 10, 0);".to_string(),
            enabled: true,
            template: Some("patrol".to_string()),
        }
    }

    fn authored_audio() -> AudioData {
        AudioData {
            asset_id: Some("asset-theme".to_string()),
            volume: 0.42,
            pitch: 1.75,
            ..Default::default()
        }
    }

    fn authored_particles() -> ParticleData {
        ParticleData {
            max_particles: 321,
            lifetime_max: 9.5,
            world_space: true,
            ..Default::default()
        }
    }

    fn authored_reverb() -> ReverbZoneData {
        ReverbZoneData {
            preset: "cave".to_string(),
            wet_mix: 0.83,
            priority: 7,
            ..Default::default()
        }
    }

    fn authored_shader() -> ShaderEffectData {
        ShaderEffectData {
            shader_type: "hologram".to_string(),
            noise_scale: 12.5,
            emission_strength: 3.25,
            ..Default::default()
        }
    }

    fn authored_joint() -> JointData {
        JointData {
            joint_type: JointType::Revolute,
            connected_entity_id: "anchor-entity".to_string(),
            anchor_self: [0.5, 1.5, -2.5],
            anchor_other: [-1.0, 0.25, 3.0],
            axis: [0.0, 0.0, 1.0],
            limits: None,
            motor: None,
        }
    }

    fn authored_game_components() -> GameComponents {
        GameComponents {
            components: vec![GameComponentData::Health(HealthData {
                max_hp: 250.0,
                current_hp: 175.0,
                invincibility_secs: 1.25,
                respawn_on_death: false,
                respawn_point: [3.0, 9.0, -4.0],
                despawn_on_death: false,
            })],
        }
    }

    fn authored_game_camera() -> GameCameraData {
        GameCameraData {
            target_entity: Some("hero-entity".to_string()),
            ..Default::default()
        }
    }

    fn authored_sprite() -> SpriteData {
        SpriteData {
            texture_asset_id: Some("asset-hero-sheet".to_string()),
            flip_x: true,
            sorting_order: 7,
            ..Default::default()
        }
    }

    fn authored_tilemap() -> TilemapData {
        TilemapData {
            tileset_asset_id: "asset-dungeon-tiles".to_string(),
            tile_size: [24, 24],
            map_size: [4, 3],
            ..Default::default()
        }
    }

    fn authored_skeleton() -> SkeletonData2d {
        SkeletonData2d {
            active_skin: "winter".to_string(),
            ..Default::default()
        }
    }

    fn authored_lod() -> LodData {
        LodData {
            lod_distances: [5.0, 15.0, 40.0],
            auto_generate: false,
            current_lod: 2,
            ..Default::default()
        }
    }

    fn authored_material() -> MaterialData {
        MaterialData {
            base_color: [0.11, 0.22, 0.33, 0.44],
            metallic: 0.77,
            perceptual_roughness: 0.13,
            double_sided: true,
            ..Default::default()
        }
    }

    fn authored_light() -> LightData {
        LightData {
            intensity: 4242.0,
            shadows_enabled: true,
            range: 33.5,
            ..LightData::point()
        }
    }

    fn authored_physics() -> PhysicsData {
        PhysicsData {
            restitution: 0.91,
            friction: 0.07,
            density: 4.25,
            gravity_scale: 2.5,
            is_sensor: true,
            ..Default::default()
        }
    }

    // ---------------------------------------------------------------------
    // Components restored through `Commands` — created during Play, must not
    // survive Stop.
    // ---------------------------------------------------------------------

    #[test]
    fn a_script_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_script()),
            "ScriptData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn an_audio_source_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_audio()),
            "AudioData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_particle_system_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_particles()),
            "ParticleData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_reverb_zone_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_reverb()),
            "ReverbZoneData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_shader_effect_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_shader()),
            "ShaderEffectData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_joint_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_joint()),
            "JointData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn game_components_created_during_play_do_not_survive_stop() {
        assert!(
            !survives_stop(authored_game_components()),
            "GameComponents created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_game_camera_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_game_camera()),
            "GameCameraData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_sprite_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_sprite()),
            "SpriteData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_tilemap_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_tilemap()),
            "TilemapData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_skeleton_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_skeleton()),
            "SkeletonData2d created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn an_lod_config_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_lod()),
            "LodData created during Play leaked into the edit scene"
        );
    }

    // ---------------------------------------------------------------------
    // Components reached through the restore query — both directions.
    // ---------------------------------------------------------------------

    #[test]
    fn a_material_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_material()),
            "MaterialData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_light_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_light()),
            "LightData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn physics_created_during_play_does_not_survive_stop() {
        assert!(
            !survives_stop(authored_physics()),
            "PhysicsData created during Play leaked into the edit scene"
        );
    }

    #[test]
    fn a_material_deleted_during_play_comes_back_on_stop() {
        let restored = restored_after_loss(authored_material())
            .expect("MaterialData deleted during Play was never restored on Stop");
        assert_eq!(restored.base_color, authored_material().base_color);
        assert_eq!(restored.metallic, authored_material().metallic);
        assert!(restored.double_sided);
    }

    #[test]
    fn a_light_deleted_during_play_comes_back_on_stop() {
        let restored = restored_after_loss(authored_light())
            .expect("LightData deleted during Play was never restored on Stop");
        assert_eq!(restored.intensity, authored_light().intensity);
        assert_eq!(restored.range, authored_light().range);
        assert!(restored.shadows_enabled);
        assert!(matches!(restored.light_type, LightType::Point));
    }

    #[test]
    fn physics_deleted_during_play_comes_back_on_stop() {
        let restored = restored_after_loss(authored_physics())
            .expect("PhysicsData deleted during Play was never restored on Stop");
        assert_eq!(restored, authored_physics());
    }

    // ---------------------------------------------------------------------
    // The in-place path the four-case `match` replaced: a component the entity
    // kept across Play must be rolled back to its authored value, not left with
    // whatever Play wrote into it.
    // ---------------------------------------------------------------------

    #[test]
    fn a_material_edited_during_play_is_rolled_back_on_stop() {
        let mut world = test_world();
        let entity = spawn_bare(&mut world);
        world.entity_mut(entity).insert(authored_material());
        press_play(&mut world);
        world.entity_mut(entity).insert(MaterialData {
            base_color: [1.0, 0.0, 0.0, 1.0],
            metallic: 0.0,
            ..Default::default()
        });
        press_stop(&mut world);
        let restored = get::<MaterialData>(&world, entity).expect("MaterialData vanished on Stop");
        assert_eq!(restored.base_color, authored_material().base_color);
        assert_eq!(restored.metallic, authored_material().metallic);
    }

    #[test]
    fn a_light_edited_during_play_is_rolled_back_on_stop() {
        let mut world = test_world();
        let entity = spawn_bare(&mut world);
        world.entity_mut(entity).insert(authored_light());
        press_play(&mut world);
        world.entity_mut(entity).insert(LightData {
            intensity: 1.0,
            ..LightData::spot()
        });
        press_stop(&mut world);
        let restored = get::<LightData>(&world, entity).expect("LightData vanished on Stop");
        assert_eq!(restored.intensity, authored_light().intensity);
        assert!(matches!(restored.light_type, LightType::Point));
    }

    #[test]
    fn physics_edited_during_play_is_rolled_back_on_stop() {
        let mut world = test_world();
        let entity = spawn_bare(&mut world);
        world.entity_mut(entity).insert(authored_physics());
        press_play(&mut world);
        world.entity_mut(entity).insert(PhysicsData {
            restitution: 0.0,
            ..Default::default()
        });
        press_stop(&mut world);
        let restored = get::<PhysicsData>(&world, entity).expect("PhysicsData vanished on Stop");
        assert_eq!(restored, authored_physics());
    }
}
