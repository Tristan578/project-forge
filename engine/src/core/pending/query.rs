//! Query request pending commands (for MCP resource reads).

use super::PendingCommands;

/// A query request type for MCP resource reads.
#[derive(Debug, Clone)]
pub enum QueryRequest {
    SceneGraph,
    Selection,
    EntityDetails { entity_id: String },
    CameraState,
    EngineMode,
    InputBindings,
    InputState,
    PhysicsState { entity_id: String },
    Physics2dState { entity_id: String },
    AssetList,
    ScriptData { entity_id: String },
    ScriptTemplates,
    AudioData { entity_id: String },
    PostProcessingState,
    AudioBuses,
    ReverbZoneState { entity_id: String },
    ParticleState { entity_id: String },
    AnimationState { entity_id: String },
    AnimationGraph { entity_id: String },
    ShaderData { entity_id: String },
    TerrainState { entity_id: String },
    QualitySettings,
    ListJoints,
    /// Every 2D joint in the scene. Answered by `bridge::query::process_joint2d_queries`.
    ListJoints2d,
    /// One entity's 2D joint. Answered by the same system, which replies on the
    /// existing `JOINT2D_CHANGED` channel rather than inventing a second wire
    /// shape for a single joint (PF-1194).
    Joint2dState { entity_id: String },
    GameComponentState { entity_id: String },
    GameCameraState { entity_id: String },
    AnimationClipState { entity_id: String },
    SpriteState { entity_id: String },
    Camera2dState,
    Skeleton2dState { entity_id: String },
    SpriteSheetState { entity_id: String },
    SpriteAnimatorState { entity_id: String },
    PlayState,
    GameComponentTypes,
}

// === Queue Methods ===

impl PendingCommands {
    pub fn queue_query(&mut self, request: QueryRequest) {
        self.query_requests.push(request);
    }

    /// Remove and return every queued query request matching `pred`, leaving
    /// every other pending read untouched.
    ///
    /// The obvious spelling — `query_requests.drain(..).filter(pred)` — empties
    /// the WHOLE queue and keeps only the matches, silently destroying every
    /// other system's pending reads. That shipped in `handle_physics2d_query`
    /// and made whichever query system happened to run first the only one that
    /// ever answered (PF-1194). Bridge systems are wasm32-only and cannot be
    /// unit-tested natively, so the retention logic lives here — one
    /// implementation with native tests, rather than the same read-then-retain
    /// dance hand-written at every call site.
    pub fn take_queries(&mut self, pred: impl Fn(&QueryRequest) -> bool) -> Vec<QueryRequest> {
        let mut taken = Vec::new();
        let mut kept = Vec::with_capacity(self.query_requests.len());
        for request in self.query_requests.drain(..) {
            if pred(&request) {
                taken.push(request);
            } else {
                kept.push(request);
            }
        }
        self.query_requests = kept;
        taken
    }
}

// === Bridge Functions ===

pub fn queue_query_from_bridge(request: QueryRequest) -> bool {
    super::with_pending(|pc| pc.queue_query(request)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue(pc: &mut PendingCommands, requests: Vec<QueryRequest>) {
        for request in requests {
            pc.queue_query(request);
        }
    }

    /// The assertion that fails on a revert to `drain(..).filter(..)`: the
    /// requests the predicate rejects must STILL be in the queue afterwards.
    #[test]
    fn take_queries_leaves_non_matching_requests_in_the_queue() {
        let mut pc = PendingCommands::default();
        queue(
            &mut pc,
            vec![
                QueryRequest::SceneGraph,
                QueryRequest::Physics2dState { entity_id: "a".into() },
                QueryRequest::Selection,
                QueryRequest::ListJoints,
            ],
        );

        let taken = pc.take_queries(|r| matches!(r, QueryRequest::Physics2dState { .. }));

        assert_eq!(taken.len(), 1);
        assert!(matches!(&taken[0], QueryRequest::Physics2dState { entity_id } if entity_id == "a"));
        assert_eq!(pc.query_requests.len(), 3);
        assert!(matches!(pc.query_requests[0], QueryRequest::SceneGraph));
        assert!(matches!(pc.query_requests[1], QueryRequest::Selection));
        assert!(matches!(pc.query_requests[2], QueryRequest::ListJoints));
    }

    #[test]
    fn take_queries_returns_every_match_in_queue_order() {
        let mut pc = PendingCommands::default();
        queue(
            &mut pc,
            vec![
                QueryRequest::Joint2dState { entity_id: "first".into() },
                QueryRequest::SceneGraph,
                QueryRequest::Joint2dState { entity_id: "second".into() },
            ],
        );

        let taken = pc.take_queries(|r| matches!(r, QueryRequest::Joint2dState { .. }));

        let ids: Vec<String> = taken
            .iter()
            .map(|r| match r {
                QueryRequest::Joint2dState { entity_id } => entity_id.clone(),
                other => panic!("unexpected request {other:?}"),
            })
            .collect();
        assert_eq!(ids, vec!["first".to_string(), "second".to_string()]);
        assert_eq!(pc.query_requests.len(), 1);
        assert!(matches!(pc.query_requests[0], QueryRequest::SceneGraph));
    }

    #[test]
    fn take_queries_with_no_match_is_a_no_op() {
        let mut pc = PendingCommands::default();
        queue(&mut pc, vec![QueryRequest::SceneGraph, QueryRequest::Selection]);

        let taken = pc.take_queries(|r| matches!(r, QueryRequest::ListJoints2d));

        assert!(taken.is_empty());
        assert_eq!(pc.query_requests.len(), 2);
    }

    // --- Deferred-variant parity -------------------------------------------
    //
    // `bridge::query::process_query_requests` sorts each pending read into one
    // of two buckets: the ones it answers itself, and a `remaining` list it
    // leaves for a dedicated system. Nothing checked that the dedicated system
    // exists. `SpriteState`, `Camera2dState` and `ProjectType` sat behind
    // arms commented "handled separately" with no separate system anywhere, so
    // `get_sprite`, `get_camera_2d` and `get_project_type` were routed, armed,
    // and silently dropped for their whole lives (PF-1181/PF-1194).
    //
    // The bridge is wasm32-only and cannot be reached by native `cargo test`,
    // so this reads the sources textually. It fails closed: a slice it cannot
    // find, or a count below the floor, is a failure rather than a vacuous pass.

    const BRIDGE_QUERY: &str = include_str!("../../bridge/query.rs");
    const BRIDGE_SOURCES: &[(&str, &str)] = &[
        ("bridge/query.rs", BRIDGE_QUERY),
        ("bridge/physics.rs", include_str!("../../bridge/physics.rs")),
        ("bridge/game.rs", include_str!("../../bridge/game.rs")),
        ("bridge/sprite.rs", include_str!("../../bridge/sprite.rs")),
        ("bridge/skeleton2d.rs", include_str!("../../bridge/skeleton2d.rs")),
    ];

    /// The body of `process_query_requests`, from its signature to the next
    /// item at column zero.
    fn process_query_requests_body() -> &'static str {
        let start = BRIDGE_QUERY
            .find("pub(super) fn process_query_requests")
            .expect("process_query_requests not found in bridge/query.rs");
        let rest = &BRIDGE_QUERY[start..];
        // The function ends at the first line starting a new item at column 0.
        let end = rest
            .match_indices("\n}\n")
            .next()
            .map(|(i, _)| i + 3)
            .expect("could not delimit process_query_requests");
        &rest[..end]
    }

    /// Variant names in the `remaining` classification arm — the reads
    /// `process_query_requests` defers to a dedicated system.
    fn deferred_variants() -> Vec<String> {
        let body = process_query_requests_body();
        let start = body
            .find("for request in pending.query_requests.drain(..)")
            .expect("classification loop not found");
        let end = body
            .find("pending.query_requests = remaining;")
            .expect("classification loop end not found");
        assert!(end > start, "classification loop slice is inverted");
        variant_names(&body[start..end])
    }

    /// The argument list of every `take_queries(` call in `source`, concatenated.
    ///
    /// The slice ends where the call's OWN parentheses balance, never at a
    /// lexical `");"`. Three call sites are written
    /// `pending.take_queries(|r| matches!(..)).is_empty()`, and that form
    /// contains no `");"` at all — so a terminator-based cut ran forward to the
    /// next `");"` anywhere in the file and swallowed unrelated code (measured
    /// windows of 2, 9 and 15 lines). No foreign `QueryRequest::` mention falls
    /// inside those windows today, but the direction of that failure is the
    /// unsafe one: a mention landing there later would be scored as CLAIMED
    /// with no system claiming it, silently satisfying the `unclaimed`
    /// assertion. The two length floors below only catch undercounting.
    ///
    /// Panics on unbalanced parentheses rather than capturing to end-of-file:
    /// an extractor that cannot delimit a call has to say so, not guess.
    fn take_queries_predicates(source: &str) -> String {
        const CALL: &str = "take_queries(";
        let bytes = source.as_bytes();
        let mut out = String::new();
        for (idx, _) in source.match_indices(CALL) {
            // Index of the `(` that opens the argument list.
            let open = idx + CALL.len() - 1;
            let mut depth = 0i32;
            let mut end = None;
            for (offset, byte) in bytes[open..].iter().enumerate() {
                match byte {
                    b'(' => depth += 1,
                    b')' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(open + offset + 1);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            let end = end.unwrap_or_else(|| {
                panic!("unbalanced parentheses after a take_queries( call at byte {idx}")
            });
            out.push_str(&source[idx..end]);
            out.push('\n');
        }
        out
    }

    /// The extractor above is the one place this suite can report a FALSE PASS,
    /// so it is asserted directly on a synthetic corpus rather than only through
    /// the live sources — where an over-wide window is invisible in the output.
    #[test]
    fn take_queries_predicates_cuts_at_the_closing_parenthesis() {
        // The `.is_empty()` call form carries no `");"` terminator, so the old
        // cut ran to the `");"` on the `consume(&other);` line and scored
        // `Other` as claimed. Only `Mine` is inside the call.
        let is_empty_form = r#"
    if !pending.take_queries(|r| matches!(r, QueryRequest::Mine)).is_empty() {
        let other = QueryRequest::Other;
        consume(&other);
    }
"#;
        assert_eq!(
            take_queries_predicates(is_empty_form)
                .lines()
                .count(),
            1,
            "one call site should yield exactly one captured slice"
        );
        assert_eq!(
            variant_names(&take_queries_predicates(is_empty_form)),
            vec!["Mine".to_string()],
            "the capture ran past the closing parenthesis of the call"
        );

        // Nested parentheses inside the predicate must not end the slice early,
        // and a multi-variant predicate claims every variant it names.
        let nested = r#"
    let requests = pending.take_queries(|req| matches!(req, QueryRequest::A { .. } | QueryRequest::B));
    let unrelated = QueryRequest::C;
"#;
        assert_eq!(
            variant_names(&take_queries_predicates(nested)),
            vec!["A".to_string(), "B".to_string()],
        );

        // No call site at all is an empty capture, not a panic.
        assert!(take_queries_predicates("let x = QueryRequest::A;").is_empty());
    }

    /// Every `QueryRequest::<Variant>` mention in `text`, de-duplicated.
    fn variant_names(text: &str) -> Vec<String> {
        let mut names = Vec::new();
        for (idx, _) in text.match_indices("QueryRequest::") {
            let tail = &text[idx + "QueryRequest::".len()..];
            let name: String = tail
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
        names
    }

    #[test]
    fn every_deferred_query_variant_is_claimed_by_a_bridge_system() {
        let deferred = deferred_variants();
        assert!(
            deferred.len() >= 10,
            "only {} deferred variants parsed - the slice is probably broken",
            deferred.len()
        );

        // A claim is a `take_queries(...)` predicate naming the variant, and
        // ONLY that. A mention anywhere in the file is far too weak: the system
        // that answers a read always names the variant again in its `match`, so
        // deleting the predicate alone would leave the mention behind and this
        // test would pass on a system that no longer takes the request. Routing
        // every claim through the one primitive is also what keeps the
        // read-then-retain logic in a single tested place.
        let mut claims = String::new();
        for (_, source) in BRIDGE_SOURCES {
            claims.push_str(&take_queries_predicates(source));
        }
        let claimed = variant_names(&claims);
        assert!(
            claimed.len() >= 10,
            "only {} variants claimed by a take_queries predicate - the extractor is probably broken",
            claimed.len()
        );

        let unclaimed: Vec<&String> = deferred.iter().filter(|v| !claimed.contains(v)).collect();
        assert!(
            unclaimed.is_empty(),
            "QueryRequest variants deferred by process_query_requests with no system claiming them: {unclaimed:?}"
        );

        // The REVERSE direction, and the one PF-1194 actually shipped broken:
        // a variant a dedicated system takes but `process_query_requests` does
        // not name in `remaining` is drained and DROPPED by the default system
        // before that system ever runs, however correct the handler is.
        // `Physics2dState`, `GameComponentState`, `GameCameraState` and
        // `Skeleton2dState` all sat in exactly that state. Asserting only
        // `unclaimed` leaves re-introducing it green: deleting a variant from
        // the `remaining` arm shrinks `deferred` without ever growing
        // `unclaimed`, and the length floor above is far too loose to notice.
        //
        // The two sets are identical today with zero exemptions, so this is a
        // pure ratchet: adding a system means adding its variant to `remaining`
        // in the same commit.
        let orphaned: Vec<&String> = claimed.iter().filter(|v| !deferred.contains(v)).collect();
        assert!(
            orphaned.is_empty(),
            "bridge systems claim QueryRequest variants that process_query_requests drops before they run \
             (add them to the `remaining` arm in bridge/query.rs): {orphaned:?}"
        );
    }

    /// Deferred variants no system can answer in a `runtime` build, each with
    /// the reason. The test above is cfg-blind — a claim inside an
    /// editor-only function counted for both builds — and reported
    /// `ListJoints`, `ListJoints2d`, `Joint2dState` and `Physics2dState` as
    /// answered while every one of them sat in a queue nothing drained in an
    /// exported game (#9550). Checked in both directions: an entry that gains
    /// a runtime-reachable claimant fails, and an unanswered variant missing
    /// from the list fails.
    const RUNTIME_UNANSWERED: &[(&str, &str)] = &[];

    #[test]
    fn runtime_build_claims_every_deferred_variant_or_waives_it() {
        use super::super::runtime_drains::scan::{functions, gated_modules, runtime_reachable, DRAIN_SOURCES};

        let deferred = deferred_variants();
        let gated = gated_modules();
        let mut runtime_claims = String::new();
        let mut reachable_claimants = 0usize;
        for (file, source) in DRAIN_SOURCES {
            for f in functions(file, source) {
                let predicates = take_queries_predicates(&f.body);
                if predicates.is_empty() {
                    continue;
                }
                if runtime_reachable(&f, &gated) {
                    reachable_claimants += 1;
                    runtime_claims.push_str(&predicates);
                }
            }
        }
        assert!(
            reachable_claimants >= 8,
            "only {reachable_claimants} runtime-reachable query systems found — the reachability model is probably broken"
        );
        let claimed = variant_names(&runtime_claims);
        for v in ["ListJoints", "ListJoints2d", "Joint2dState", "Physics2dState"] {
            assert!(claimed.contains(&v.to_string()), "`{v}` must be answerable in a runtime build (#9550 regression)");
        }

        let waived: Vec<&str> = RUNTIME_UNANSWERED.iter().map(|(v, _)| *v).collect();
        let unanswered: Vec<&String> = deferred
            .iter()
            .filter(|v| !claimed.contains(v) && !waived.contains(&v.as_str()))
            .collect();
        assert!(
            unanswered.is_empty(),
            "QueryRequest variants a runtime build queues (process_query_requests defers them) but no \
             runtime-reachable system takes — they accumulate in `query_requests` forever. Un-gate the \
             system or add each to RUNTIME_UNANSWERED with a reason: {unanswered:?}"
        );
        let stale: Vec<&&str> = waived.iter().filter(|v| claimed.contains(&v.to_string()) || !deferred.contains(&v.to_string())).collect();
        assert!(
            stale.is_empty(),
            "RUNTIME_UNANSWERED entries now answered in a runtime build (or no longer deferred) — remove them: {stale:?}"
        );
    }

    #[test]
    fn deferred_variants_are_real_enum_variants() {
        let enum_source = include_str!("query.rs");
        let start = enum_source
            .find("pub enum QueryRequest {")
            .expect("QueryRequest enum not found");
        let end = start
            + enum_source[start..]
                .find("\n}")
                .expect("QueryRequest enum end not found");
        let body = &enum_source[start..end];
        for variant in deferred_variants() {
            assert!(
                body.contains(&variant),
                "`{variant}` is deferred by the bridge but is not a QueryRequest variant"
            );
        }
    }

    /// A second call must not re-answer an already-taken request: this is what
    /// stops a query system emitting the same reply on every frame.
    #[test]
    fn take_queries_is_not_repeatable_for_the_same_request() {
        let mut pc = PendingCommands::default();
        queue(&mut pc, vec![QueryRequest::ListJoints2d, QueryRequest::SceneGraph]);

        assert_eq!(pc.take_queries(|r| matches!(r, QueryRequest::ListJoints2d)).len(), 1);
        assert_eq!(pc.take_queries(|r| matches!(r, QueryRequest::ListJoints2d)).len(), 0);
        assert_eq!(pc.query_requests.len(), 1);
    }
}
