//! Keyframe property animation system.
//!
//! Allows animating any numeric entity property over time with user-defined
//! keyframes and interpolation curves. Separate from Bevy's skeletal animation.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

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

    // --- apply_easing: EaseIn ---

    #[test]
    fn test_ease_in_starts_slow() {
        // EaseIn = t^3: at t=0.5, result < 0.5 (still accelerating)
        let eased = apply_easing(0.5, &Interpolation::EaseIn);
        assert!(eased < 0.5, "EaseIn at t=0.5 should be below midpoint, got {}", eased);
    }

    #[test]
    fn test_ease_in_boundary_values() {
        assert!((apply_easing(0.0, &Interpolation::EaseIn) - 0.0).abs() < 1e-5);
        assert!((apply_easing(1.0, &Interpolation::EaseIn) - 1.0).abs() < 1e-5);
    }

    // --- apply_easing: EaseOut ---

    #[test]
    fn test_ease_out_ends_slow() {
        // EaseOut = 1 - (1-t)^3: at t=0.5, result > 0.5 (fast start, slow end)
        let eased = apply_easing(0.5, &Interpolation::EaseOut);
        assert!(eased > 0.5, "EaseOut at t=0.5 should be above midpoint, got {}", eased);
    }

    #[test]
    fn test_ease_out_boundary_values() {
        assert!((apply_easing(0.0, &Interpolation::EaseOut) - 0.0).abs() < 1e-5);
        assert!((apply_easing(1.0, &Interpolation::EaseOut) - 1.0).abs() < 1e-5);
    }

    // --- PlayMode variant tests ---

    #[test]
    fn test_play_mode_once_variant_exists() {
        // Exercise all PlayMode variants via equality comparison (no runtime effect)
        assert_ne!(PlayMode::Once, PlayMode::Loop);
        assert_ne!(PlayMode::PingPong, PlayMode::Loop);
        assert_ne!(PlayMode::Once, PlayMode::PingPong);
    }

    // --- degenerate keyframe: zero-duration segment ---

    #[test]
    fn test_degenerate_zero_duration_segment_no_panic() {
        // Two keyframes at the same time: ensure no divide-by-zero panic occurs.
        // The implementation clamps to the first keyframe's value when t == kf_a.time.
        let clip = AnimationClipData {
            tracks: vec![],
            duration: 2.0,
            play_mode: PlayMode::Loop,
            playing: false,
            speed: 1.0,
            current_time: 1.0, // exactly at the degenerate keyframe time
            forward: true,
            autoplay: true,
        };
        let track = AnimationTrack {
            target: PropertyTarget::PositionX,
            keyframes: vec![
                Keyframe { time: 1.0, value: 5.0, interpolation: Interpolation::Linear },
                Keyframe { time: 1.0, value: 99.0, interpolation: Interpolation::Linear },
            ],
        };
        // Must not panic and must return a finite value
        let value = clip.evaluate_track(&track);
        assert!(value.is_some(), "degenerate segment should return Some");
        assert!(value.unwrap().is_finite(), "degenerate segment should return finite value");
    }

    #[test]
    fn test_degenerate_single_keyframe_holds_value_for_any_time() {
        // Single keyframe: any time should return the constant value
        let mut clip = AnimationClipData::default();
        let track = AnimationTrack {
            target: PropertyTarget::PositionY,
            keyframes: vec![
                Keyframe { time: 0.5, value: 42.0, interpolation: Interpolation::Linear },
            ],
        };
        for t in [0.0f32, 0.5, 1.0, 99.0] {
            clip.current_time = t;
            let v = clip.evaluate_track(&track).unwrap();
            assert!((v - 42.0).abs() < 0.01, "at t={}, expected 42.0, got {}", t, v);
        }
    }

    // --- EaseInOut boundary ---

    #[test]
    fn test_ease_in_out_boundary_values() {
        assert!((apply_easing(0.0, &Interpolation::EaseInOut) - 0.0).abs() < 1e-5);
        assert!((apply_easing(1.0, &Interpolation::EaseInOut) - 1.0).abs() < 1e-5);
    }

    // --- Step at boundaries ---

    #[test]
    fn test_step_always_returns_zero() {
        // Step easing always returns 0 (hold previous value)
        for t in [0.0f32, 0.001, 0.5, 0.999, 1.0] {
            let v = apply_easing(t, &Interpolation::Step);
            assert_eq!(v, 0.0, "Step at t={} should be 0.0, got {}", t, v);
        }
    }
}
