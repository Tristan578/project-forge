# Multiplayer Readiness Checklist

<!-- Reviewer rubric for the multiplayer-readiness skill -->
<!-- Score: OK | CAUTION | FLAG -->

## Severity Definitions

| Level | Meaning |
|-------|---------|
| **OK** | No multiplayer concern. Change is compatible with future networking. |
| **CAUTION** | Adds complexity for multiplayer but is acceptable for now. Document the decision. |
| **FLAG** | Creates a hard blocker for multiplayer. Should be reconsidered or explicitly accepted with a comment noting the future cost. |

---

## Category 1: State Serialization

All entity state must be serializable for network sync.

- [ ] New ECS component data is `Serialize + Deserialize` (Rust) or plain JSON-compatible (TS)
- [ ] No `Handle<T>` or asset references stored as raw pointers -- use asset IDs/paths
- [ ] EntitySnapshot includes the new state (so it can be transmitted to peers)
- [ ] Scene export (`snapshot_scene`) captures the new state correctly

**FLAG if:** Component stores runtime-only state (GPU handles, audio nodes, timers) in the same struct as game state without separation.
**OK if:** Runtime-only state is in a separate marker component or resource.

## Category 2: Physics Determinism

Physics must produce identical results given identical inputs for server-authoritative multiplayer.

- [ ] No `Math.random()` or non-seeded randomness in physics-affecting code
- [ ] Physics stepping does not depend on frame rate (uses fixed timestep)
- [ ] RapierConfiguration is per-entity (Component), not global -- already correct in SpawnForge
- [ ] No `parallel` feature on rapier (rayon is non-deterministic across runs) -- already enforced

**FLAG if:** Physics behavior depends on render frame timing or non-deterministic ordering.
**CAUTION if:** New physics feature uses floating-point operations that may differ across platforms (acceptable for now, but note it).

## Category 3: Input Abstraction

Input must flow through an abstraction layer that can later inject network input.

- [ ] Input reads go through `InputMap`/`InputState` system, not direct browser event listeners
- [ ] No game logic directly reads `KeyboardEvent`/`MouseEvent` -- all through `capture_input`
- [ ] Input bindings are data-driven (serializable `InputMap`), not hardcoded

**FLAG if:** Game logic bypasses the input system and reads raw browser events directly.
**OK if:** Editor-only input (gizmo manipulation, panel interaction) reads browser events directly -- these don't need network sync.

## Category 4: Command Authority

All state mutations must flow through a chokepoint that can later be authority-checked.

- [ ] State changes go through `handle_command()` dispatch, not direct ECS mutation
- [ ] No "backdoor" mutations that bypass the command/pending queue pattern
- [ ] Commands carry enough context to be validated (entity ID, action type, parameters)

**FLAG if:** New feature mutates ECS state directly from bridge code without going through pending queue.
**OK if:** Read-only queries bypass the command system (queries don't need authority).

**Current architecture note:** SpawnForge already uses `handle_command()` as the single entry point for all mutations. This is excellent for multiplayer -- every command can later be authority-tagged with a player ID.

## Category 5: Time Management

Game logic must use controllable time, not wall-clock time.

- [ ] Game scripts use `forge.deltaTime` (provided by tick), not `Date.now()` or `performance.now()`
- [ ] Animation/physics systems use Bevy's `Time` resource, not `std::time::Instant`
- [ ] No game logic depends on absolute wall-clock timestamps

**FLAG if:** Gameplay-affecting code uses wall-clock time that can't be synchronized across peers.
**CAUTION if:** Cosmetic-only code (particles, UI animations) uses wall-clock time (acceptable).

## Category 6: Global Mutable State

Shared mutable state outside ECS makes networking extremely difficult.

- [ ] No global `static mut` or `thread_local!` state that affects gameplay (pending queues are OK -- they're a transport mechanism)
- [ ] No module-level variables in TypeScript that hold game state (Zustand store is OK -- it's the designated state container)
- [ ] Game state lives in ECS components/resources, not scattered across closures or module scope

**FLAG if:** Game-affecting state is stored in a place that can't be enumerated or serialized.
**OK if:** Editor-only state (panel positions, UI preferences) is in module scope.

## Category 7: Scene Graph Consistency

The scene graph must be reconstructable from serialized state.

- [ ] Entity parent-child relationships are captured in scene serialization
- [ ] No entity relationships exist only in runtime memory (everything in ECS)
- [ ] Spawning an entity from snapshot produces identical hierarchy

**OK if:** Current `spawn_from_snapshot` + `EntitySnapshot` already handles this correctly.

## Category 8: Script Sandbox Isolation

Player scripts must not have direct ECS access (they go through the command API).

- [ ] Scripts use `forge.*` API calls, not direct WASM memory access
- [ ] Script commands are serializable (they already are -- they go through `postMessage`)
- [ ] Script execution is isolated in Web Worker (already true)

**OK if:** The existing sandbox architecture is maintained. This is already multiplayer-compatible because scripts communicate via serializable messages through the async channel protocol.

---

## Architecture Strengths (Already Multiplayer-Compatible)

SpawnForge's existing architecture has several multiplayer-friendly properties:

1. **Command-driven mutation** -- All state changes go through `handle_command()`. This is a natural authority checkpoint.
2. **ECS architecture** -- Bevy ECS with serializable components is ideal for state synchronization.
3. **Script sandbox** -- Web Worker isolation with message-passing is inherently network-transparent.
4. **Scene serialization** -- `.forge` format already captures full scene state for save/load, which is the same operation as network state sync.
5. **Pending queue pattern** -- Commands queue in pending and drain next frame, creating a natural sync point.

## Architecture Risks (Will Need Work)

1. **No entity authority model** -- Currently all commands are trusted. Multiplayer needs per-entity ownership.
2. **No state diffing** -- Full scene snapshots work for save/load but are too expensive for 60fps network sync. Will need delta compression.
3. **No tick synchronization** -- Game loop runs at local frame rate. Multiplayer needs lockstep or server-authoritative tick.
4. **Client-side physics** -- Physics runs in the browser. Server-authoritative multiplayer needs headless physics on backend.
5. **No player identity in commands** -- Commands don't carry a player ID. Will need to be added to the command protocol.
