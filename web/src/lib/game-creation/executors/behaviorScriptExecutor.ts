import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { zBehavior, BEHAVIOR_PLANS } from '../behaviorVocabulary';
import { buildBehaviorScript } from '@/lib/scripting/scriptTemplates';
import { makeStepError, successResult, failResult } from './shared';
import { sendCommands, engineEntityId } from './engineDispatch';

/**
 * Attaches a HAND-WRITTEN behaviour template to an entity (PF-1114).
 *
 * Deliberately NOT `custom_script_generate`, and the differences are the point:
 *
 *  - **No model call, no tokens.** `PLAN_COST_ESTIMATES.behavior_script` is
 *    zero in `planBuilder.ts`. A template that costs what a generated script
 *    costs would make the cheap path look expensive on the approval gate and
 *    push users toward the LLM path this ticket exists to avoid.
 *  - **No sandbox-escape validation of the OUTPUT.** `customScriptExecutor`
 *    screens LLM output for `eval`, `Function`, `fetch` and friends because
 *    that output is untrusted. This source is authored in the repo and pinned
 *    by `behaviorScripts.test.ts` (forbidden patterns) and
 *    `forgeApiConformance.test.ts` (every `forge.*` call resolves against
 *    `forgeTypes.ts`), which catches the same class at build time rather than
 *    on every run of every generated game.
 *  - **The target id is validated where it is EMBEDDED**, not here.
 *    `buildBehaviorScript` refuses any id outside `[A-Za-z0-9_-]{1,64}` rather
 *    than escaping it, because an id is a minted UUID and one that needs
 *    escaping is one that should never have reached the source text.
 *
 * The write goes out as `set_script`, the same command `customScriptExecutor`
 * uses, carrying the ORIGINAL entity id: the engine matches `set_script`
 * byte-for-byte against the `EntityId` component and its match loop emits
 * nothing on a miss, so a rewritten id is a silent no-op.
 */

/**
 * The engine's OWN id rule, shared rather than restated.
 *
 * `engineEntityId` mirrors `is_valid_override_id` in core/entity_factory.rs
 * byte-for-byte. That matters here because an id the engine refuses is not an
 * error there — it silently falls back to a random UUID, so a `set_script`
 * carrying one attaches to nothing and reports success.
 */
const inputSchema = z.object({
  behavior: zBehavior,
  entityId: engineEntityId,
  /**
   * The entity this behaviour reacts to. Nullable rather than optional: a
   * behaviour whose plan says `needsTarget` is dropped at plan time when there
   * is nothing to target, so a null arriving here means the plan explicitly
   * decided this behaviour needs no target.
   */
  targetEntityId: engineEntityId.nullable().default(null),
  projectType: z.enum(['2d', '3d']),
});

export const behaviorScriptExecutor: ExecutorDefinition = {
  name: 'behavior_script',
  inputSchema,
  userFacingErrorMessage:
    'Could not attach this behavior. The object was still created, but it will not move on its own.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError('INVALID_INPUT', parsed.error.message, this.userFacingErrorMessage),
      );
    }

    const { behavior, entityId, targetEntityId, projectType } = parsed.data;

    const plan = BEHAVIOR_PLANS[behavior];
    if (plan.substrate !== 'behavior_script') {
      // Reachable only from a hand-built plan or a vocabulary entry that was
      // re-pointed at a component without its steps being re-planned. Say so
      // rather than dispatching nothing and reporting success.
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          `"${behavior}" is planned as ${plan.substrate}, not as a script`,
          this.userFacingErrorMessage,
        ),
      );
    }

    const source = buildBehaviorScript(behavior, { targetEntityId, projectType });
    if (source === null) {
      return failResult(
        makeStepError(
          'SCRIPT_UNAVAILABLE',
          `no behavior script could be built for "${behavior}" (target: ${targetEntityId ?? 'none'})`,
          this.userFacingErrorMessage,
        ),
      );
    }

    if (!sendCommands(ctx, [{
      command: 'set_script',
      payload: { entityId, source, enabled: true },
    }])) {
      return failResult(
        makeStepError(
          'COMMAND_FAILED',
          'Engine rejected the behavior script',
          this.userFacingErrorMessage,
          true,
        ),
      );
    }

    return successResult({
      entityId,
      behavior,
      targetEntityId,
      scriptLength: source.length,
      lineCount: source.split('\n').length,
    });
  },
};
