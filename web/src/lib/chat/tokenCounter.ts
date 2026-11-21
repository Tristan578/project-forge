/**
 * Token estimation utilities for chat context management.
 *
 * Uses a ~4 chars/token heuristic for English text, which is a reasonable
 * approximation for Claude's tokenizer without requiring a WASM tokenizer.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a text string.
 * Uses ~4 chars/token heuristic.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a structured API message (handles string and array content).
 */
export function estimateMessageTokens(message: { role: string; content: unknown }): number {
  // Role overhead: ~4 tokens for role + formatting
  let tokens = 4;

  if (typeof message.content === 'string') {
    tokens += estimateTokenCount(message.content);
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          tokens += estimateTokenCount(b.text);
        } else if (b.type === 'tool_use') {
          // tool_use blocks: name + JSON input
          tokens += estimateTokenCount(JSON.stringify(b.input || {}));
          tokens += estimateTokenCount(String(b.name || ''));
        } else if (b.type === 'tool_result') {
          tokens += estimateTokenCount(String(b.content || ''));
        } else if (b.type === 'image') {
          // Images are ~1600 tokens for typical size
          tokens += 1600;
        }
      }
    }
  }

  return tokens;
}

/**
 * Format a token count for display.
 */
export function formatTokenEstimate(tokens: number): string {
  if (tokens < 1000) return `~${tokens}`;
  return `~${(tokens / 1000).toFixed(1)}k`;
}
