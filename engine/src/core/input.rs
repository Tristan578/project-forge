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
///
/// TWO LOCAL PLAYERS (OP-04). `actions`/`preset` are player 0 — the only player
/// a single-player scene ever has, and the shape every scene authored before
/// this carried. `players` holds slot 1 and up, each an independently editable
/// action map with its own preset provenance. It is `#[serde(default,
/// skip_serializing_if = "HashMap::is_empty")]` so a one-player scene serializes
/// and loads byte-for-byte as it always did — the field simply is not there —
/// and every existing template, saved project and remix keeps its bindings.
/// Two local players share one physical keyboard, so independence comes from
/// each slot binding its own keys (player 1 on WASD, player 2 on the arrows,
/// say); `capture_input` evaluates every slot's map against the same key state
/// into its own `InputState` slot, and nothing forces the two to agree.
#[derive(Resource, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMap {
    pub actions: HashMap<String, ActionDef>,
    /// Which starting set produced these bindings (None = the creator's own).
    pub preset: Option<String>,
    /// Additional local players (slot 1+). Slot 0 is `actions`/`preset` above.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub players: HashMap<u8, PlayerBindings>,
}

/// One local player's action map plus its preset provenance. Slot 0 lives on
/// `InputMap` directly (`actions`/`preset`); slots 1+ are `PlayerBindings` so a
/// second player's map is edited, rebound and persisted exactly like the first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerBindings {
    pub actions: HashMap<String, ActionDef>,
    /// Which starting set produced this slot's bindings (None = the creator's own).
    pub preset: Option<String>,
}

impl InputMap {
    /// The action map for one local player slot (0 = the primary/top-level map).
    /// `None` when slot >= 1 has never been given a binding.
    pub fn actions_for(&self, player: u8) -> Option<&HashMap<String, ActionDef>> {
        if player == 0 {
            Some(&self.actions)
        } else {
            self.players.get(&player).map(|p| &p.actions)
        }
    }

    /// Mutable action map for a slot, creating the slot for player >= 1 if absent.
    fn actions_for_mut(&mut self, player: u8) -> &mut HashMap<String, ActionDef> {
        if player == 0 {
            &mut self.actions
        } else {
            &mut self.players.entry(player).or_default().actions
        }
    }

    /// Write one binding into a slot and mark that slot the creator's own
    /// (`preset = None`), exactly as the single-player path always has.
    pub fn set_binding(&mut self, player: u8, def: ActionDef) {
        self.actions_for_mut(player).insert(def.name.clone(), def);
        self.set_preset(player, None);
    }

    /// Remove one binding from a slot. Returns whether anything was removed. A
    /// slot that does not exist removes nothing and is not created. Removing a
    /// player 1+ slot's LAST binding drops the whole `players` entry rather than
    /// leaving an empty one behind — `player_slots()` reads `players.keys()`
    /// directly, so a lingering empty entry reported a "ghost" occupied slot
    /// with nothing bound to it.
    pub fn remove_binding(&mut self, player: u8, name: &str) -> bool {
        let removed = if player == 0 {
            self.actions.remove(name).is_some()
        } else if let Some(p) = self.players.get_mut(&player) {
            p.actions.remove(name).is_some()
        } else {
            false
        };
        if removed {
            let now_empty = player != 0
                && self.players.get(&player).is_some_and(|p| p.actions.is_empty());
            if now_empty {
                self.players.remove(&player);
            } else {
                self.set_preset(player, None);
            }
        }
        removed
    }

    /// Merge a preset's bindings into a slot. Additive — the preset's own
    /// definitions win where names collide, and nothing already in the slot is
    /// discarded — identical to the single-player merge in `InputPlugin`.
    pub fn apply_preset(&mut self, player: u8, preset: InputPreset) {
        let bindings = preset.default_bindings().actions;
        let map = self.actions_for_mut(player);
        for (name, action) in bindings {
            map.insert(name, action);
        }
        self.set_preset(player, Some(preset.as_str().to_string()));
    }

    /// The preset provenance of a slot (`None` = the creator's own bindings).
    pub fn preset_for(&self, player: u8) -> Option<&str> {
        if player == 0 {
            self.preset.as_deref()
        } else {
            self.players.get(&player).and_then(|p| p.preset.as_deref())
        }
    }

    fn set_preset(&mut self, player: u8, preset: Option<String>) {
        if player == 0 {
            self.preset = preset;
        } else {
            self.players.entry(player).or_default().preset = preset;
        }
    }

    /// Every occupied local-player slot, ascending, always including slot 0.
    pub fn player_slots(&self) -> Vec<u8> {
        let mut slots: Vec<u8> = self.players.keys().copied().collect();
        slots.push(0);
        slots.sort_unstable();
        slots.dedup();
        slots
    }
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

        Self { actions, preset: None, players: HashMap::new() }
    }
}

/// Per-frame evaluated input state. Updated by `capture_input` in PlaySystemSet.
///
/// `actions` is player 0. `players` holds slot 1+ so a script can ask for either
/// local player's state; it is `#[serde(default, skip_serializing_if)]` so a
/// single-player session's serialized state is unchanged. The `*_for(player, …)`
/// accessors resolve any slot; the bare `is_action_active`/`get_axis` are player
/// 0 shorthands kept so every existing caller reads exactly what it did before.
#[derive(Resource, Debug, Clone, Default, Serialize, Deserialize)]
pub struct InputState {
    pub actions: HashMap<String, ActionValue>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub players: HashMap<u8, HashMap<String, ActionValue>>,
}

impl InputState {
    /// The evaluated action values for one player slot (0 = primary).
    fn slot(&self, player: u8) -> Option<&HashMap<String, ActionValue>> {
        if player == 0 {
            Some(&self.actions)
        } else {
            self.players.get(&player)
        }
    }

    pub fn is_action_active(&self, name: &str) -> bool {
        self.is_action_active_for(0, name)
    }

    pub fn is_action_active_for(&self, player: u8, name: &str) -> bool {
        self.slot(player).and_then(|s| s.get(name)).map_or(false, |v| v.pressed)
    }

    pub fn is_action_just_pressed(&self, name: &str) -> bool {
        self.is_action_just_pressed_for(0, name)
    }

    pub fn is_action_just_pressed_for(&self, player: u8, name: &str) -> bool {
        self.slot(player).and_then(|s| s.get(name)).map_or(false, |v| v.just_pressed)
    }

    pub fn get_axis(&self, name: &str) -> f32 {
        self.get_axis_for(0, name)
    }

    pub fn get_axis_for(&self, player: u8, name: &str) -> f32 {
        self.slot(player).and_then(|s| s.get(name)).map_or(0.0, |v| v.axis_value)
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
            players: HashMap::new(),
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

/// Evaluate one action map against the current key/mouse state.
///
/// Shared by every local-player slot: two players' maps are evaluated by the
/// same code against the same `ButtonInput`, so their independence is entirely a
/// matter of binding different keys — nothing here couples one slot to another.
fn evaluate_actions(
    actions: &HashMap<String, ActionDef>,
    keys: &ButtonInput<KeyCode>,
    mouse: &ButtonInput<MouseButton>,
) -> HashMap<String, ActionValue> {
    let mut out = HashMap::with_capacity(actions.len());
    for (action_name, def) in actions {
        let value = match &def.action_type {
            ActionType::Digital => {
                let pressed = def.sources.iter().any(|s| is_source_pressed(s, keys, mouse));
                let just_pressed = def.sources.iter().any(|s| is_source_just_pressed(s, keys, mouse));
                let just_released = def.sources.iter().any(|s| is_source_just_released(s, keys, mouse));
                ActionValue {
                    pressed,
                    just_pressed,
                    just_released,
                    axis_value: if pressed { 1.0 } else { 0.0 },
                }
            }
            ActionType::Axis { positive, negative } => {
                let pos = positive.iter().any(|s| is_source_pressed(s, keys, mouse));
                let neg = negative.iter().any(|s| is_source_pressed(s, keys, mouse));
                let raw: f32 = match (pos, neg) {
                    (true, false) => 1.0,
                    (false, true) => -1.0,
                    _ => 0.0, // both or neither
                };
                let axis_value: f32 = if raw.abs() < def.dead_zone { 0.0 } else { raw };
                let pressed = axis_value.abs() > 0.0;
                let just_pressed = (positive.iter().any(|s| is_source_just_pressed(s, keys, mouse)))
                    || (negative.iter().any(|s| is_source_just_pressed(s, keys, mouse)));
                let just_released = (positive.iter().any(|s| is_source_just_released(s, keys, mouse)))
                    || (negative.iter().any(|s| is_source_just_released(s, keys, mouse)));
                ActionValue { pressed, just_pressed, just_released, axis_value }
            }
        };
        out.insert(action_name.clone(), value);
    }
    out
}

/// Bevy system that reads keyboard/mouse state and evaluates InputMap → InputState.
/// Runs in PlaySystemSet (only during active Play mode).
///
/// Every local-player slot is evaluated independently: player 0 into
/// `input_state.actions`, each additional slot into `input_state.players`.
pub fn capture_input(
    input_map: Res<InputMap>,
    mut input_state: ResMut<InputState>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
) {
    input_state.actions = evaluate_actions(&input_map.actions, &keys, &mouse);

    // Rebuild slots 1+ from scratch each frame so a slot whose bindings were all
    // removed stops reporting stale values.
    input_state.players.clear();
    for (slot, bindings) in &input_map.players {
        input_state
            .players
            .insert(*slot, evaluate_actions(&bindings.actions, &keys, &mouse));
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

    // -----------------------------------------------------------------------
    // OP-04: two independent local-player input maps (physics.FR-1.OP-04)
    // -----------------------------------------------------------------------

    /// A FRESH MAP HAS ONLY PLAYER 0, AND THE OMITTED-PLAYER PATH RESOLVES TO IT.
    ///
    /// The whole backward-compatibility promise rests on this: a scene authored
    /// before two-player support has no `players`, so slot 0 is the top-level
    /// `actions` and any slot >= 1 is simply absent. A command or script that
    /// names no player is player 0.
    #[test]
    fn op04_a_fresh_map_has_only_player_zero() {
        let map = InputMap::default();
        assert!(map.actions_for(0).is_some(), "slot 0 is always the top-level map");
        assert!(map.actions_for(1).is_none(), "a fresh map has no second player");
        assert_eq!(map.player_slots(), vec![0], "only slot 0 is occupied");
        // The player-0 shorthand and the explicit slot-0 accessor are the same map.
        assert_eq!(
            map.actions_for(0).unwrap().len(),
            map.actions.len(),
        );
    }

    /// TWO PLAYERS EACH GET AN INDEPENDENTLY EDITABLE ACTION MAP.
    ///
    /// Writing player 2's `attack` must not touch player 1's, and vice versa —
    /// the concrete OP-04 capability: two maps that are edited separately.
    #[test]
    fn op04_two_players_have_independent_action_maps() {
        let mut map = InputMap::default();
        map.set_binding(0, digital("attack", vec!["KeyF"]));
        map.set_binding(1, digital("attack", vec!["Numpad0"]));

        assert_eq!(
            map.actions_for(0).unwrap()["attack"].sources,
            vec![InputSource::Key("KeyF".into())],
        );
        assert_eq!(
            map.actions_for(1).unwrap()["attack"].sources,
            vec![InputSource::Key("Numpad0".into())],
        );
        assert_eq!(map.player_slots(), vec![0, 1]);
    }

    /// REBINDING PLAYER 1 DOES NOT MUTATE PLAYER 2's ActionDef.
    #[test]
    fn op04_rebinding_player_one_leaves_player_two_untouched() {
        let mut map = InputMap::default();
        map.set_binding(0, digital("attack", vec!["KeyA"]));
        map.set_binding(1, digital("attack", vec!["KeyB"]));

        // Player 1 (slot 0) rebinds attack to a third key.
        map.set_binding(0, digital("attack", vec!["KeyC"]));

        assert_eq!(
            map.actions_for(0).unwrap()["attack"].sources,
            vec![InputSource::Key("KeyC".into())],
            "player 1's rebind takes effect",
        );
        assert_eq!(
            map.actions_for(1).unwrap()["attack"].sources,
            vec![InputSource::Key("KeyB".into())],
            "player 2's binding must be untouched by player 1's rebind",
        );
    }

    /// REMOVING A BINDING IS PER-SLOT.
    #[test]
    fn op04_removing_a_binding_is_scoped_to_its_slot() {
        let mut map = InputMap::default();
        map.set_binding(0, digital("grab", vec!["KeyE"]));
        map.set_binding(1, digital("grab", vec!["KeyP"]));
        // A second binding on player 2 so removing "grab" leaves the slot
        // occupied — the empty-slot case has its own dedicated test below.
        map.set_binding(1, digital("jump", vec!["KeyO"]));

        assert!(map.remove_binding(1, "grab"), "player 2's grab is removed");
        assert!(
            map.actions_for(0).unwrap().contains_key("grab"),
            "player 1's grab survives player 2's removal",
        );
        assert!(!map.actions_for(1).unwrap().contains_key("grab"));
        // Removing from a slot that never existed removes nothing and creates nothing.
        assert!(!map.remove_binding(5, "grab"));
        assert!(map.actions_for(5).is_none());
    }

    /// REMOVING A SLOT'S LAST BINDING DROPS THE SLOT — NO GHOST ENTRY.
    ///
    /// Regression for a bug where `remove_binding` cleared a player 1+ slot's
    /// `actions` map but left the (now-empty) `players` entry behind.
    /// `player_slots()` reads `players.keys()` directly, so that empty entry
    /// kept reporting the slot as occupied with nothing bound to it.
    #[test]
    fn op04_removing_the_last_binding_drops_the_ghost_slot() {
        let mut map = InputMap::default();
        map.set_binding(1, digital("grab", vec!["KeyP"]));
        assert_eq!(map.player_slots(), vec![0, 1], "player 2 is occupied");

        assert!(map.remove_binding(1, "grab"), "player 2's only binding is removed");

        assert_eq!(
            map.player_slots(),
            vec![0],
            "player 2's slot must not linger empty once its last binding is gone",
        );
        assert!(
            map.actions_for(1).is_none(),
            "an emptied slot reads exactly like one that was never bound",
        );
        assert_eq!(map.preset_for(1), None);
    }

    /// PRESSING PLAYER 1's KEY DOES NOT AFFECT PLAYER 2's ActionValue.
    ///
    /// This is the boundary scenario from the fixture, evaluated end to end
    /// against a real `ButtonInput`. Both players name `attack`; player 1 binds
    /// it to A, player 2 to the left arrow. Holding A lights player 1's `attack`
    /// alone.
    #[test]
    fn op04_pressing_one_players_key_does_not_cross_to_the_other() {
        let mut map = InputMap::default();
        map.set_binding(0, digital("attack", vec!["KeyA"]));
        map.set_binding(1, digital("attack", vec!["ArrowLeft"]));

        let mut keys = ButtonInput::<KeyCode>::default();
        keys.press(KeyCode::KeyA);
        let mouse = ButtonInput::<MouseButton>::default();

        // Assemble state exactly as `capture_input` does.
        let mut state = InputState::default();
        state.actions = evaluate_actions(map.actions_for(0).unwrap(), &keys, &mouse);
        for slot in map.player_slots().into_iter().filter(|s| *s != 0) {
            state
                .players
                .insert(slot, evaluate_actions(map.actions_for(slot).unwrap(), &keys, &mouse));
        }

        assert!(state.is_action_active_for(0, "attack"), "player 1 pressed A");
        assert!(
            !state.is_action_active_for(1, "attack"),
            "player 2 is on the arrow key and must read as not pressed",
        );
        // The bare shorthand is player 0.
        assert!(state.is_action_active("attack"));
    }

    /// AXIS INDEPENDENCE: two players' analogue movement do not bleed together.
    #[test]
    fn op04_axis_values_are_per_player() {
        let mut map = InputMap::default();
        map.set_binding(0, axis("move", vec!["KeyD"], vec!["KeyA"]));
        map.set_binding(1, axis("move", vec!["ArrowRight"], vec!["ArrowLeft"]));

        let mut keys = ButtonInput::<KeyCode>::default();
        keys.press(KeyCode::KeyD); // player 1 right
        keys.press(KeyCode::ArrowLeft); // player 2 left
        let mouse = ButtonInput::<MouseButton>::default();

        let mut state = InputState::default();
        state.actions = evaluate_actions(map.actions_for(0).unwrap(), &keys, &mouse);
        state
            .players
            .insert(1, evaluate_actions(map.actions_for(1).unwrap(), &keys, &mouse));

        assert_eq!(state.get_axis_for(0, "move"), 1.0, "player 1 steers right");
        assert_eq!(state.get_axis_for(1, "move"), -1.0, "player 2 steers left");
    }

    /// A PRESET APPLIED TO PLAYER 2 STAYS ON PLAYER 2.
    #[test]
    fn op04_apply_preset_is_scoped_to_its_slot() {
        let mut map = InputMap::default();
        map.set_binding(0, digital("grapple", vec!["KeyG"]));

        map.apply_preset(1, InputPreset::Platformer);

        assert!(
            map.actions_for(1).unwrap().contains_key("attack"),
            "the preset's bindings land on player 2",
        );
        assert!(
            !map.actions_for(0).unwrap().contains_key("attack"),
            "player 1 does not gain the preset's bindings",
        );
        assert!(
            map.actions_for(0).unwrap().contains_key("grapple"),
            "player 1 keeps its own vocabulary",
        );
        assert_eq!(map.preset_for(1), Some("platformer"));
        assert_eq!(map.preset_for(0), None);
    }

    /// AN EDIT MARKS ONLY ITS OWN SLOT CUSTOM.
    #[test]
    fn op04_editing_one_slot_does_not_clear_the_others_preset() {
        let mut map = InputMap::default();
        map.apply_preset(0, InputPreset::FPS);
        map.apply_preset(1, InputPreset::Platformer);
        assert_eq!(map.preset_for(0), Some("fps"));
        assert_eq!(map.preset_for(1), Some("platformer"));

        map.set_binding(1, digital("attack", vec!["KeyZ"]));
        assert_eq!(map.preset_for(1), None, "player 2 is now custom");
        assert_eq!(map.preset_for(0), Some("fps"), "player 1's provenance is untouched");
    }

    /// PERSISTENCE / FRESH-SESSION REOPEN: a two-player map round-trips through
    /// the exact serde path the scene file uses, and slots survive.
    #[test]
    fn op04_two_player_map_survives_a_serde_round_trip() {
        let mut map = InputMap::default();
        map.set_binding(1, digital("attack", vec!["ArrowUp"]));
        map.apply_preset(1, InputPreset::Racing);

        let json = serde_json::to_string(&map).expect("serialize");
        assert!(json.contains("\"players\""), "the second player is persisted");

        let restored: InputMap = serde_json::from_str(&json).expect("deserialize");
        assert!(restored.actions_for(1).is_some(), "player 2 survives reopen");
        assert!(restored.actions_for(1).unwrap().contains_key("throttle"));
        assert_eq!(restored.preset_for(1), Some("racing"));
    }

    /// BACKWARD COMPATIBILITY: the shape every one-player scene carries has no
    /// `players` key, parses to an empty player set, and re-serializes WITHOUT a
    /// `players` key — so no existing scene's saved bytes change.
    #[test]
    fn op04_single_player_scene_shape_is_unchanged() {
        let legacy = r#"{"actions":{},"preset":null}"#;
        let map: InputMap = serde_json::from_str(legacy).expect("legacy shape must parse");
        assert!(map.players.is_empty());
        assert_eq!(map.player_slots(), vec![0]);

        let json = serde_json::to_string(&map).expect("serialize");
        assert!(
            !json.contains("players"),
            "an empty player set must not appear in the serialized scene",
        );
    }
}
