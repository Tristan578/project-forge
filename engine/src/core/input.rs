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
///
/// ACTIONS ARE AUTHORED, NOT CHOSEN FROM A LIST. This is a free map of names a
/// creator invents — `grapple`, `possess`, `rewind`, `p2_attack` — each bound to
/// whatever keys or mouse buttons they like. `set_input_binding` writes one,
/// `remove_input_binding` deletes one, the scene file persists the whole map,
/// and `InputBindingsPanel` edits it. Nothing here knows what genre a game is,
/// and nothing may make a creator's vocabulary depend on one.
///
/// `preset` records which starting set the map CAME from. It is provenance, not
/// a constraint: a preset is a handful of rows written into `actions` once,
/// after which it has no further say.
#[derive(Resource, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMap {
    pub actions: HashMap<String, ActionDef>,
    /// Which starting set produced these bindings (None = the creator's own).
    pub preset: Option<String>,
}

impl Default for InputMap {
    /// A new scene starts with a WORKING KEYBOARD.
    ///
    /// It used to start with `actions: HashMap::new()` — nothing bound at all —
    /// so a brand-new project ignored every key until its creator found the
    /// input panel, and `forge.input.isPressed(...)` answered false for every
    /// name in it. The only thing that ever populated the map was a genre
    /// preset, which made "pick a genre" the price of having input.
    ///
    /// These names describe the INPUT, not a kind of game. `move_up` is the up
    /// key; whether that means jumping, walking north, accelerating, or moving
    /// a menu cursor is the creator's business. Both readings of the vertical
    /// axis are bound to the same keys — `move_up`/`move_down` and
    /// `move_forward`/`move_backward` — because W is "up" in a top-down game and
    /// "forward" in a first-person one, and neither reading should be the one
    /// that silently fails.
    ///
    /// Every row here is ordinary data: rename it, rebind it, delete it. It is a
    /// starting point so nothing is broken before a creator has made a single
    /// decision — not a vocabulary they are stuck inside.
    fn default() -> Self {
        let mut actions = HashMap::new();

        // Axes, for continuous movement.
        actions.insert("move_horizontal".into(), axis(
            "move_horizontal",
            vec!["KeyD", "ArrowRight"],
            vec!["KeyA", "ArrowLeft"],
        ));
        actions.insert("move_vertical".into(), axis(
            "move_vertical",
            vec!["KeyW", "ArrowUp"],
            vec!["KeyS", "ArrowDown"],
        ));

        // The same four keys as DIGITAL actions. A script asking "is left held"
        // should not have to know an axis's sign convention, and an axis cannot
        // answer it anyway: `pressed` on `move_horizontal` is true for left AND
        // right. That is exactly how `isPressed('move_forward')` came to mean
        // "W or S" under the old fps preset.
        actions.insert("move_left".into(), digital("move_left", vec!["KeyA", "ArrowLeft"]));
        actions.insert("move_right".into(), digital("move_right", vec!["KeyD", "ArrowRight"]));
        actions.insert("move_up".into(), digital("move_up", vec!["KeyW", "ArrowUp"]));
        actions.insert("move_down".into(), digital("move_down", vec!["KeyS", "ArrowDown"]));

        // The same keys again under their depth reading, so a 3D game and a 2D
        // game can each say what they mean without one of them being wrong.
        actions.insert("move_forward".into(), digital("move_forward", vec!["KeyW", "ArrowUp"]));
        actions.insert("move_backward".into(), digital("move_backward", vec!["KeyS", "ArrowDown"]));

        // Verbs, named for the button rather than for what one genre calls it.
        actions.insert("jump".into(), digital("jump", vec!["Space"]));
        actions.insert("interact".into(), digital("interact", vec!["KeyE"]));
        actions.insert("pause".into(), digital("pause", vec!["Escape"]));
        actions.insert("action_primary".into(), ActionDef {
            name: "action_primary".into(),
            action_type: ActionType::Digital,
            sources: vec![
                InputSource::MouseButton("Left".into()),
                InputSource::Key("KeyJ".into()),
            ],
            dead_zone: 0.1,
        });
        actions.insert("action_secondary".into(), ActionDef {
            name: "action_secondary".into(),
            action_type: ActionType::Digital,
            sources: vec![
                InputSource::MouseButton("Right".into()),
                InputSource::Key("KeyK".into()),
            ],
            dead_zone: 0.1,
        });

        Self { actions, preset: None }
    }
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

/// Helper to make an Axis ActionDef from key code strings.
///
/// `sources` stays empty for an axis: `capture_input` reads `positive`/`negative`
/// and never looks at it, so filling it in would suggest a second binding that
/// does nothing.
fn axis(name: &str, positive: Vec<&str>, negative: Vec<&str>) -> ActionDef {
    ActionDef {
        name: name.to_string(),
        action_type: ActionType::Axis {
            positive: positive.into_iter().map(|k| InputSource::Key(k.to_string())).collect(),
            negative: negative.into_iter().map(|k| InputSource::Key(k.to_string())).collect(),
        },
        sources: vec![],
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

#[cfg(test)]
mod tests {
    use super::*;

    /// THE DEFAULT IS A WORKING KEYBOARD, not an empty map.
    ///
    /// `InputMap::default()` was `HashMap::new()`, so a brand-new project
    /// ignored every key and `forge.input.isPressed(...)` answered false for
    /// every name a script could pass. Nothing else in the engine populated the
    /// map — only a genre preset did — which made choosing a genre the price of
    /// having input at all.
    #[test]
    fn a_new_input_map_binds_something() {
        let map = InputMap::default();
        assert!(
            !map.actions.is_empty(),
            "a new scene must respond to the keyboard before anyone picks a genre"
        );
    }

    /// The names scripts, templates and both AI prompts actually use. Each of
    /// these was defined by NO preset, so every movement script in the product
    /// was reading an action that did not exist.
    #[test]
    fn the_default_binds_every_name_the_product_uses() {
        let map = InputMap::default();
        for action in [
            "move_left", "move_right", "move_up", "move_down",
            "move_forward", "move_backward",
            "move_horizontal", "move_vertical",
            "jump", "interact", "pause",
            "action_primary", "action_secondary",
        ] {
            assert!(map.actions.contains_key(action), "default is missing {action}");
        }
    }

    /// `move_left` must be DIGITAL, not a side of an axis.
    ///
    /// An axis reports `pressed` whenever it is non-zero, so asking an axis
    /// "is left held" answers true for left AND right. That is exactly how
    /// `isPressed("move_forward")` came to mean "W or S" under the old fps
    /// preset, and why the directional names have to exist in their own right.
    #[test]
    fn the_directional_names_are_digital_actions() {
        let map = InputMap::default();
        for action in ["move_left", "move_right", "move_up", "move_down"] {
            assert!(
                matches!(map.actions[action].action_type, ActionType::Digital),
                "{action} must be digital so it can answer for one direction alone"
            );
        }
    }

    /// The two readings of the vertical axis share keys on purpose: W is "up"
    /// in a top-down game and "forward" in a first-person one, and a creator
    /// should not discover that one of them silently does nothing.
    #[test]
    fn up_and_forward_are_the_same_keys() {
        let map = InputMap::default();
        assert_eq!(map.actions["move_up"].sources, map.actions["move_forward"].sources);
        assert_eq!(map.actions["move_down"].sources, map.actions["move_backward"].sources);
    }

    /// A default map is nobody's genre.
    #[test]
    fn the_default_claims_no_preset() {
        assert_eq!(InputMap::default().preset, None);
    }

    /// APPLYING A PRESET MUST NOT DESTROY WHAT THE CREATOR HAS.
    ///
    /// It used to be `*input_map = preset.default_bindings()`, so choosing a
    /// starting point wiped every action the project had — the working defaults
    /// and anything authored by hand. A preset is a convenience; it may add and
    /// it may override a name it defines, and nothing more.
    #[test]
    fn a_preset_adds_to_the_map_rather_than_replacing_it() {
        let mut map = InputMap::default();
        map.actions.insert("grapple".into(), digital("grapple", vec!["KeyG"]));

        for (name, action) in InputPreset::Platformer.default_bindings().actions {
            map.actions.insert(name, action);
        }

        assert!(
            map.actions.contains_key("grapple"),
            "a creator's own action must survive picking a starting point"
        );
        assert!(
            map.actions.contains_key("move_left"),
            "the default vocabulary must survive it too"
        );
        assert!(
            map.actions.contains_key("attack"),
            "and the preset's own bindings must arrive"
        );
    }


    /// A SCENE FILE THAT DECLARES NO ACTIONS MUST NOT SILENCE THE KEYBOARD.
    ///
    /// `#[serde(default)]` on `SceneFile::input_bindings` covers a file that
    /// OMITS the field, and that is not what exists in the wild: every scene the
    /// product saved before this carries the literal `{ actions: {}, preset:
    /// null }` that `templateSceneFile` wrote to satisfy a parser which then
    /// required it. `load_scene` assigns the map verbatim, so those projects —
    /// and every remix of a published one — would load into a session where no
    /// key does anything.
    #[test]
    fn an_empty_declared_map_deserializes_and_is_recognisable_as_empty() {
        let map: InputMap = serde_json::from_str(r#"{"actions":{},"preset":null}"#)
            .expect("the shape every saved scene carries must still parse");
        assert!(
            map.actions.is_empty(),
            "load_scene relies on this being detectably empty to fall back"
        );
    }

    /// The other half: a file that says nothing gets the defaults from serde,
    /// so the fallback in `load_scene` is not the only thing standing between a
    /// creator and a working keyboard.
    #[test]
    fn an_absent_map_deserializes_to_the_defaults() {
        #[derive(serde::Deserialize)]
        struct Holder {
            #[serde(default)]
            input_bindings: InputMap,
        }
        let held: Holder = serde_json::from_str("{}").expect("absent is legal");
        assert!(!held.input_bindings.actions.is_empty());
    }

    /// A declared map with actions in it is taken at its word — the fallback
    /// must not swallow a creator's own vocabulary.
    #[test]
    fn a_declared_map_survives_the_round_trip() {
        let json = r#"{"actions":{"grapple":{"name":"grapple","actionType":{"type":"Digital"},"sources":[{"type":"Key","value":"KeyG"}],"deadZone":0.1}},"preset":null}"#;
        let map: InputMap = serde_json::from_str(json).expect("a declared map must parse");
        assert_eq!(map.actions.len(), 1);
        assert!(map.actions.contains_key("grapple"));
    }

    /// The preset's definition wins where the names collide, or "apply a preset"
    /// would be a no-op for anything the default already names.
    #[test]
    fn a_preset_overrides_a_name_it_defines() {
        let mut map = InputMap::default();
        let preset = InputPreset::Platformer.default_bindings();
        let preset_jump = preset.actions["jump"].clone();

        for (name, action) in preset.actions {
            map.actions.insert(name, action);
        }

        assert_eq!(map.actions["jump"].sources, preset_jump.sources);
    }
}
