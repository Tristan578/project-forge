/**
 * Bounded input-trace schema for runtime record/replay (#9902, qa.FR-1.OP-01).
 *
 * A trace is a typed, SIZE-BOUNDED recording of named input actions indexed by
 * simulation tick, captured for one fixture. "Bounded" is the load-bearing
 * word: an unbounded recording of a runaway play session is a memory and replay
 * hazard, so the schema itself refuses anything past 120 ticks or 30 seconds of
 * wall-clock — the two caps the issue names — rather than trusting a producer to
 * stop. `parseInputTrace` is the ONE validator; both the manual UI and the AI
 * invocation path run traces through it, so they reject identical inputs with
 * identical errors.
 *
 * The actions are NAMED (`move_right`, `jump`, …), not raw key codes: the same
 * trace replays through whatever keys currently bind those actions, and the
 * names are exactly what the engine's `capture_input` already evaluates, so a
 * recording is a straight copy of the engine's per-tick input rather than a
 * re-derivation. Key resolution happens at replay time (see `replayRunner.ts`).
 */

import { z } from 'zod';
import { subscribePlayTick, type PlayTickSnapshot } from './playTickBus';

/** Hard cap on recorded ticks. A trace may reference ticks `[0, 120)`. */
export const MAX_TRACE_TICKS = 120;

/** Hard cap on recorded wall-clock span, in milliseconds (30 seconds). */
export const MAX_TRACE_DURATION_MS = 30_000;

/** The only trace schema version this module reads or writes. */
export const INPUT_TRACE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** One named action's state on a single tick. */
export const inputActionStateSchema = z
  .object({
    pressed: z.boolean(),
    /** Axis value in [-1, 1] for analog actions (absent for digital ones). */
    axis: z.number().min(-1).max(1).optional(),
  })
  .strict();

/** The recorded input on a single simulation tick. */
export const inputTraceFrameSchema = z
  .object({
    tick: z.number().int().min(0).max(MAX_TRACE_TICKS - 1),
    actions: z.record(z.string().min(1), inputActionStateSchema),
  })
  .strict();

export const inputTraceSchema = z
  .object({
    version: z.literal(INPUT_TRACE_VERSION),
    /** Which fixture this trace was recorded against. */
    fixtureId: z.string().min(1),
    /** The action vocabulary the trace is allowed to reference. */
    actionNames: z.array(z.string().min(1)),
    /** Wall-clock span of the recording; bounded to 30 s. */
    durationMs: z.number().min(0).max(MAX_TRACE_DURATION_MS),
    /** Per-tick input, at most 120 frames. */
    frames: z.array(inputTraceFrameSchema).max(MAX_TRACE_TICKS),
  })
  .strict()
  .superRefine((trace, ctx) => {
    const vocabulary = new Set(trace.actionNames);
    const seenTicks = new Set<number>();
    let previousTick = -1;
    trace.frames.forEach((frame, index) => {
      if (seenTicks.has(frame.tick)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['frames', index, 'tick'],
          message: `duplicate tick ${frame.tick}: each tick may appear once`,
        });
      }
      seenTicks.add(frame.tick);
      if (frame.tick <= previousTick) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['frames', index, 'tick'],
          message: `tick ${frame.tick} is not strictly after ${previousTick}: frames must be tick-ordered`,
        });
      }
      previousTick = frame.tick;
      for (const actionName of Object.keys(frame.actions)) {
        if (!vocabulary.has(actionName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['frames', index, 'actions', actionName],
            message: `action "${actionName}" is not in the trace's actionNames vocabulary`,
          });
        }
      }
    });
  });

export type InputActionState = z.infer<typeof inputActionStateSchema>;
export type InputTraceFrame = z.infer<typeof inputTraceFrameSchema>;
export type InputTrace = z.infer<typeof inputTraceSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Parse and validate an untrusted value as an `InputTrace`, THROWING a single
 * flattened error on failure. This is the shared gate: the manual Replay button
 * and the AI replay invocation both call it, so a trace that is malformed, over
 * 120 frames, over 30 s, or references an unbound action is rejected the same
 * way from either entry point.
 */
export function parseInputTrace(value: unknown): InputTrace {
  const result = inputTraceSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new InputTraceValidationError(detail);
  }
  return result.data;
}

/** Non-throwing variant, mirroring Zod's `safeParse` return shape. */
export function safeParseInputTrace(
  value: unknown,
): { success: true; trace: InputTrace } | { success: false; error: string } {
  try {
    return { success: true, trace: parseInputTrace(value) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Distinct error type so callers can tell a validation refusal from a runtime
 *  fault without string-matching. */
export class InputTraceValidationError extends Error {
  constructor(detail: string) {
    super(`Invalid input trace: ${detail}`);
    this.name = 'InputTraceValidationError';
  }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

/** The active named actions on one tick, derived from an engine input state. */
function activeActionsFromInput(
  snapshot: PlayTickSnapshot,
): Record<string, InputActionState> {
  const actions: Record<string, InputActionState> = {};
  const { pressed, axes } = snapshot.inputState;
  for (const [name, isPressed] of Object.entries(pressed ?? {})) {
    if (isPressed) actions[name] = { pressed: true };
  }
  for (const [name, value] of Object.entries(axes ?? {})) {
    if (Number.isFinite(value) && value !== 0) {
      // Preserve any existing `pressed` flag for the same action name.
      actions[name] = { pressed: actions[name]?.pressed ?? true, axis: value };
    }
  }
  return actions;
}

/**
 * Records the engine's per-tick named-action input into a bounded `InputTrace`.
 *
 * Subscribes to the play-tick bus on `start` and appends one frame per engine
 * tick, STOPPING itself the instant either bound is reached — 120 recorded
 * frames or 30 s of elapsed wall-clock — so the cap is enforced during capture,
 * not merely validated afterward. A frame with no active action is skipped (it
 * carries no information and would waste a tick slot), while its tick index is
 * still consumed, so the tick numbers stay aligned with real engine frames.
 */
export class InputTraceRecorder {
  private readonly fixtureId: string;
  private readonly actionNames: string[];
  private frames: InputTraceFrame[] = [];
  private tickCounter = 0;
  private lastElapsedMs = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(fixtureId: string, actionNames: string[]) {
    this.fixtureId = fixtureId;
    this.actionNames = [...actionNames];
  }

  /** Begin capturing. Idempotent — a second call while recording is a no-op. */
  start(): void {
    if (this.unsubscribe) return;
    this.frames = [];
    this.tickCounter = 0;
    this.lastElapsedMs = 0;
    this.unsubscribe = subscribePlayTick((snapshot) => this.onTick(snapshot));
  }

  private onTick(snapshot: PlayTickSnapshot): void {
    // Enforce BOTH caps at capture time. Reaching either stops recording so a
    // long or runaway play session can never grow the trace past the bound.
    if (
      this.tickCounter >= MAX_TRACE_TICKS ||
      snapshot.elapsedMs > MAX_TRACE_DURATION_MS
    ) {
      this.stop();
      return;
    }
    const tick = this.tickCounter;
    this.tickCounter += 1;
    this.lastElapsedMs = Math.min(snapshot.elapsedMs, MAX_TRACE_DURATION_MS);
    const actions = activeActionsFromInput(snapshot);
    if (Object.keys(actions).length > 0) {
      this.frames.push({ tick, actions });
    }
  }

  /** True while capturing. */
  isRecording(): boolean {
    return this.unsubscribe !== null;
  }

  /** Number of engine ticks seen so far (whether or not they carried input). */
  ticksCaptured(): number {
    return this.tickCounter;
  }

  /**
   * Stop capturing and return the completed, VALIDATED trace. Runs the same
   * `parseInputTrace` gate the replay path uses, so a recording that somehow
   * violated a bound surfaces here rather than at replay time.
   */
  stop(): InputTrace {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    return parseInputTrace({
      version: INPUT_TRACE_VERSION,
      fixtureId: this.fixtureId,
      actionNames: this.actionNames,
      durationMs: this.lastElapsedMs,
      frames: this.frames,
    });
  }
}
