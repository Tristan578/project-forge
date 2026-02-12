/**
 * Initialization logging and persistence for debugging.
 */

export type InitPhase =
  | 'wasm_loading'
  | 'wasm_loaded'
  | 'engine_starting'
  | 'bevy_plugins'
  | 'renderer_init'
  | 'scene_setup'
  | 'ready'
  | 'error';

export interface InitEvent {
  phase: InitPhase;
  timestamp: number;
  message?: string;
  error?: string;
}

export interface StoredLog {
  sessionId: string;
  userAgent: string;
  timestamp: string;
  events: InitEvent[];
}

const STORAGE_KEY = 'forge_init_log';
const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

// Generate a simple session ID
function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Get or create session ID
let sessionId: string | null = null;
function getSessionId(): string {
  if (sessionId) return sessionId;
  if (typeof sessionStorage !== 'undefined') {
    sessionId = sessionStorage.getItem('forge_session_id');
    if (!sessionId) {
      sessionId = generateSessionId();
      sessionStorage.setItem('forge_session_id', sessionId);
    }
  } else {
    sessionId = generateSessionId();
  }
  return sessionId;
}

// In-memory event storage (for SSR safety)
let events: InitEvent[] = [];

/**
 * Log an initialization event.
 */
export function logInitEvent(
  phase: InitPhase,
  message?: string,
  error?: string
): InitEvent {
  const event: InitEvent = {
    phase,
    timestamp: typeof performance !== 'undefined'
      ? performance.now() - startTime
      : Date.now() - startTime,
    message,
    error,
  };

  events.push(event);
  persistLog();

  // Console logging with timing
  const timeStr = `${event.timestamp.toFixed(0)}ms`;
  const prefix = '[Forge]';

  if (error) {
    console.error(`${prefix} ${phase} - ${timeStr} - ERROR: ${error}`);
  } else if (message) {
    console.log(`${prefix} ${phase} - ${timeStr} - ${message}`);
  } else {
    console.log(`${prefix} ${phase} - ${timeStr}`);
  }

  return event;
}

/**
 * Get all logged events.
 */
export function getInitEvents(): InitEvent[] {
  return [...events];
}

/**
 * Clear all logged events (for retry).
 */
export function clearInitEvents(): void {
  events = [];
  persistLog();
}

/**
 * Persist current events to sessionStorage.
 */
function persistLog(): void {
  if (typeof sessionStorage === 'undefined') return;

  const log: StoredLog = {
    sessionId: getSessionId(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    timestamp: new Date().toISOString(),
    events,
  };

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage full or unavailable - ignore
  }
}

/**
 * Load persisted log from sessionStorage.
 */
export function loadPersistedLog(): StoredLog | null {
  if (typeof sessionStorage === 'undefined') return null;

  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const log = JSON.parse(stored) as StoredLog;
      events = log.events;
      return log;
    }
  } catch {
    // Parse error - ignore
  }
  return null;
}

/**
 * Export initialization log as formatted text for bug reports.
 */
export function exportInitLog(): string {
  const log: StoredLog = {
    sessionId: getSessionId(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    timestamp: new Date().toISOString(),
    events,
  };

  const lines: string[] = [
    '=== Forge Engine Initialization Log ===',
    '',
    `Session ID: ${log.sessionId}`,
    `Timestamp: ${log.timestamp}`,
    `User Agent: ${log.userAgent}`,
    '',
    '--- Events ---',
    '',
  ];

  for (const event of events) {
    const timeStr = `${event.timestamp.toFixed(0)}ms`.padStart(8);
    let line = `[${timeStr}] ${event.phase}`;
    if (event.message) {
      line += ` - ${event.message}`;
    }
    if (event.error) {
      line += ` - ERROR: ${event.error}`;
    }
    lines.push(line);
  }

  lines.push('');
  lines.push('--- Raw JSON ---');
  lines.push('');
  lines.push(JSON.stringify(log, null, 2));

  return lines.join('\n');
}

/**
 * Copy initialization log to clipboard.
 */
export async function copyInitLogToClipboard(): Promise<boolean> {
  const text = exportInitLog();

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Clipboard API failed
    }
  }

  // Fallback: create a textarea and copy
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      document.body.removeChild(textarea);
    }
  }

  return false;
}
