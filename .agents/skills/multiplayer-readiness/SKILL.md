---
name: multiplayer-readiness
description: Audit SpawnForge code for changes that block future multiplayer networking. Use when modifying state management, entity systems, or the command pipeline — flags non-deterministic state, client-authoritative patterns, and unsyncable mutations.
user-invocable: true
allowed-tools: Read, Glob, Grep, Agent
argument-hint: "[scope: pr|file <path>|store|commands|all]"
---

# Multiplayer Readiness Reviewer

SpawnForge's multiplayer networking (Phase 25) was removed because no networking backend existed. It WILL be rebuilt. Every design decision today either makes that easier or harder.

## Context

Multiplayer in a browser-based game engine means:
- **Authoritative server** or **relay-based P2P** — likely the former for anti-cheat
- **State synchronization** — entity transforms, components, and scene graph must replicate
- **Command replication** — `handle_command()` JSON commands are the natural sync boundary
- **Conflict resolution** — two users editing the same entity simultaneously
- **Bandwidth constraints** — browser WebSocket/WebRTC, not TCP sockets

## Red Flags to Check

When reviewing code changes, flag any of these patterns:

### 1. Global Mutable Singletons

**Problem**: Singletons can't distinguish between local and remote state.

```bash
# Check for thread-local / global state outside ECS
grep -rn "thread_local!\|static mut\|lazy_static!\|OnceCell" engine/src/ --include="*.rs"
# Check for singleton patterns in stores
grep -rn "getState()\." web/src/stores/ --include="*.ts" | grep -v "test" | head -20
```

**Multiplayer-safe alternative**: All mutable state in ECS resources or Zustand slices with clear ownership semantics.

### 2. Implicit Local-Only Assumptions

**Problem**: Code that assumes a single user is editing.

```bash
# Selection system — must support per-user selections
grep -rn "selectedIds\|primary_id\|SelectionChanged" engine/src/ web/src/stores/ | head -20
# Undo/redo — must be per-user
grep -rn "UndoableAction\|HistoryStack" engine/src/ | head -10
```

**Flags**:
- Selection stored as a single global set (should be per-user/per-session)
- Undo history as a single stack (should be per-user)
- Camera state as singleton (should be per-viewport)

### 3. Non-Deterministic Command Handling

**Problem**: Commands that produce different results on different clients.

```bash
# Check for randomness in command handlers
grep -rn "rand::\|thread_rng\|random()" engine/src/core/commands/ | head -10
# Check for time-dependent logic
grep -rn "Instant::now\|SystemTime\|elapsed" engine/src/core/commands/ | head -10
```

**Multiplayer-safe**: Commands must be deterministic given the same state + input. Randomness should use seeded RNG with seed in the command payload.

### 4. Direct State Mutation Bypassing Commands

**Problem**: State changes that can't be replicated because they don't go through the command pipeline.

```bash
# Direct component mutations outside command handlers
grep -rn "\.insert(\|\.remove::<\|commands\.entity" engine/src/bridge/ | grep -v "// safe:" | head -20
```

**Multiplayer-safe**: ALL state mutations go through `handle_command()` → `dispatch()` chain. Bridge systems should only READ state and emit events.

### 5. Large State in Commands

**Problem**: Commands that embed full scene snapshots or large binary data.

```bash
# Check command payload sizes
grep -rn "serde_json::to_string\|JSON.stringify" engine/src/core/commands/ web/src/stores/slices/ | head -15
```

**Multiplayer-safe**: Commands should be delta-based (change X by Y) not absolute (set X to full-snapshot). Export/import can remain absolute.

### 6. Client-Side Authority Over Game State

**Problem**: Game logic running exclusively in the browser with no validation path.

```bash
# Script execution is client-side only
grep -rn "postMessage\|onmessage" web/src/lib/scripting/ | head -10
# Token/billing logic client-side
grep -rn "deductTokens\|creditAddon" web/src/stores/ | head -10
```

**Acceptable for now**: Script execution is intentionally client-side (game scripting, not multiplayer). But flag if game-critical state (health, score, inventory) is only validated client-side.

## Review Checklist

When reviewing a PR or designing a feature, check:

- [ ] All state mutations go through `handle_command()`
- [ ] No new global mutable singletons added
- [ ] Selection/undo/camera don't hardcode single-user assumptions
- [ ] Command payloads are reasonable size (deltas, not snapshots)
- [ ] No `Math.random()` or `Date.now()` in deterministic paths
- [ ] New ECS components have clear ownership semantics (who can write?)

## Running the Review

### On a PR
```bash
gh pr diff <number> | grep -E "thread_local|static mut|getState\(\)\.|selectedIds|Math\.random|Date\.now"
```

### On the full codebase
Run each section's grep commands above and report findings with file:line references.

## Current Known Debt

These exist today and will need fixing for multiplayer:
- `SelectionChangedEvent` is global (single selection set)
- `HistoryStack` is a single undo chain
- Script worker runs client-side only (fine for single-player game scripting)
- Camera is a single entity (need per-viewport for split-screen / spectator)
