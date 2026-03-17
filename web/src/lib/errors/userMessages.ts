/**
 * Mapping of internal error codes to user-friendly messages.
 * Never expose raw HTTP status codes, database errors, or stack traces to users.
 * Every entry must explain what happened AND what the user can do next.
 */

export type ActionType = 'retry' | 'sign-in' | 'upgrade' | 'contact' | 'dismiss' | 'refresh';

export interface FriendlyErrorEntry {
  /** Short, plain-English title (≤ 8 words) */
  title: string;
  /** One sentence explaining what happened and what to do */
  message: string;
  /** Label for the primary action button */
  actionLabel: string;
  /** The type of action to perform */
  action: ActionType;
}

export type ErrorCode =
  // Network
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'OFFLINE'
  // Auth
  | 'AUTH_EXPIRED'
  | 'AUTH_FORBIDDEN'
  | 'AUTH_REQUIRED'
  // Billing
  | 'PUBLISH_LIMIT'
  | 'STORAGE_LIMIT'
  | 'TOKEN_LIMIT'
  | 'TIER_REQUIRED'
  // AI Generation
  | 'GENERATION_FAILED'
  | 'GENERATION_TIMEOUT'
  | 'GENERATION_CONTENT_POLICY'
  | 'GENERATION_PROVIDER_DOWN'
  // Engine
  | 'ENGINE_INIT_FAILED'
  | 'ENGINE_CRASH'
  | 'ENGINE_WEBGPU_UNSUPPORTED'
  | 'ENGINE_COMMAND_FAILED'
  // Publishing
  | 'PUBLISH_FAILED'
  | 'PUBLISH_SLUG_TAKEN'
  // Save / Load
  | 'SAVE_FAILED'
  | 'LOAD_FAILED'
  | 'ASSET_LOAD_FAILED'
  // Generic
  | 'UNKNOWN';

export const USER_MESSAGES: Record<ErrorCode, FriendlyErrorEntry> = {
  // ─── Network ──────────────────────────────────────────────────────────────
  NETWORK_ERROR: {
    title: 'Connection lost',
    message: 'Check your internet connection and try again.',
    actionLabel: 'Try again',
    action: 'retry',
  },
  TIMEOUT: {
    title: 'Request timed out',
    message: 'That took longer than expected. Try again — it usually works on a second attempt.',
    actionLabel: 'Try again',
    action: 'retry',
  },
  OFFLINE: {
    title: "You're offline",
    message: 'SpawnForge needs an internet connection. Reconnect and your work will resume.',
    actionLabel: 'Dismiss',
    action: 'dismiss',
  },

  // ─── Auth ─────────────────────────────────────────────────────────────────
  AUTH_EXPIRED: {
    title: 'Session expired',
    message: 'Please sign in again to continue where you left off.',
    actionLabel: 'Sign in',
    action: 'sign-in',
  },
  AUTH_FORBIDDEN: {
    title: "You don't have access",
    message: "You don't have permission to do that. Contact the project owner if this seems wrong.",
    actionLabel: 'Contact support',
    action: 'contact',
  },
  AUTH_REQUIRED: {
    title: 'Sign in required',
    message: 'Create a free account or sign in to continue.',
    actionLabel: 'Sign in',
    action: 'sign-in',
  },

  // ─── Billing ──────────────────────────────────────────────────────────────
  PUBLISH_LIMIT: {
    title: 'Publish limit reached',
    message: 'Upgrade your plan to publish more games and share them with the world.',
    actionLabel: 'Upgrade plan',
    action: 'upgrade',
  },
  STORAGE_LIMIT: {
    title: 'Storage limit reached',
    message: 'You have used all your available storage. Upgrade to get more space for your projects.',
    actionLabel: 'Upgrade plan',
    action: 'upgrade',
  },
  TOKEN_LIMIT: {
    title: 'AI credits used up',
    message: "You've used all your AI credits for this period. Upgrade to get more, or wait until they reset.",
    actionLabel: 'Upgrade plan',
    action: 'upgrade',
  },
  TIER_REQUIRED: {
    title: 'Feature not available on your plan',
    message: 'This feature is included in a higher plan. Upgrade to unlock it.',
    actionLabel: 'Upgrade plan',
    action: 'upgrade',
  },

  // ─── AI Generation ────────────────────────────────────────────────────────
  GENERATION_FAILED: {
    title: "Generation didn't work",
    message: "The AI couldn't complete this request. Try simplifying your prompt or describing it differently.",
    actionLabel: 'Try again',
    action: 'retry',
  },
  GENERATION_TIMEOUT: {
    title: 'Generation is taking too long',
    message: 'The AI is busy right now. Try a shorter or simpler request.',
    actionLabel: 'Try again',
    action: 'retry',
  },
  GENERATION_CONTENT_POLICY: {
    title: 'Request not allowed',
    message: 'That request goes against our content guidelines. Try a different description.',
    actionLabel: 'Dismiss',
    action: 'dismiss',
  },
  GENERATION_PROVIDER_DOWN: {
    title: 'AI service unavailable',
    message: "The AI provider is temporarily down. Everything you've built is safe — try again in a few minutes.",
    actionLabel: 'Try again',
    action: 'retry',
  },

  // ─── Engine ───────────────────────────────────────────────────────────────
  ENGINE_INIT_FAILED: {
    title: 'Engine failed to start',
    message: 'There was a problem loading the game engine. Reloading the page usually fixes this.',
    actionLabel: 'Reload page',
    action: 'refresh',
  },
  ENGINE_CRASH: {
    title: 'Engine encountered an error',
    message: 'Something unexpected happened. Your scene has been auto-saved. Reloading should get you back on track.',
    actionLabel: 'Reload page',
    action: 'refresh',
  },
  ENGINE_WEBGPU_UNSUPPORTED: {
    title: 'Your browser needs an update',
    message: 'SpawnForge works best with WebGPU. Update your browser or try Chrome to get the best experience.',
    actionLabel: 'Dismiss',
    action: 'dismiss',
  },
  ENGINE_COMMAND_FAILED: {
    title: 'Action could not be completed',
    message: "That action didn't work. Try undoing and repeating the step, or reload if the problem continues.",
    actionLabel: 'Dismiss',
    action: 'dismiss',
  },

  // ─── Publishing ───────────────────────────────────────────────────────────
  PUBLISH_FAILED: {
    title: 'Publish failed',
    message: 'Your game could not be published right now. Your work is saved — try again in a moment.',
    actionLabel: 'Try again',
    action: 'retry',
  },
  PUBLISH_SLUG_TAKEN: {
    title: 'That URL is already taken',
    message: 'Choose a different name for your game URL and try publishing again.',
    actionLabel: 'Dismiss',
    action: 'dismiss',
  },

  // ─── Save / Load ──────────────────────────────────────────────────────────
  SAVE_FAILED: {
    title: 'Changes not saved',
    message: 'Your recent changes could not be saved. Try again — if the problem continues, export a local backup.',
    actionLabel: 'Try again',
    action: 'retry',
  },
  LOAD_FAILED: {
    title: 'Project could not be opened',
    message: 'There was a problem loading your project. Go back to the dashboard and try opening it again.',
    actionLabel: 'Go to dashboard',
    action: 'dismiss',
  },
  ASSET_LOAD_FAILED: {
    title: 'Asset could not be loaded',
    message: 'One or more assets failed to load. Try refreshing the page or re-importing the asset.',
    actionLabel: 'Try again',
    action: 'retry',
  },

  // ─── Generic ──────────────────────────────────────────────────────────────
  UNKNOWN: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred. Try again, or contact support if the problem keeps happening.',
    actionLabel: 'Try again',
    action: 'retry',
  },
};

/**
 * Look up a user-friendly error entry by its code.
 * Falls back to UNKNOWN for unrecognised codes.
 */
export function getUserMessage(code: string): FriendlyErrorEntry {
  if (code in USER_MESSAGES) {
    return USER_MESSAGES[code as ErrorCode];
  }
  return USER_MESSAGES.UNKNOWN;
}
