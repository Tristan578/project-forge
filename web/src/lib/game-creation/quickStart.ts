/**
 * Quick-start entry data: the game-type cards shown by the "Make me a game"
 * dialog, and the approval gates that entry point answers on the user's behalf.
 *
 * Lives under `lib/game-creation/` (not next to the dialog) because the gate-id
 * list is consumed by `orchestratorSlice` and the card list by a client
 * component, and neither should own the other's copy.
 *
 * SERVER-SAFE: this module sits inside a subtree reachable from
 * `app/api/game/decompose/route.ts`, so it must never take a VALUE import on
 * `@/stores/*` or `@/hooks/*` (see `__tests__/serverSafeImports.test.ts`). That
 * is also why the cards carry no `icon` component: icons are React values and
 * belong in the client component that renders them.
 */

/**
 * Approval gates the quick-start flow answers automatically.
 *
 * `gate_plan` fires immediately after decomposition (`planBuilder` always plans
 * it after `step_0`) and exists so a chat-driven user can review the plan before
 * spending tokens. A user who clicked "Make me a game" has already said yes to
 * exactly that, so re-asking strands them on a second confirmation.
 *
 * `gate_assets` and `gate_final` are deliberately NOT here — they gate real
 * spend and the finished result, and the quick-start dialog renders them inline.
 */
export const QUICK_START_AUTO_GATES = ['gate_plan'] as const;

/** A game type offered on the quick-start dialog's first screen. */
export type QuickStartGameType = 'platformer' | 'shooter' | 'puzzle' | 'explorer';

/** One card on the quick-start type picker. Data only — no React values. */
export interface QuickStartGameTypeCard {
  /** Stable id; also the value passed to `templateId`-aware callers. */
  id: QuickStartGameType;
  /** On-screen label. Also prefixed onto the prompt sent to the pipeline. */
  label: string;
  /** One-line description under the label. */
  description: string;
  /** Accent colour for the card, as a CSS colour string. */
  accentColor: string;
  /** Starter prompt pre-filled into the textarea, and the fallback if it is cleared. */
  placeholder: string;
}

/** The four game types offered by the quick-start entry point. */
export const QUICK_START_GAME_TYPES: readonly QuickStartGameTypeCard[] = [
  {
    id: 'platformer',
    label: 'Platformer',
    description: 'Jump, run, collect coins',
    accentColor: '#22c55e',
    placeholder: 'A jungle platformer where the player collects gems to unlock a golden door',
  },
  {
    id: 'shooter',
    label: 'Shooter',
    description: 'Aim, shoot, destroy targets',
    accentColor: '#ef4444',
    placeholder: 'A sci-fi arena where robots shoot back and drop power-ups',
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    description: 'Think, solve, advance levels',
    accentColor: '#8b5cf6',
    placeholder: 'Push crates onto switches to open doors in a haunted mansion',
  },
  {
    id: 'explorer',
    label: 'Explorer',
    description: 'Wander, discover, experience',
    accentColor: '#06b6d4',
    placeholder: 'A peaceful forest walk where you find glowing crystals and hidden messages',
  },
] as const;

/** Look up a card by id. Returns `null` rather than throwing on an unknown id. */
export function findQuickStartGameType(
  id: string | null | undefined
): QuickStartGameTypeCard | null {
  if (!id) return null;
  return QUICK_START_GAME_TYPES.find((card) => card.id === id) ?? null;
}

/**
 * Compose the prompt handed to the pipeline: `"<Label>: <what the user typed>"`.
 *
 * An empty or whitespace-only entry falls back to the card's placeholder, so the
 * pipeline never receives a bare label with nothing after it.
 */
export function buildQuickStartPrompt(card: QuickStartGameTypeCard, prompt: string): string {
  const body = prompt.trim() || card.placeholder;
  return `${card.label}: ${body}`;
}
