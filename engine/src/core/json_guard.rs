//! Size and depth bounds for JSON that reaches the engine from outside it.
//!
//! Every command payload is untrusted. It can come from the editor, from an MCP
//! client, from the AI orchestrator, or from a `.forge` file that was shared or
//! pulled off disk — and `dispatch` hands it to `serde_json::from_value::<T>`,
//! which recurses once per level of nesting with **no** limit of its own.
//! `serde_json::from_str` caps recursion at 128 levels; `from_value` does not,
//! because by then the `Value` already exists. So a payload nested a few hundred
//! thousand levels deep is a stack overflow, and on wasm32 a stack overflow is
//! an unrecoverable trap: the whole engine instance dies and the editor is left
//! with a canvas that will never draw again.
//!
//! Two bounds, both checked without recursing:
//!
//! - **Depth**, because that is what turns into stack frames.
//! - **Container count**, because a payload can be shallow and still carry
//!   enough structure to be expensive. Scalars are deliberately not counted —
//!   see [`MAX_COMMAND_PAYLOAD_CONTAINERS`] for why that distinction matters.
//!
//! Releasing the payload is a third recursion, and rejecting one is no use if
//! the rejection itself aborts — see [`drop_without_recursing`].
//!
//! ## What this cannot close
//!
//! On the wasm path the `Value` has already been built by
//! `serde_wasm_bindgen::from_value` before anything here runs, and that build
//! recurses per level with no limit either. Nothing in Rust runs early enough to
//! prevent it: the only place a deep structure can be refused before it becomes
//! a `Value` is the caller. That is why
//! `web/src/lib/engine/commandPayloadGuard.ts` enforces the same two numbers on
//! the TypeScript side, and why a test pins the two copies together rather than
//! trusting them to stay in step. This module is the backstop for every other
//! caller: batched commands, native tests, and any future host that is not the
//! browser.

use serde_json::Value;

/// Maximum nesting depth accepted in a command payload.
///
/// Real payloads are three or four levels deep; the deepest in the command set
/// is a cutscene track, at six. The bound is set far above that because the
/// point is to stop a stack overflow, not to police payload shape — a legal
/// command must never be refused by this.
pub const MAX_COMMAND_PAYLOAD_DEPTH: usize = 32;

/// Maximum number of containers (objects and arrays) in a command payload.
///
/// Containers are counted and scalars are not, and that distinction is the
/// whole point rather than an optimisation. A scalar adds no nesting and no
/// container of its own, so a wide run of numbers is cheap in exactly the way
/// this bound exists to police — and it is something the product legitimately
/// sends. `TilemapLayer.tiles` is a flat `(number | null)[]` of
/// `mapSize[0] * mapSize[1]` entries and the inspector permits 1000×1000 per
/// layer, so one ordinary tilemap edit carries up to a million scalars beneath
/// a handful of containers. The first version of this module counted every
/// JSON value against 50,000 and therefore refused every tilemap past roughly
/// 223×223 — a first-class editor feature, broken by a bound derived from an
/// assumed payload shape instead of the widest one the UI can build.
///
/// Structure is what stays bounded. 50,000 containers sits far above anything
/// in the command set — a waypoint list of ten thousand objects is 10,001 —
/// while still refusing an envelope whose sheer structure is the attack.
pub const MAX_COMMAND_PAYLOAD_CONTAINERS: usize = 50_000;

/// Maximum number of containers in a whole batch envelope.
///
/// The bridge caps a batch at 256 items and every item's payload is measured
/// against [`MAX_COMMAND_PAYLOAD_CONTAINERS`] by `dispatch` once it has been
/// safely extracted, so this is a coarse gate on the envelope rather than the
/// real per-payload limit.
pub const MAX_BATCH_CONTAINERS: usize = 200_000;

/// Maximum byte length of a JSON *text* the engine parses generically.
///
/// Distinct from the node bound above: this one guards the places that take
/// JSON as a string and call `from_str::<Value>` on it, where the cost is paid
/// in the parse itself. It deliberately does not apply to strings that merely
/// *travel* inside a payload (a base64 texture is legitimately megabytes) — only
/// to text that is about to be parsed as a structure.
///
/// Set well above any body the editor writes, because a `.forge` scene replays
/// its component property bags through this path every time it loads: a bound
/// tight enough to be interesting would stop previously-saved scenes opening.
pub const MAX_JSON_TEXT_BYTES: usize = 4_194_304;

/// Maximum byte length of a caller-supplied identifier that is echoed back.
///
/// Command names and component types arrive inside the payload and end up
/// interpolated into error strings that travel to JS and on into the monitoring
/// pipeline, so an unbounded name becomes an unbounded error. This is the same
/// cap the bridge already applies to the single-command path; batched items
/// never pass through it.
pub const MAX_IDENTIFIER_BYTES: usize = 128;

/// Reject a command payload that is nested too deeply or has too many values.
///
/// `what` names the caller in the error, since `dispatch` returns a bare
/// `String` and the response carries no other context.
///
/// Takes the payload by value and hands it back on success. That is not
/// ergonomics — it is the whole point. `Value`'s own `Drop` is recursive, so a
/// borrowing checker that merely returned `Err` would leave the caller holding a
/// deep value that overflows the stack the moment it goes out of scope, killing
/// the engine at the end of the very function that refused the payload. This was
/// not theoretical: the first version of this module aborted its own test
/// process on a 5,000-level input. Owning the value lets a rejection dismantle
/// it iteratively, so the refusal is survivable.
pub fn check_command_payload(what: &str, payload: Value) -> Result<Value, String> {
    match inspect(
        what,
        &payload,
        MAX_COMMAND_PAYLOAD_DEPTH,
        MAX_COMMAND_PAYLOAD_CONTAINERS,
    ) {
        Ok(()) => Ok(payload),
        Err(e) => {
            drop_without_recursing(payload);
            Err(e)
        }
    }
}

/// Walk a payload against the bounds without recursing.
///
/// The walk keeps its own stack, so checking a hostile payload cannot itself
/// overflow — which a recursive checker would, at exactly the depth it was
/// written to detect. Only containers go on that stack, and a container is
/// charged against the bound *before* it is pushed rather than after it is
/// popped, so a wide array of containers cannot grow the stack past the limit
/// before the limit is noticed.
///
/// The walk does still visit every scalar, because classifying a child is how
/// it learns the child is a scalar — so the time cost is proportional to the
/// size of the input, not to the bounds. That work is unavoidable, and is
/// already paid by whoever built the value in the first place; what the bounds
/// buy is that nothing is *allocated* in proportion to a hostile input.
fn inspect(
    what: &str,
    payload: &Value,
    max_depth: usize,
    max_containers: usize,
) -> Result<(), String> {
    fn is_container(value: &Value) -> bool {
        matches!(value, Value::Array(_) | Value::Object(_))
    }
    let too_deep = || format!("{} nested too deeply (over {} levels)", what, max_depth);
    let too_much = || {
        format!(
            "{} has too much structure (over {} objects and arrays)",
            what, max_containers
        )
    };

    // Depth is 1-based: a bare scalar is depth 1, `{"a": 1}` is depth 2.
    let mut stack: Vec<(&Value, usize)> = Vec::new();
    let mut containers: usize = 0;
    if is_container(payload) {
        containers = 1;
        stack.push((payload, 1));
    }

    // Charging before the push is what keeps the scratch stack bounded.
    macro_rules! charge {
        ($child:expr, $depth:expr) => {{
            let child: &Value = $child;
            if is_container(child) {
                containers += 1;
                if containers > max_containers {
                    return Err(too_much());
                }
                stack.push((child, $depth));
            } else if $depth > max_depth {
                return Err(too_deep());
            }
        }};
    }

    while let Some((value, depth)) = stack.pop() {
        if depth > max_depth {
            return Err(too_deep());
        }
        match value {
            Value::Array(items) => {
                for child in items {
                    charge!(child, depth + 1);
                }
            }
            Value::Object(map) => {
                for child in map.values() {
                    charge!(child, depth + 1);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Reject a whole batch envelope before any of it is walked or cloned.
///
/// `dispatch_batch` reads each item's `payload` with `.cloned()`, and cloning a
/// `Value` recurses exactly like deserializing one — so by the time the
/// per-command check in `dispatch` runs, the damage is already done. The
/// envelope has to be bounded first.
///
/// The bounds are deliberately looser than the per-payload ones rather than
/// equal to them, because this check is a coarse gate and not the real limit:
/// every item's payload is still measured against
/// [`MAX_COMMAND_PAYLOAD_DEPTH`] / [`MAX_COMMAND_PAYLOAD_CONTAINERS`] by `dispatch`
/// once it has been safely extracted. The two extra levels are the envelope's
/// own cost — the array, then the item object — so a payload that is legal on
/// its own is not refused merely for being batched.
pub fn check_command_batch(batch: Value) -> Result<Value, String> {
    match inspect(
        "batch",
        &batch,
        MAX_COMMAND_PAYLOAD_DEPTH + 2,
        MAX_BATCH_CONTAINERS,
    ) {
        Ok(()) => Ok(batch),
        Err(e) => {
            drop_without_recursing(batch);
            Err(e)
        }
    }
}

/// Drop a `Value` of any depth without recursing.
///
/// `Value`'s derived `Drop` walks its children on the call stack, so releasing a
/// deeply nested value overflows exactly like deserializing one — and unlike the
/// deserialize, there is no `Result` to return, so it is an unconditional abort.
/// Moving each child onto an explicit stack leaves every container empty before
/// it is released, which makes each individual drop shallow.
pub fn drop_without_recursing(value: Value) {
    let mut stack = vec![value];
    while let Some(value) = stack.pop() {
        match value {
            // `extend` moves the children out, so what remains is an empty
            // container that releases without touching anything.
            Value::Array(items) => stack.extend(items),
            Value::Object(map) => stack.extend(map.into_iter().map(|(_, v)| v)),
            _ => {}
        }
    }
}

/// Reject a caller-supplied identifier too long to echo back safely.
///
/// The error names the limit and the length, never the value — the point is to
/// stop an oversized name becoming an oversized error, so repeating it would
/// undo the check.
pub fn check_identifier(what: &str, value: &str) -> Result<(), String> {
    if value.len() > MAX_IDENTIFIER_BYTES {
        return Err(format!(
            "{} too long ({} bytes, limit {})",
            what,
            value.len(),
            MAX_IDENTIFIER_BYTES
        ));
    }
    Ok(())
}

/// Reject a JSON *text* that is too long to parse generically.
///
/// Checked before `from_str`, so an oversized body costs a length comparison
/// rather than a parse and an allocation.
pub fn check_json_text(what: &str, text: &str) -> Result<(), String> {
    if text.len() > MAX_JSON_TEXT_BYTES {
        return Err(format!(
            "{} too large ({} bytes, limit {})",
            what,
            text.len(),
            MAX_JSON_TEXT_BYTES
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Build `{"a":{"a":{...}}}` nested `levels` deep, without recursing.
    ///
    /// Built by hand rather than with `json!`, which is a trap here: a `json!`
    /// whose value position is a *variable* expands to `serde_json::to_value`,
    /// and that re-serializes the existing value recursively (and clones it, so
    /// the loop is also quadratic). A helper written that way overflows the
    /// stack while constructing the input, which reads exactly like the guard
    /// failing.
    fn nested_object(levels: usize) -> Value {
        let mut value = Value::from(1);
        for _ in 0..levels {
            let mut map = serde_json::Map::new();
            map.insert("a".to_string(), value);
            value = Value::Object(map);
        }
        value
    }

    /// Build `[[[...]]]` nested `levels` deep. Same constraint as above.
    fn nested_array(levels: usize) -> Value {
        let mut value = Value::from(1);
        for _ in 0..levels {
            value = Value::Array(vec![value]);
        }
        value
    }

    #[test]
    fn accepts_a_realistic_payload() {
        let payload = json!({
            "entityId": "e1",
            "componentType": "moving_platform",
            "properties": {
                "waypoints": [[0.0, 0.0, 0.0], [0.0, 3.0, 0.0]],
                "loopMode": "pingPong",
            },
        });
        assert!(check_command_payload("update_game_component", payload).is_ok());
    }

    #[test]
    fn accepts_a_bare_scalar_and_null() {
        // `dispatch` is handed `Value::Null` for a command with no payload, and
        // the batch path substitutes null for a missing `payload` key. Neither
        // may be refused.
        assert!(check_command_payload("play", Value::Null).is_ok());
        assert!(check_command_payload("play", json!(3)).is_ok());
    }

    #[test]
    fn accepts_nesting_exactly_at_the_limit() {
        // A scalar is depth 1, so `MAX - 1` wrappers puts the innermost value at
        // exactly `MAX`. Pinning the boundary from both sides is what keeps an
        // off-by-one from either rejecting legal payloads or leaving a level
        // unguarded.
        let payload = nested_object(MAX_COMMAND_PAYLOAD_DEPTH - 1);
        assert!(check_command_payload("cmd", payload).is_ok());
    }

    #[test]
    fn rejects_nesting_one_level_past_the_limit() {
        let payload = nested_object(MAX_COMMAND_PAYLOAD_DEPTH);
        let err = check_command_payload("cmd", payload).unwrap_err();
        assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
        assert!(err.contains("cmd"), "error does not name the command: {}", err);
    }

    #[test]
    fn rejects_the_deep_payload_that_would_overflow_the_stack() {
        // The condition this module exists for, at a depth nothing recursive
        // survives. An earlier draft of this test used 5,000 and still aborted
        // the process: the guard returned its error correctly, and then the
        // rejected value's recursive `Drop` overflowed the 2 MiB test thread on
        // the way out. That is why the check takes ownership.
        let payload = nested_object(100_000);
        assert!(check_command_payload("cmd", payload).is_err());
    }

    #[test]
    fn rejects_deep_nesting_reached_through_arrays() {
        // Arrays nest exactly as objects do, and an earlier draft only walked
        // object values — so `[[[[…]]]]` went straight through the guard into
        // the same recursive `from_value`.
        let err = check_command_payload("cmd", nested_array(1_000)).unwrap_err();
        assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
    }

    /// Wrap a list of values as `{"items": [...]}` without going through
    /// `json!`, which would re-serialize and clone the whole list.
    fn under_key(items: Vec<Value>) -> Value {
        let mut map = serde_json::Map::new();
        map.insert("items".to_string(), Value::Array(items));
        Value::Object(map)
    }

    #[test]
    fn accepts_a_wide_shallow_payload_under_the_container_bound() {
        let items: Vec<Value> = (0..1_000).map(|i| json!({ "x": i })).collect();
        assert!(check_command_payload("cmd", under_key(items)).is_ok());
    }

    #[test]
    fn accepts_a_full_size_tilemap() {
        // The bound this pins is the one the first version of this module got
        // wrong. `TilemapLayer.tiles` is a flat array of `width * height`
        // scalars and `TilemapInspector` permits 1000×1000, so a single
        // ordinary tilemap edit carries a million values under two containers.
        // Counting every JSON value refused every tilemap past roughly 223×223.
        let tiles: Vec<Value> = (0..1_000_000).map(|i| Value::from(i % 8)).collect();
        assert!(check_command_payload("set_tilemap_data", under_key(tiles)).is_ok());
    }

    #[test]
    fn accepts_a_payload_exactly_at_the_container_limit() {
        // The wrapper object and its array are containers themselves, so the run
        // beneath them is two short of the bound.
        let items: Vec<Value> = (0..MAX_COMMAND_PAYLOAD_CONTAINERS - 2)
            .map(|_| Value::Object(serde_json::Map::new()))
            .collect();
        assert!(check_command_payload("cmd", under_key(items)).is_ok());
    }

    #[test]
    fn rejects_a_payload_one_container_past_the_limit() {
        // Shallow enough to clear the depth bound, so this can only be caught by
        // counting — and exactly one container over, so the boundary is pinned
        // from both sides rather than by a number that is merely large.
        let items: Vec<Value> = (0..MAX_COMMAND_PAYLOAD_CONTAINERS - 1)
            .map(|_| Value::Object(serde_json::Map::new()))
            .collect();
        let err = check_command_payload("cmd", under_key(items)).unwrap_err();
        assert!(err.contains("too much structure"), "unexpected error: {}", err);
        assert!(err.contains("cmd"), "error does not name the command: {}", err);
    }

    #[test]
    fn dismantles_a_pathologically_deep_value_without_overflowing() {
        // Directly on the dismantler, because every other test reaches it only
        // through a rejection. A recursive drop of this value aborts the process
        // rather than failing an assertion, so "the test finished" is the
        // assertion.
        drop_without_recursing(nested_object(200_000));
        drop_without_recursing(nested_array(200_000));
    }

    #[test]
    fn hands_an_accepted_payload_back_unchanged() {
        // The value has to survive the check intact — a guard that returned a
        // default or a clone would silently drop fields on every command.
        let payload = json!({ "entityId": "e1", "properties": { "speed": 9.0 } });
        let returned = check_command_payload("cmd", payload.clone()).expect("accepted");
        assert_eq!(returned, payload);
    }

    #[test]
    fn a_realistic_batch_passes_the_envelope_check() {
        let batch = json!([
            { "command": "update_transform", "payload": { "entityId": "e1", "position": [0, 1, 0] } },
            { "command": "play" },
        ]);
        assert!(check_command_batch(batch).is_ok());
    }

    #[test]
    fn a_payload_at_the_per_command_limit_is_not_refused_for_being_batched() {
        // The envelope costs two levels — the array, then the item object — so
        // without the extra headroom a payload that `dispatch` accepts on its
        // own would be rejected the moment it was batched.
        let mut item = serde_json::Map::new();
        item.insert("command".to_string(), Value::from("cmd"));
        item.insert(
            "payload".to_string(),
            nested_object(MAX_COMMAND_PAYLOAD_DEPTH - 1),
        );
        let batch = Value::Array(vec![Value::Object(item)]);
        assert!(check_command_batch(batch).is_ok());
    }

    #[test]
    fn rejects_a_batch_whose_item_is_nested_too_deeply() {
        // The condition the batch check exists for: this value would be cloned
        // out of the item — recursing per level — before `dispatch` ever saw it.
        let mut item = serde_json::Map::new();
        item.insert("command".to_string(), Value::from("cmd"));
        item.insert("payload".to_string(), nested_object(100_000));
        let batch = Value::Array(vec![Value::Object(item)]);
        let err = check_command_batch(batch).unwrap_err();
        assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
    }

    #[test]
    fn a_batched_payload_deeper_than_the_envelope_headroom_is_still_refused() {
        // Pins the +2 from above. It is headroom for the envelope's own two
        // levels, not a way to smuggle a deeper payload through by batching it:
        // one level past what `dispatch` would accept standalone must still be
        // refused here.
        let mut item = serde_json::Map::new();
        item.insert("command".to_string(), Value::from("cmd"));
        item.insert(
            "payload".to_string(),
            nested_object(MAX_COMMAND_PAYLOAD_DEPTH),
        );
        let batch = Value::Array(vec![Value::Object(item)]);
        let err = check_command_batch(batch).unwrap_err();
        assert!(err.contains("nested too deeply"), "unexpected error: {}", err);
    }

    #[test]
    fn accepts_a_batch_at_exactly_the_container_limit() {
        // Without this, the bound is pinned from one side only: tightening
        // MAX_BATCH_CONTAINERS by an order of magnitude leaves the rejection
        // test below green, so nothing notices that legitimate batches started
        // being refused.
        let items: Vec<Value> = (0..MAX_BATCH_CONTAINERS - 1)
            .map(|_| Value::Array(Vec::new()))
            .collect();
        assert!(check_command_batch(Value::Array(items)).is_ok());
    }

    #[test]
    fn rejects_a_batch_with_too_much_structure() {
        let items: Vec<Value> = (0..MAX_BATCH_CONTAINERS)
            .map(|_| Value::Array(Vec::new()))
            .collect();
        let err = check_command_batch(Value::Array(items)).unwrap_err();
        assert!(err.contains("too much structure"), "unexpected error: {}", err);
    }

    #[test]
    fn identifier_bound_accepts_a_real_name_and_rejects_an_oversized_one() {
        assert!(check_identifier("Command name", "update_transform").is_ok());
        assert!(check_identifier("Command name", &"x".repeat(MAX_IDENTIFIER_BYTES)).is_ok());

        let oversized = "x".repeat(MAX_IDENTIFIER_BYTES + 1);
        let err = check_identifier("Command name", &oversized).unwrap_err();
        assert!(err.contains("too long"), "unexpected error: {}", err);
        assert!(err.contains("Command name"), "error does not name the field: {}", err);
        // The whole point is to stop an oversized name becoming an oversized
        // error, so repeating the value would undo the check.
        assert!(!err.contains(&oversized), "error echoes the oversized value: {}", err);
    }

    #[test]
    fn json_text_bound_accepts_a_normal_body_and_rejects_an_oversized_one() {
        assert!(check_json_text("properties", r#"{"speed":9.0}"#).is_ok());

        let oversized = "x".repeat(MAX_JSON_TEXT_BYTES + 1);
        let err = check_json_text("properties", &oversized).unwrap_err();
        assert!(err.contains("too large"), "unexpected error: {}", err);
        assert!(err.contains("properties"), "error does not name the field: {}", err);
    }

    #[test]
    fn json_text_bound_accepts_a_body_exactly_at_the_limit() {
        let exact = "x".repeat(MAX_JSON_TEXT_BYTES);
        assert!(check_json_text("properties", &exact).is_ok());
    }
}
