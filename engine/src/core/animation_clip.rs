//! Keyframe property animation system.
//!
//! Allows animating any numeric entity property over time with user-defined
//! keyframes and interpolation curves. Separate from Bevy's skeletal animation.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use super::{
    engine_mode::{EditorApplySet, EngineMode},
    lighting::LightData,
    material::MaterialData,
};

/// ECS component storing keyframe animation data for an entity.
/// Each entity can have at most one AnimationClipData.
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationClipData {
    /// Animation tracks, each targeting a single property channel.
    pub tracks: Vec<AnimationTrack>,
    /// Total clip duration in seconds.
    pub duration: f32,
    /// How the clip behaves when it reaches the end.
    pub play_mode: PlayMode,
    /// Whether the clip is currently playing (preview or runtime).
    pub playing: bool,
    /// Playback speed multiplier (1.0 = normal, 0.5 = half, 2.0 = double).
    pub speed: f32,
    /// Current playback position in seconds.
    pub current_time: f32,
    /// Whether playback direction is forward (true) or reverse (false).
    /// Used internally for PingPong mode.
    #[serde(default = "default_true")]
    pub forward: bool,
    /// Whether this clip should auto-play when entering Play mode.
    #[serde(default = "default_true")]
    pub autoplay: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AnimationClipData {
    fn default() -> Self {
        Self {
            tracks: Vec::new(),
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 0.0,
            forward: true,
            autoplay: true,
        }
    }
}

/// A single animation track targeting one property channel.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationTrack {
    /// Which property this track animates.
    pub target: PropertyTarget,
    /// Keyframes sorted by time (ascending). Must have >= 2 for interpolation.
    pub keyframes: Vec<Keyframe>,
}

/// Identifies which numeric property to animate.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropertyTarget {
    // Transform channels (9)
    PositionX,
    PositionY,
    PositionZ,
    RotationX, // Euler degrees
    RotationY,
    RotationZ,
    ScaleX,
    ScaleY,
    ScaleZ,
    // Material channels (10)
    MaterialBaseColorR,
    MaterialBaseColorG,
    MaterialBaseColorB,
    MaterialBaseColorA,
    MaterialEmissiveR,
    MaterialEmissiveG,
    MaterialEmissiveB,
    MaterialMetallic,
    MaterialRoughness,
    MaterialOpacity,
    // Light channels (5)
    LightIntensity,
    LightColorR,
    LightColorG,
    LightColorB,
    LightRange,
}

impl PropertyTarget {
    /// Human-readable display name for the UI.
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::PositionX => "Position X",
            Self::PositionY => "Position Y",
            Self::PositionZ => "Position Z",
            Self::RotationX => "Rotation X",
            Self::RotationY => "Rotation Y",
            Self::RotationZ => "Rotation Z",
            Self::ScaleX => "Scale X",
            Self::ScaleY => "Scale Y",
            Self::ScaleZ => "Scale Z",
            Self::MaterialBaseColorR => "Base Color R",
            Self::MaterialBaseColorG => "Base Color G",
            Self::MaterialBaseColorB => "Base Color B",
            Self::MaterialBaseColorA => "Base Color A",
            Self::MaterialEmissiveR => "Emissive R",
            Self::MaterialEmissiveG => "Emissive G",
            Self::MaterialEmissiveB => "Emissive B",
            Self::MaterialMetallic => "Metallic",
            Self::MaterialRoughness => "Roughness",
            Self::MaterialOpacity => "Opacity",
            Self::LightIntensity => "Light Intensity",
            Self::LightColorR => "Light Color R",
            Self::LightColorG => "Light Color G",
            Self::LightColorB => "Light Color B",
            Self::LightRange => "Light Range",
        }
    }

    /// Group name for UI organization.
    pub fn group(&self) -> &'static str {
        match self {
            Self::PositionX | Self::PositionY | Self::PositionZ => "Position",
            Self::RotationX | Self::RotationY | Self::RotationZ => "Rotation",
            Self::ScaleX | Self::ScaleY | Self::ScaleZ => "Scale",
            Self::MaterialBaseColorR
            | Self::MaterialBaseColorG
            | Self::MaterialBaseColorB
            | Self::MaterialBaseColorA => "Base Color",
            Self::MaterialEmissiveR | Self::MaterialEmissiveG | Self::MaterialEmissiveB => {
                "Emissive"
            }
            Self::MaterialMetallic => "Metallic",
            Self::MaterialRoughness => "Roughness",
            Self::MaterialOpacity => "Opacity",
            Self::LightIntensity => "Light Intensity",
            Self::LightColorR | Self::LightColorG | Self::LightColorB => "Light Color",
            Self::LightRange => "Light Range",
        }
    }
}

/// A single keyframe: a (time, value) pair with an interpolation mode.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    /// Time in seconds from clip start.
    pub time: f32,
    /// The property value at this keyframe.
    pub value: f32,
    /// How to interpolate FROM this keyframe TO the next.
    pub interpolation: Interpolation,
}

/// Interpolation mode between keyframes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Interpolation {
    /// Instant jump to value (no interpolation).
    Step,
    /// Linear interpolation.
    #[default]
    Linear,
    /// Cubic ease-in (slow start, fast end).
    EaseIn,
    /// Cubic ease-out (fast start, slow end).
    EaseOut,
    /// Cubic ease-in-out (slow start and end).
    EaseInOut,
}

/// Clip playback behavior.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlayMode {
    /// Play once and stop at the end.
    Once,
    /// Loop from end back to start.
    #[default]
    Loop,
    /// Play forward then backward repeatedly.
    PingPong,
}

// ---- Interpolation Evaluation ----

impl AnimationClipData {
    /// Evaluate a track at the current playback time.
    /// Returns None if the track has fewer than 1 keyframe.
    pub fn evaluate_track(&self, track: &AnimationTrack) -> Option<f32> {
        if track.keyframes.is_empty() {
            return None;
        }
        if track.keyframes.len() == 1 {
            return Some(track.keyframes[0].value);
        }

        let t = self.current_time;

        // Before first keyframe: hold first value
        if t <= track.keyframes[0].time {
            return Some(track.keyframes[0].value);
        }

        // After last keyframe: hold last value
        let last = &track.keyframes[track.keyframes.len() - 1];
        if t >= last.time {
            return Some(last.value);
        }

        // Find surrounding keyframes
        for i in 0..track.keyframes.len() - 1 {
            let kf_a = &track.keyframes[i];
            let kf_b = &track.keyframes[i + 1];
            if t >= kf_a.time && t <= kf_b.time {
                let segment_duration = kf_b.time - kf_a.time;
                if segment_duration <= f32::EPSILON {
                    return Some(kf_b.value);
                }
                let local_t = (t - kf_a.time) / segment_duration;
                let eased_t = apply_easing(local_t, &kf_a.interpolation);
                return Some(kf_a.value + (kf_b.value - kf_a.value) * eased_t);
            }
        }

        Some(last.value)
    }
}

/// Apply easing function to a normalized t value [0, 1].
pub fn apply_easing(t: f32, interpolation: &Interpolation) -> f32 {
    match interpolation {
        Interpolation::Step => 0.0, // Hold previous value until next keyframe
        Interpolation::Linear => t,
        Interpolation::EaseIn => t * t * t,
        Interpolation::EaseOut => {
            let inv = 1.0 - t;
            1.0 - inv * inv * inv
        }
        Interpolation::EaseInOut => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                let inv = -2.0 * t + 2.0;
                1.0 - inv * inv * inv / 2.0
            }
        }
    }
}

// ---- Authoring ----
//
// The operations the seven clip commands perform, written against the data
// alone so they are natively testable (the bridge that drains the queues is
// wasm32-only). Every one returns `Err` with a reason instead of silently doing
// nothing: a keyframe that cannot be found, a non-finite time, a duration of
// zero. The drain logs the reason; the command has already been answered `Ok`
// by then, which is the general shape of this engine (PF-1174 / #9278).

/// Two keyframe times closer than this are the same keyframe.
pub const KEYFRAME_TIME_EPSILON: f32 = 1e-4;

fn finite(name: &str, v: f32) -> Result<f32, String> {
    if v.is_finite() {
        Ok(v)
    } else {
        Err(format!("{name} must be finite, got {v}"))
    }
}

impl AnimationClipData {
    /// The track for `target`, created empty if the clip has none.
    pub fn track_mut_or_insert(&mut self, target: PropertyTarget) -> &mut AnimationTrack {
        if let Some(idx) = self.tracks.iter().position(|t| t.target == target) {
            return &mut self.tracks[idx];
        }
        self.tracks.push(AnimationTrack { target, keyframes: Vec::new() });
        self.tracks.last_mut().expect("just pushed")
    }

    /// Add a keyframe, or replace the value/interpolation of one already at
    /// (within `KEYFRAME_TIME_EPSILON` of) `time`. Keeps the track sorted.
    pub fn add_keyframe(
        &mut self,
        target: PropertyTarget,
        time: f32,
        value: f32,
        interpolation: Interpolation,
    ) -> Result<(), String> {
        let time = finite("time", time)?;
        let value = finite("value", value)?;
        if time < 0.0 {
            return Err(format!("time must be >= 0, got {time}"));
        }
        let track = self.track_mut_or_insert(target);
        if let Some(existing) = track.keyframes.iter_mut().find(|k| (k.time - time).abs() <= KEYFRAME_TIME_EPSILON) {
            existing.value = value;
            existing.interpolation = interpolation;
            return Ok(());
        }
        track.keyframes.push(Keyframe { time, value, interpolation });
        track.keyframes.sort_by(|a, b| a.time.total_cmp(&b.time));
        Ok(())
    }

    /// Remove the keyframe at `time`. A track left empty is dropped.
    pub fn remove_keyframe(&mut self, target: &PropertyTarget, time: f32) -> Result<(), String> {
        let time = finite("time", time)?;
        let Some(idx) = self.tracks.iter().position(|t| &t.target == target) else {
            return Err(format!("no track for {}", target.display_name()));
        };
        let track = &mut self.tracks[idx];
        let Some(k) = track.keyframes.iter().position(|k| (k.time - time).abs() <= KEYFRAME_TIME_EPSILON) else {
            return Err(format!("no keyframe at {time}s on {}", target.display_name()));
        };
        track.keyframes.remove(k);
        if track.keyframes.is_empty() {
            self.tracks.remove(idx);
        }
        Ok(())
    }

    /// Change the value, interpolation and/or time of the keyframe at `time`.
    /// A moved keyframe keeps the track sorted; moving onto another keyframe's
    /// time is refused rather than merged.
    pub fn update_keyframe(
        &mut self,
        target: &PropertyTarget,
        time: f32,
        new_value: Option<f32>,
        new_interpolation: Option<Interpolation>,
        new_time: Option<f32>,
    ) -> Result<(), String> {
        let time = finite("time", time)?;
        let Some(track) = self.tracks.iter_mut().find(|t| &t.target == target) else {
            return Err(format!("no track for {}", target.display_name()));
        };
        let Some(k) = track.keyframes.iter().position(|k| (k.time - time).abs() <= KEYFRAME_TIME_EPSILON) else {
            return Err(format!("no keyframe at {time}s on {}", target.display_name()));
        };
        if let Some(nt) = new_time {
            let nt = finite("newTime", nt)?;
            if nt < 0.0 {
                return Err(format!("newTime must be >= 0, got {nt}"));
            }
            let clash = track
                .keyframes
                .iter()
                .enumerate()
                .any(|(i, other)| i != k && (other.time - nt).abs() <= KEYFRAME_TIME_EPSILON);
            if clash {
                return Err(format!("a keyframe already sits at {nt}s on {}", target.display_name()));
            }
            track.keyframes[k].time = nt;
        }
        if let Some(v) = new_value {
            track.keyframes[k].value = finite("value", v)?;
        }
        if let Some(i) = new_interpolation {
            track.keyframes[k].interpolation = i;
        }
        track.keyframes.sort_by(|a, b| a.time.total_cmp(&b.time));
        Ok(())
    }

    /// Apply the clip-level properties `set_clip_property` carries. `None`
    /// leaves a field alone; that is how a partial update says "keep".
    pub fn apply_properties(
        &mut self,
        duration: Option<f32>,
        play_mode: Option<PlayMode>,
        speed: Option<f32>,
        autoplay: Option<bool>,
    ) -> Result<(), String> {
        if let Some(d) = duration {
            let d = finite("duration", d)?;
            if d <= 0.0 {
                return Err(format!("duration must be > 0, got {d}"));
            }
            self.duration = d;
            if self.current_time > d {
                self.current_time = d;
            }
        }
        if let Some(s) = speed {
            let s = finite("speed", s)?;
            if s < 0.0 {
                return Err(format!("speed must be >= 0, got {s}"));
            }
            self.speed = s;
        }
        if let Some(m) = play_mode {
            self.play_mode = m;
        }
        if let Some(a) = autoplay {
            self.autoplay = a;
        }
        Ok(())
    }

    /// The transport `preview_clip` drives: `play`, `pause`, `stop` (rewind)
    /// and `seek` (needs `seek_time`, clamped to the clip).
    pub fn preview(&mut self, action: &str, seek_time: Option<f32>) -> Result<(), String> {
        match action {
            "play" => {
                if self.play_mode == PlayMode::Once && self.current_time >= self.duration {
                    self.current_time = 0.0;
                }
                self.playing = true;
            }
            "pause" => self.playing = false,
            "stop" => {
                self.playing = false;
                self.current_time = 0.0;
                self.forward = true;
            }
            "seek" => {
                let t = seek_time.ok_or_else(|| "seek needs seekTime".to_string())?;
                let t = finite("seekTime", t)?;
                self.current_time = t.clamp(0.0, self.duration);
            }
            other => return Err(format!("unknown preview action '{other}' (play|pause|stop|seek)")),
        }
        Ok(())
    }

    /// Advance playback by `dt` seconds according to `play_mode`. A clip that
    /// is not playing is untouched. `Once` stops at the end; `Loop` wraps;
    /// `PingPong` reflects and flips direction.
    pub fn advance(&mut self, dt: f32) {
        if !self.playing || self.duration <= 0.0 || !dt.is_finite() {
            return;
        }
        let step = dt * self.speed;
        match self.play_mode {
            PlayMode::Once => {
                self.current_time += step;
                if self.current_time >= self.duration {
                    self.current_time = self.duration;
                    self.playing = false;
                }
            }
            PlayMode::Loop => {
                self.current_time = (self.current_time + step) % self.duration;
                if self.current_time < 0.0 {
                    self.current_time += self.duration;
                }
            }
            PlayMode::PingPong => {
                let mut t = if self.forward { self.current_time + step } else { self.current_time - step };
                // A large step can cross more than one end; reflect until inside.
                let mut guard = 0;
                while (t < 0.0 || t > self.duration) && guard < 64 {
                    if t > self.duration {
                        t = 2.0 * self.duration - t;
                        self.forward = false;
                    } else if t < 0.0 {
                        t = -t;
                        self.forward = true;
                    }
                    guard += 1;
                }
                self.current_time = t.clamp(0.0, self.duration);
            }
        }
    }

    /// Write every track's value at `current_time` into the channels it
    /// targets. Channels with no track are left alone, which is what lets a
    /// clip animate `position_y` while the gizmo still owns `position_x`.
    pub fn sample(
        &self,
        transform: &mut Transform,
        mut material: Option<&mut MaterialData>,
        mut light: Option<&mut LightData>,
    ) {
        let mut euler: Option<[f32; 3]> = None; // degrees, XYZ
        for track in &self.tracks {
            let Some(v) = self.evaluate_track(track) else { continue };
            match track.target {
                PropertyTarget::PositionX => transform.translation.x = v,
                PropertyTarget::PositionY => transform.translation.y = v,
                PropertyTarget::PositionZ => transform.translation.z = v,
                PropertyTarget::RotationX | PropertyTarget::RotationY | PropertyTarget::RotationZ => {
                    let e = euler.get_or_insert_with(|| {
                        let (x, y, z) = transform.rotation.to_euler(EulerRot::XYZ);
                        [x.to_degrees(), y.to_degrees(), z.to_degrees()]
                    });
                    match track.target {
                        PropertyTarget::RotationX => e[0] = v,
                        PropertyTarget::RotationY => e[1] = v,
                        _ => e[2] = v,
                    }
                }
                PropertyTarget::ScaleX => transform.scale.x = v,
                PropertyTarget::ScaleY => transform.scale.y = v,
                PropertyTarget::ScaleZ => transform.scale.z = v,
                PropertyTarget::MaterialBaseColorR => set_material(&mut material, |m| m.base_color[0] = v),
                PropertyTarget::MaterialBaseColorG => set_material(&mut material, |m| m.base_color[1] = v),
                PropertyTarget::MaterialBaseColorB => set_material(&mut material, |m| m.base_color[2] = v),
                // Opacity IS the base colour's alpha in `MaterialData`; the two
                // channels are one number and the later track wins.
                PropertyTarget::MaterialBaseColorA | PropertyTarget::MaterialOpacity => {
                    set_material(&mut material, |m| m.base_color[3] = v)
                }
                PropertyTarget::MaterialEmissiveR => set_material(&mut material, |m| m.emissive[0] = v),
                PropertyTarget::MaterialEmissiveG => set_material(&mut material, |m| m.emissive[1] = v),
                PropertyTarget::MaterialEmissiveB => set_material(&mut material, |m| m.emissive[2] = v),
                PropertyTarget::MaterialMetallic => set_material(&mut material, |m| m.metallic = v),
                PropertyTarget::MaterialRoughness => {
                    set_material(&mut material, |m| m.perceptual_roughness = v)
                }
                PropertyTarget::LightIntensity => set_light(&mut light, |l| l.intensity = v),
                PropertyTarget::LightColorR => set_light(&mut light, |l| l.color[0] = v),
                PropertyTarget::LightColorG => set_light(&mut light, |l| l.color[1] = v),
                PropertyTarget::LightColorB => set_light(&mut light, |l| l.color[2] = v),
                PropertyTarget::LightRange => set_light(&mut light, |l| l.range = v),
            }
        }
        if let Some(e) = euler {
            transform.rotation =
                Quat::from_euler(EulerRot::XYZ, e[0].to_radians(), e[1].to_radians(), e[2].to_radians());
        }
    }
}

fn set_material(material: &mut Option<&mut MaterialData>, f: impl FnOnce(&mut MaterialData)) {
    if let Some(m) = material.as_deref_mut() {
        f(m);
    }
}

fn set_light(light: &mut Option<&mut LightData>, f: impl FnOnce(&mut LightData)) {
    if let Some(l) = light.as_deref_mut() {
        f(l);
    }
}

// ---- Playback systems ----

/// Registers keyframe-clip playback. Unconditional in both builds: an exported
/// game's autoplay clips are the whole point of authoring one. Lives in `core`
/// so the systems run under native `cargo test`.
pub struct AnimationClipPlugin;

impl Plugin for AnimationClipPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(
            Update,
            (autoplay_clips_on_play, advance_animation_clips)
                .chain()
                .after(EditorApplySet),
        );
    }
}

/// On the Edit→Play edge, start every clip marked `autoplay` from the top.
/// Play→Edit needs nothing: the mode snapshot restores the authored clip.
pub fn autoplay_clips_on_play(
    mode: Res<EngineMode>,
    mut last: Local<Option<EngineMode>>,
    mut clips: Query<&mut AnimationClipData>,
) {
    let now = *mode;
    let was = last.replace(now);
    if was == Some(EngineMode::Edit) && now == EngineMode::Play {
        for mut clip in clips.iter_mut() {
            if clip.autoplay {
                clip.playing = true;
                clip.current_time = 0.0;
                clip.forward = true;
            }
        }
    }
}

/// Advance every playing clip and write its channels; a clip that changed this
/// frame without playing (a seek, a pause, an authoring edit) is sampled once
/// so the viewport shows the scrubbed pose. Runs in both modes: preview in Edit
/// is the timeline's whole job.
pub fn advance_animation_clips(
    time: Res<Time>,
    mode: Res<EngineMode>,
    mut clips: Query<(
        &mut AnimationClipData,
        &mut Transform,
        Option<&mut MaterialData>,
        Option<&mut LightData>,
    )>,
) {
    // Edit mode intentionally samples authored preview/seek changes, while a
    // paused game must freeze both its clock and its rendered pose.
    if *mode == EngineMode::Paused {
        return;
    }

    let dt = time.delta_secs();
    for (mut clip, mut transform, material, light) in clips.iter_mut() {
        let touched = clip.is_changed();
        if clip.playing {
            clip.advance(dt);
        } else if !touched {
            continue;
        }
        clip.sample(&mut transform, material.map(|m| m.into_inner()), light.map(|l| l.into_inner()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip_with(target: PropertyTarget, keys: &[(f32, f32)]) -> AnimationClipData {
        let mut clip = AnimationClipData::default();
        for (t, v) in keys {
            clip.add_keyframe(target.clone(), *t, *v, Interpolation::Linear).unwrap();
        }
        clip
    }

    // === Authoring (PF-1174 / #9278) ===

    #[test]
    fn add_keyframe_keeps_the_track_sorted_and_replaces_a_coincident_time() {
        let mut clip = clip_with(PropertyTarget::PositionX, &[(2.0, 20.0), (0.0, 0.0), (1.0, 10.0)]);
        let times: Vec<f32> = clip.tracks[0].keyframes.iter().map(|k| k.time).collect();
        assert_eq!(times, vec![0.0, 1.0, 2.0]);
        clip.add_keyframe(PropertyTarget::PositionX, 1.00001, 99.0, Interpolation::Step).unwrap();
        assert_eq!(clip.tracks[0].keyframes.len(), 3, "a coincident time replaces, never duplicates");
        assert_eq!(clip.tracks[0].keyframes[1].value, 99.0);
        assert_eq!(clip.tracks[0].keyframes[1].interpolation, Interpolation::Step);
        assert_eq!(clip.tracks.len(), 1);
    }

    #[test]
    fn add_keyframe_refuses_non_finite_and_negative_input() {
        let mut clip = AnimationClipData::default();
        assert!(clip.add_keyframe(PropertyTarget::ScaleX, f32::NAN, 1.0, Interpolation::Linear).is_err());
        assert!(clip.add_keyframe(PropertyTarget::ScaleX, 0.0, f32::INFINITY, Interpolation::Linear).is_err());
        assert!(clip.add_keyframe(PropertyTarget::ScaleX, -0.5, 1.0, Interpolation::Linear).is_err());
        assert!(clip.tracks.is_empty(), "a refused keyframe must not leave an empty track behind");
    }

    #[test]
    fn remove_keyframe_drops_an_emptied_track_and_names_a_missing_one() {
        let mut clip = clip_with(PropertyTarget::LightIntensity, &[(0.0, 1.0)]);
        let err = clip.remove_keyframe(&PropertyTarget::LightIntensity, 5.0).unwrap_err();
        assert!(err.contains("no keyframe at 5s"), "{err}");
        let err = clip.remove_keyframe(&PropertyTarget::PositionX, 0.0).unwrap_err();
        assert!(err.contains("no track"), "{err}");
        clip.remove_keyframe(&PropertyTarget::LightIntensity, 0.0).unwrap();
        assert!(clip.tracks.is_empty());
    }

    #[test]
    fn update_keyframe_moves_in_time_resorts_and_refuses_a_clash() {
        let mut clip = clip_with(PropertyTarget::PositionY, &[(0.0, 0.0), (1.0, 10.0), (2.0, 20.0)]);
        clip.update_keyframe(&PropertyTarget::PositionY, 0.0, Some(5.0), Some(Interpolation::EaseIn), Some(1.5)).unwrap();
        let times: Vec<f32> = clip.tracks[0].keyframes.iter().map(|k| k.time).collect();
        assert_eq!(times, vec![1.0, 1.5, 2.0]);
        assert_eq!(clip.tracks[0].keyframes[1].value, 5.0);
        assert_eq!(clip.tracks[0].keyframes[1].interpolation, Interpolation::EaseIn);
        let err = clip.update_keyframe(&PropertyTarget::PositionY, 1.5, None, None, Some(2.0)).unwrap_err();
        assert!(err.contains("already sits at 2s"), "{err}");
        // The refused move changed nothing.
        let times: Vec<f32> = clip.tracks[0].keyframes.iter().map(|k| k.time).collect();
        assert_eq!(times, vec![1.0, 1.5, 2.0]);
    }

    #[test]
    fn apply_properties_validates_and_clamps_the_playhead() {
        let mut clip = AnimationClipData::default();
        clip.current_time = 1.8;
        assert!(clip.apply_properties(Some(0.0), None, None, None).is_err());
        assert!(clip.apply_properties(None, None, Some(-1.0), None).is_err());
        clip.apply_properties(Some(1.0), Some(PlayMode::Once), Some(2.0), Some(false)).unwrap();
        assert_eq!((clip.duration, clip.speed, clip.autoplay), (1.0, 2.0, false));
        assert_eq!(clip.play_mode, PlayMode::Once);
        assert_eq!(clip.current_time, 1.0, "a shortened clip pulls the playhead inside it");
    }

    #[test]
    fn preview_drives_the_transport() {
        let mut clip = AnimationClipData::default();
        clip.preview("play", None).unwrap();
        assert!(clip.playing);
        clip.preview("seek", Some(1.5)).unwrap();
        assert_eq!(clip.current_time, 1.5);
        clip.preview("seek", Some(99.0)).unwrap();
        assert_eq!(clip.current_time, clip.duration, "seek clamps to the clip");
        clip.preview("pause", None).unwrap();
        assert!(!clip.playing);
        assert_eq!(clip.current_time, clip.duration);
        clip.preview("stop", None).unwrap();
        assert!(!clip.playing);
        assert_eq!(clip.current_time, 0.0);
        assert!(clip.preview("seek", None).is_err());
        assert!(clip.preview("rewind", None).is_err());
        // A finished Once clip restarts on play rather than sitting at the end.
        clip.play_mode = PlayMode::Once;
        clip.current_time = clip.duration;
        clip.preview("play", None).unwrap();
        assert_eq!(clip.current_time, 0.0);
    }

    // === Playback ===

    #[test]
    fn advance_once_stops_at_the_end() {
        let mut clip = AnimationClipData { play_mode: PlayMode::Once, playing: true, ..Default::default() };
        clip.advance(1.5);
        assert!(clip.playing);
        assert_eq!(clip.current_time, 1.5);
        clip.advance(1.0);
        assert!(!clip.playing, "Once stops itself");
        assert_eq!(clip.current_time, clip.duration);
    }

    #[test]
    fn advance_loop_wraps_and_honours_speed() {
        let mut clip = AnimationClipData { playing: true, speed: 2.0, ..Default::default() }; // Loop, 2s
        clip.advance(0.5);
        assert!((clip.current_time - 1.0).abs() < 1e-6);
        clip.advance(0.75);
        assert!((clip.current_time - 0.5).abs() < 1e-6, "2.5s of clip time wraps to 0.5s");
        assert!(clip.playing);
    }

    #[test]
    fn advance_ping_pong_reflects_and_flips() {
        let mut clip = AnimationClipData { play_mode: PlayMode::PingPong, playing: true, ..Default::default() };
        clip.advance(1.5);
        assert!((clip.current_time - 1.5).abs() < 1e-6);
        assert!(clip.forward);
        clip.advance(1.0); // would reach 2.5: reflect to 1.5, now heading back
        assert!((clip.current_time - 1.5).abs() < 1e-6);
        assert!(!clip.forward);
        clip.advance(2.0); // would reach -0.5: reflect to 0.5, forward again
        assert!((clip.current_time - 0.5).abs() < 1e-6);
        assert!(clip.forward);
    }

    #[test]
    fn advance_ignores_a_stopped_clip_and_a_non_finite_dt() {
        let mut clip = AnimationClipData::default();
        clip.advance(1.0);
        assert_eq!(clip.current_time, 0.0);
        clip.playing = true;
        clip.advance(f32::NAN);
        assert_eq!(clip.current_time, 0.0);
    }

    #[test]
    fn sample_writes_only_the_channels_that_have_tracks() {
        let mut clip = clip_with(PropertyTarget::PositionY, &[(0.0, 0.0), (2.0, 10.0)]);
        clip.add_keyframe(PropertyTarget::RotationZ, 0.0, 0.0, Interpolation::Linear).unwrap();
        clip.add_keyframe(PropertyTarget::RotationZ, 2.0, 90.0, Interpolation::Linear).unwrap();
        clip.add_keyframe(PropertyTarget::MaterialOpacity, 0.0, 1.0, Interpolation::Linear).unwrap();
        clip.add_keyframe(PropertyTarget::MaterialOpacity, 2.0, 0.0, Interpolation::Linear).unwrap();
        clip.add_keyframe(PropertyTarget::LightIntensity, 0.0, 100.0, Interpolation::Linear).unwrap();
        clip.current_time = 1.0;

        let mut transform = Transform::from_xyz(7.0, 0.0, 3.0);
        let mut material = MaterialData::default();
        let mut light = LightData::point();
        clip.sample(&mut transform, Some(&mut material), Some(&mut light));

        assert_eq!(transform.translation.x, 7.0, "x has no track and keeps the gizmo's value");
        assert!((transform.translation.y - 5.0).abs() < 1e-5);
        assert_eq!(transform.translation.z, 3.0);
        let (_, _, z) = transform.rotation.to_euler(EulerRot::XYZ);
        assert!((z.to_degrees() - 45.0).abs() < 1e-3, "rotation channels are Euler degrees");
        assert!((material.base_color[3] - 0.5).abs() < 1e-5, "opacity is the base colour alpha");
        assert_eq!(light.intensity, 100.0);

        // No material or light on the entity: the material/light tracks are skipped, not a panic.
        clip.sample(&mut transform, None, None);
    }

    /// The two systems, driven through a real `Schedule`: an Edit→Play edge
    /// starts autoplay clips, and a playing clip moves its entity every frame.
    #[test]
    fn autoplay_starts_on_the_play_edge_and_the_sampler_moves_the_entity() {
        let mut world = World::new();
        world.insert_resource(EngineMode::Edit);
        let mut time = Time::<()>::default();
        time.advance_by(std::time::Duration::from_millis(500));
        world.insert_resource(time);
        let clip = clip_with(PropertyTarget::PositionX, &[(0.0, 0.0), (2.0, 10.0)]);
        let entity = world.spawn((clip, Transform::default())).id();
        let mut schedule = Schedule::default();
        schedule.add_systems((autoplay_clips_on_play, advance_animation_clips).chain());

        // Edit: nothing plays, nothing moves.
        schedule.run(&mut world);
        assert!(!world.get::<AnimationClipData>(entity).unwrap().playing);

        // Edit→Play: autoplay starts the clip from the top, then this frame's
        // dt (0.5s at speed 1 on a 2s linear ramp to 10) moves x to 2.5.
        world.insert_resource(EngineMode::Play);
        let mut time = Time::<()>::default();
        time.advance_by(std::time::Duration::from_millis(500));
        world.insert_resource(time);
        schedule.run(&mut world);
        let clip = world.get::<AnimationClipData>(entity).unwrap();
        assert!(clip.playing, "autoplay did not start on the Edit→Play edge");
        assert!((clip.current_time - 0.5).abs() < 1e-6);
        let x = world.get::<Transform>(entity).unwrap().translation.x;
        assert!((x - 2.5).abs() < 1e-5, "sampler wrote {x}, expected 2.5");

        // Staying in Play does not restart it.
        schedule.run(&mut world);
        assert!((world.get::<AnimationClipData>(entity).unwrap().current_time - 1.0).abs() < 1e-6);
    }

    #[test]
    fn engine_pause_freezes_a_playing_clip_and_its_pose() {
        let mut world = World::new();
        world.insert_resource(EngineMode::Paused);
        let mut time = Time::<()>::default();
        time.advance_by(std::time::Duration::from_millis(500));
        world.insert_resource(time);
        let mut clip = clip_with(PropertyTarget::PositionX, &[(0.0, 0.0), (2.0, 10.0)]);
        clip.playing = true;
        clip.current_time = 0.5;
        let entity = world.spawn((clip, Transform::from_xyz(2.5, 0.0, 0.0))).id();
        let mut schedule = Schedule::default();
        schedule.add_systems(advance_animation_clips);

        schedule.run(&mut world);

        assert!((world.get::<AnimationClipData>(entity).unwrap().current_time - 0.5).abs() < 1e-6);
        assert!((world.get::<Transform>(entity).unwrap().translation.x - 2.5).abs() < 1e-6);
    }

    #[test]
    fn a_paused_clip_is_sampled_once_when_it_changes() {
        let mut world = World::new();
        world.insert_resource(EngineMode::Edit);
        let mut time = Time::<()>::default();
        time.advance_by(std::time::Duration::from_millis(16));
        world.insert_resource(time);
        let clip = clip_with(PropertyTarget::PositionX, &[(0.0, 0.0), (2.0, 10.0)]);
        let entity = world.spawn((clip, Transform::default())).id();
        let mut schedule = Schedule::default();
        schedule.add_systems(advance_animation_clips);

        schedule.run(&mut world); // fresh component counts as changed: sampled at t=0
        assert_eq!(world.get::<Transform>(entity).unwrap().translation.x, 0.0);
        world.get_mut::<Transform>(entity).unwrap().translation.x = 42.0;
        schedule.run(&mut world); // unchanged clip: the gizmo's write survives
        assert_eq!(world.get::<Transform>(entity).unwrap().translation.x, 42.0);
        world.get_mut::<AnimationClipData>(entity).unwrap().preview("seek", Some(1.0)).unwrap();
        schedule.run(&mut world); // a scrub is sampled once even though nothing plays
        assert!((world.get::<Transform>(entity).unwrap().translation.x - 5.0).abs() < 1e-5);
    }

    #[test]
    fn test_linear_interpolation() {
        let clip = AnimationClipData {
            tracks: vec![],
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 1.0,
            forward: true,
            autoplay: true,
        };

        let track = AnimationTrack {
            target: PropertyTarget::PositionX,
            keyframes: vec![
                Keyframe {
                    time: 0.0,
                    value: 0.0,
                    interpolation: Interpolation::Linear,
                },
                Keyframe {
                    time: 2.0,
                    value: 10.0,
                    interpolation: Interpolation::Linear,
                },
            ],
        };

        let value = clip.evaluate_track(&track).unwrap();
        assert!((value - 5.0).abs() < 0.01); // At t=1.0, should be halfway (5.0)
    }

    #[test]
    fn test_step_interpolation() {
        let clip = AnimationClipData {
            tracks: vec![],
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 1.0,
            forward: true,
            autoplay: true,
        };

        let track = AnimationTrack {
            target: PropertyTarget::PositionX,
            keyframes: vec![
                Keyframe {
                    time: 0.0,
                    value: 0.0,
                    interpolation: Interpolation::Step,
                },
                Keyframe {
                    time: 2.0,
                    value: 10.0,
                    interpolation: Interpolation::Step,
                },
            ],
        };

        let value = clip.evaluate_track(&track).unwrap();
        assert!((value - 0.0).abs() < 0.01); // Step holds previous value
    }

    #[test]
    fn test_ease_in_out() {
        let t_mid = 0.5;
        let eased = apply_easing(t_mid, &Interpolation::EaseInOut);
        // At t=0.5, ease-in-out should be exactly 0.5 (midpoint symmetry)
        assert!((eased - 0.5).abs() < 0.01);

        let t_quarter = 0.25;
        let eased_quarter = apply_easing(t_quarter, &Interpolation::EaseInOut);
        // At t=0.25, ease-in-out should be < 0.25 (slow start)
        assert!(eased_quarter < 0.25);
    }

    #[test]
    fn test_single_keyframe() {
        let clip = AnimationClipData {
            tracks: vec![],
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 1.0,
            forward: true,
            autoplay: true,
        };

        let track = AnimationTrack {
            target: PropertyTarget::PositionX,
            keyframes: vec![Keyframe {
                time: 0.0,
                value: 5.0,
                interpolation: Interpolation::Linear,
            }],
        };

        let value = clip.evaluate_track(&track).unwrap();
        assert!((value - 5.0).abs() < 0.01); // Single keyframe holds constant
    }

    #[test]
    fn test_empty_track() {
        let clip = AnimationClipData {
            tracks: vec![],
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 1.0,
            forward: true,
            autoplay: true,
        };

        let track = AnimationTrack {
            target: PropertyTarget::PositionX,
            keyframes: vec![],
        };

        let value = clip.evaluate_track(&track);
        assert!(value.is_none()); // Empty track returns None
    }

    #[test]
    fn test_time_clamping() {
        let mut clip = AnimationClipData {
            tracks: vec![],
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 0.0,
            forward: true,
            autoplay: true,
        };

        let track = AnimationTrack {
            target: PropertyTarget::PositionX,
            keyframes: vec![
                Keyframe {
                    time: 1.0,
                    value: 5.0,
                    interpolation: Interpolation::Linear,
                },
                Keyframe {
                    time: 3.0,
                    value: 10.0,
                    interpolation: Interpolation::Linear,
                },
            ],
        };

        // Before first keyframe
        clip.current_time = 0.5;
        let value = clip.evaluate_track(&track).unwrap();
        assert!((value - 5.0).abs() < 0.01); // Holds first value

        // After last keyframe
        clip.current_time = 4.0;
        let value = clip.evaluate_track(&track).unwrap();
        assert!((value - 10.0).abs() < 0.01); // Holds last value
    }
}
