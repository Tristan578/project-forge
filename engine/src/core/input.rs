//! Input mapping system for Play mode.
//!
//! Maps browser keyboard/mouse events (via Bevy's ButtonInput) to named game
//! actions. Provides configurable presets (FPS, Platformer, TopDown, Racing)
//! and per-frame `InputState` that future scripting systems can query.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::engine_mode::{PlaySystemSet, in_play_mode};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// An input source: a keyboard key or mouse button identified by browser event.code string.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum InputSource {
    Key(String),
    MouseButton(String),
}

/// Whether an action is a simple digital button or a composite axis.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActionType {
    Digital,
    Axis {
        positive: Vec<InputSource>,
        negative: Vec<InputSource>,
    },
}

/// Definition of a single named action.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDef {
    pub name: String,
    pub action_type: ActionType,
    /// Sources for Digital actions (ignored for Axis).
    #[serde(default)]
    pub sources: Vec<InputSource>,
    /// Dead-zone for axis values (values below this snap to 0).
    #[serde(default = "default_dead_zone")]
    pub dead_zone: f32,
}

fn default_dead_zone() -> f32 { 0.1 }

/// Per-frame state for one action.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionValue {
    pub pressed: bool,
    pub just_pressed: bool,
    pub just_released: bool,
    pub axis_value: f32,
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/// The input binding configuration. Maps action name -> definition.
#[derive(Resource, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMap {
    pub actions: HashMap<String, ActionDef>,
    /// Which preset produced the current bindings (None = custom).
    pub preset: Option<String>,
}

/// Per-frame evaluated input state. Updated by `capture_input` in PlaySystemSet.
#[derive(Resource, Debug, Clone, Default, Serialize, Deserialize)]
pub struct InputState {
    pub actions: HashMap<String, ActionValue>,
}

impl InputState {
    pub fn is_action_active(&self, name: &str) -> bool {
        self.actions.get(name).map_or(false, |v| v.pressed)
    }

    pub fn is_action_just_pressed(&self, name: &str) -> bool {
        self.actions.get(name).map_or(false, |v| v.just_pressed)
    }

    pub fn get_axis(&self, name: &str) -> f32 {
        self.actions.get(name).map_or(0.0, |v| v.axis_value)
    }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/// Built-in input preset names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum InputPreset {
    FPS,
    Platformer,
    TopDown,
    Racing,
}

impl InputPreset {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "fps" => Some(Self::FPS),
            "platformer" => Some(Self::Platformer),
            "topdown" | "top_down" => Some(Self::TopDown),
            "racing" => Some(Self::Racing),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FPS => "fps",
            Self::Platformer => "platformer",
            Self::TopDown => "topdown",
            Self::Racing => "racing",
        }
    }

    pub fn default_bindings(&self) -> InputMap {
        let mut map = InputMap {
            actions: HashMap::new(),
            preset: Some(self.as_str().to_string()),
        };

        match self {
            Self::FPS => {
                // Movement axes
                map.actions.insert("move_forward".into(), ActionDef {
                    name: "move_forward".into(),
                    action_type: ActionType::Axis {
                        positive: vec![InputSource::Key("KeyW".into())],
                        negative: vec![InputSource::Key("KeyS".into())],
                    },
                    sources: vec![],
                    dead_zone: 0.1,
                });
                map.actions.insert("move_right".into(), ActionDef {
                    name: "move_right".into(),
                    action_type: ActionType::Axis {
                        positive: vec![InputSource::Key("KeyD".into())],
                        negative: vec![InputSource::Key("KeyA".into())],
                    },
                    sources: vec![],
                    dead_zone: 0.1,
                });
                // Digital actions
                map.actions.insert("jump".into(), digital("jump", vec!["Space"]));
                map.actions.insert("sprint".into(), digital("sprint", vec!["ShiftLeft"]));
                map.actions.insert("crouch".into(), digital("crouch", vec!["ControlLeft"]));
                map.actions.insert("interact".into(), digital("interact", vec!["KeyE"]));
                map.actions.insert("fire".into(), ActionDef {
                    name: "fire".into(),
                    action_type: ActionType::Digital,
                    sources: vec![InputSource::MouseButton("Left".into())],
                    dead_zone: 0.1,
                });
                map.actions.insert("aim".into(), ActionDef {
                    name: "aim".into(),
                    action_type: ActionType::Digital,
                    sources: vec![InputSource::MouseButton("Right".into())],
                    dead_zone: 0.1,
                });
            }
            Self::Platformer => {
                map.actions.insert("move_horizontal".into(), ActionDef {
                    name: "move_horizontal".into(),
                    action_type: ActionType::Axis {
                        positive: vec![InputSource::Key("KeyD".into()), InputSource::Key("ArrowRight".into())],
                        negative: vec![InputSource::Key("KeyA".into()), InputSource::Key("ArrowLeft".into())],
                    },
                    sources: vec![],
                    dead_zone: 0.1,
                });
                map.actions.insert("jump".into(), digital("jump", vec!["Space", "ArrowUp", "KeyW"]));
                map.actions.insert("crouch".into(), digital("crouch", vec!["ArrowDown", "KeyS"]));
                map.actions.insert("attack".into(), digital("attack", vec!["KeyZ", "KeyJ"]));
                map.actions.insert("special".into(), digital("special", vec!["KeyX", "KeyK"]));
            }
            Self::TopDown => {
                map.actions.insert("move_vertical".into(), ActionDef {
                    name: "move_vertical".into(),
                    action_type: ActionType::Axis {
                        positive: vec![InputSource::Key("KeyW".into()), InputSource::Key("ArrowUp".into())],
                        negative: vec![InputSource::Key("KeyS".into()), InputSource::Key("ArrowDown".into())],
                    },
                    sources: vec![],
                    dead_zone: 0.1,
                });
                map.actions.insert("move_horizontal".into(), ActionDef {
                    name: "move_horizontal".into(),
                    action_type: ActionType::Axis {
                        positive: vec![InputSource::Key("KeyD".into()), InputSource::Key("ArrowRight".into())],
                        negative: vec![InputSource::Key("KeyA".into()), InputSource::Key("ArrowLeft".into())],
                    },
                    sources: vec![],
                    dead_zone: 0.1,
                });
                map.actions.insert("action1".into(), digital("action1", vec!["Space"]));
                map.actions.insert("action2".into(), digital("action2", vec!["KeyE"]));
                map.actions.insert("fire".into(), ActionDef {
                    name: "fire".into(),
                    action_type: ActionType::Digital,
                    sources: vec![InputSource::MouseButton("Left".into())],
                    dead_zone: 0.1,
                });
            }
            Self::Racing => {
                map.actions.insert("throttle".into(), digital("throttle", vec!["KeyW", "ArrowUp"]));
                map.actions.insert("brake".into(), digital("brake", vec!["KeyS", "ArrowDown"]));
                map.actions.insert("steer".into(), ActionDef {
                    name: "steer".into(),
                    action_type: ActionType::Axis {
                        positive: vec![InputSource::Key("KeyD".into()), InputSource::Key("ArrowRight".into())],
                        negative: vec![InputSource::Key("KeyA".into()), InputSource::Key("ArrowLeft".into())],
                    },
                    sources: vec![],
                    dead_zone: 0.1,
                });
                map.actions.insert("nitro".into(), digital("nitro", vec!["ShiftLeft", "Space"]));
                map.actions.insert("reset".into(), digital("reset", vec!["KeyR"]));
            }
        }

        map
    }
}

/// Helper to make a Digital ActionDef from key code strings.
fn digital(name: &str, keys: Vec<&str>) -> ActionDef {
    ActionDef {
        name: name.to_string(),
        action_type: ActionType::Digital,
        sources: keys.into_iter().map(|k| InputSource::Key(k.to_string())).collect(),
        dead_zone: 0.1,
    }
}

// ---------------------------------------------------------------------------
// Key mapping
// ---------------------------------------------------------------------------

/// Map a browser `event.code` string to a Bevy `KeyCode`.
pub fn keycode_from_str(code: &str) -> Option<KeyCode> {
    Some(match code {
        // Letters
        "KeyA" => KeyCode::KeyA,
        "KeyB" => KeyCode::KeyB,
        "KeyC" => KeyCode::KeyC,
        "KeyD" => KeyCode::KeyD,
        "KeyE" => KeyCode::KeyE,
        "KeyF" => KeyCode::KeyF,
        "KeyG" => KeyCode::KeyG,
        "KeyH" => KeyCode::KeyH,
        "KeyI" => KeyCode::KeyI,
        "KeyJ" => KeyCode::KeyJ,
        "KeyK" => KeyCode::KeyK,
        "KeyL" => KeyCode::KeyL,
        "KeyM" => KeyCode::KeyM,
        "KeyN" => KeyCode::KeyN,
        "KeyO" => KeyCode::KeyO,
        "KeyP" => KeyCode::KeyP,
        "KeyQ" => KeyCode::KeyQ,
        "KeyR" => KeyCode::KeyR,
        "KeyS" => KeyCode::KeyS,
        "KeyT" => KeyCode::KeyT,
        "KeyU" => KeyCode::KeyU,
        "KeyV" => KeyCode::KeyV,
        "KeyW" => KeyCode::KeyW,
        "KeyX" => KeyCode::KeyX,
        "KeyY" => KeyCode::KeyY,
        "KeyZ" => KeyCode::KeyZ,
        // Numbers
        "Digit0" => KeyCode::Digit0,
        "Digit1" => KeyCode::Digit1,
        "Digit2" => KeyCode::Digit2,
        "Digit3" => KeyCode::Digit3,
        "Digit4" => KeyCode::Digit4,
        "Digit5" => KeyCode::Digit5,
        "Digit6" => KeyCode::Digit6,
        "Digit7" => KeyCode::Digit7,
        "Digit8" => KeyCode::Digit8,
        "Digit9" => KeyCode::Digit9,
        // Arrows
        "ArrowUp" => KeyCode::ArrowUp,
        "ArrowDown" => KeyCode::ArrowDown,
        "ArrowLeft" => KeyCode::ArrowLeft,
        "ArrowRight" => KeyCode::ArrowRight,
        // Modifiers / common
        "Space" => KeyCode::Space,
        "ShiftLeft" => KeyCode::ShiftLeft,
        "ShiftRight" => KeyCode::ShiftRight,
        "ControlLeft" => KeyCode::ControlLeft,
        "ControlRight" => KeyCode::ControlRight,
        "AltLeft" => KeyCode::AltLeft,
        "AltRight" => KeyCode::AltRight,
        "Tab" => KeyCode::Tab,
        "Escape" => KeyCode::Escape,
        "Enter" => KeyCode::Enter,
        "Backspace" => KeyCode::Backspace,
        _ => return None,
    })
}

/// Map a browser mouse button name to a Bevy `MouseButton`.
fn mouse_button_from_str(name: &str) -> Option<MouseButton> {
    match name {
        "Left" => Some(MouseButton::Left),
        "Right" => Some(MouseButton::Right),
        "Middle" => Some(MouseButton::Middle),
        _ => None,
    }
}

/// Check if an `InputSource` is currently pressed.
fn is_source_pressed(
    source: &InputSource,
    keys: &ButtonInput<KeyCode>,
    mouse: &ButtonInput<MouseButton>,
) -> bool {
    match source {
        InputSource::Key(code) => {
            keycode_from_str(code).map_or(false, |kc| keys.pressed(kc))
        }
        InputSource::MouseButton(name) => {
            mouse_button_from_str(name).map_or(false, |mb| mouse.pressed(mb))
        }
    }
}

/// Check if an `InputSource` was just pressed this frame.
fn is_source_just_pressed(
    source: &InputSource,
    keys: &ButtonInput<KeyCode>,
    mouse: &ButtonInput<MouseButton>,
) -> bool {
    match source {
        InputSource::Key(code) => {
            keycode_from_str(code).map_or(false, |kc| keys.just_pressed(kc))
        }
        InputSource::MouseButton(name) => {
            mouse_button_from_str(name).map_or(false, |mb| mouse.just_pressed(mb))
        }
    }
}

/// Check if an `InputSource` was just released this frame.
fn is_source_just_released(
    source: &InputSource,
    keys: &ButtonInput<KeyCode>,
    mouse: &ButtonInput<MouseButton>,
) -> bool {
    match source {
        InputSource::Key(code) => {
            keycode_from_str(code).map_or(false, |kc| keys.just_released(kc))
        }
        InputSource::MouseButton(name) => {
            mouse_button_from_str(name).map_or(false, |mb| mouse.just_released(mb))
        }
    }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

/// Bevy system that reads keyboard/mouse state and evaluates InputMap → InputState.
/// Runs in PlaySystemSet (only during active Play mode).
pub fn capture_input(
    input_map: Res<InputMap>,
    mut input_state: ResMut<InputState>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
) {
    input_state.actions.clear();

    for (action_name, def) in &input_map.actions {
        let value = match &def.action_type {
            ActionType::Digital => {
                let pressed = def.sources.iter().any(|s| is_source_pressed(s, &keys, &mouse));
                let just_pressed = def.sources.iter().any(|s| is_source_just_pressed(s, &keys, &mouse));
                let just_released = def.sources.iter().any(|s| is_source_just_released(s, &keys, &mouse));
                ActionValue {
                    pressed,
                    just_pressed,
                    just_released,
                    axis_value: if pressed { 1.0 } else { 0.0 },
                }
            }
            ActionType::Axis { positive, negative } => {
                let pos = positive.iter().any(|s| is_source_pressed(s, &keys, &mouse));
                let neg = negative.iter().any(|s| is_source_pressed(s, &keys, &mouse));
                let raw: f32 = match (pos, neg) {
                    (true, false) => 1.0,
                    (false, true) => -1.0,
                    _ => 0.0, // both or neither
                };
                let axis_value: f32 = if raw.abs() < def.dead_zone { 0.0 } else { raw };
                let pressed = axis_value.abs() > 0.0;
                let just_pressed = (positive.iter().any(|s| is_source_just_pressed(s, &keys, &mouse)))
                    || (negative.iter().any(|s| is_source_just_pressed(s, &keys, &mouse)));
                let just_released = (positive.iter().any(|s| is_source_just_released(s, &keys, &mouse)))
                    || (negative.iter().any(|s| is_source_just_released(s, &keys, &mouse)));
                ActionValue { pressed, just_pressed, just_released, axis_value }
            }
        };

        input_state.actions.insert(action_name.clone(), value);
    }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/// Plugin that registers input resources and the capture system.
pub struct InputPlugin;

impl Plugin for InputPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<InputMap>()
            .init_resource::<InputState>()
            .configure_sets(Update, PlaySystemSet.run_if(in_play_mode))
            .add_systems(Update, capture_input.in_set(PlaySystemSet));
    }
}
