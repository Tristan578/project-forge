/**
 * Content moderation filter for community-generated text.
 *
 * Provides severity-based filtering for game titles, descriptions,
 * and comments. Uses a built-in word list (no external dependencies).
 *
 * Severity levels:
 * - block: Content rejected outright (slurs, extreme content)
 * - flag: Content auto-flagged for admin review (profanity, harassment)
 * - pass: Content is clean
 */

export type ModerationSeverity = 'block' | 'flag' | 'pass';

export interface ModerationResult {
  severity: ModerationSeverity;
  reasons: string[];
  /** The cleaned text with blocked words replaced by asterisks */
  cleaned: string;
}

// Words that cause immediate rejection (severe slurs, threats, etc.)
// Kept intentionally minimal — extend via MODERATION_BLOCK_LIST env var
const BLOCK_PATTERNS: RegExp[] = [
  /\bn[i1!]gg[ae3]r?s?\b/i,
  /\bf[a@]gg?[o0]ts?\b/i,
  /\bk[i1!]ll\s+(your|my|him|her|them)self\b/i,
  /\bk[iy]s\b/i,  // "kys" abbreviation
  /\b(bomb|shoot|murder)\s+(the|a)\s+(school|mosque|church|synagogue)\b/i,
];

// Words that trigger auto-flagging for admin review
const FLAG_PATTERNS: RegExp[] = [
  /\bf+u+c+k+/i,
  /\bs+h+[i1!]+t+/i,
  /\bb[i1!]tch/i,
  /\ba+s+s+h+o+l+e+/i,
  /\bd[i1!]ck(?:head|wad|face)?s?\b/i,
  /\bcunt/i,
  /\bwh[o0]re/i,
  /\bretard/i,
  /\bstfu\b/i,
  /\bwtf\b/i,
  /\blmfa?o\b/i,
  /\bporn/i,
  /\bnude?s?\b/i,
  /\bsex(?:ual|ting|y)?\b/i,
  /\bp[e3]nis/i,
  /\bvag[i1]na/i,
  /\brap[ei]/i,
  /\bsuicid/i,
  /\bself[- ]?harm/i,
  /\b(?:hate|kill)\s+(?:all|every)\b/i,
];

// Spam patterns (excessive caps, repeated chars, link spam)
const SPAM_PATTERNS: RegExp[] = [
  /(.)\1{5,}/,                          // Same char repeated 6+ times
  /[A-Z\s]{20,}/,                       // 20+ consecutive uppercase chars
  /(https?:\/\/\S+\s*){3,}/i,          // 3+ URLs in content
  /\b(buy|cheap|discount|free money)\b/i,
  /\b(www\.|\.com|\.net|\.xyz)\b/i,     // URL fragments
];

/**
 * Check text content against moderation rules.
 * Returns severity level and reasons for the decision.
 */
export function moderateContent(text: string): ModerationResult {
  const reasons: string[] = [];
  let severity: ModerationSeverity = 'pass';
  let cleaned = text;

  // Check block patterns first (highest severity)
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(text)) {
      severity = 'block';
      reasons.push('Contains prohibited content');
      cleaned = cleaned.replace(pattern, (match) => '*'.repeat(match.length));
    }
  }

  // Check custom block list from env
  const customBlockList = getCustomBlockList();
  for (const word of customBlockList) {
    const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    if (regex.test(text)) {
      severity = 'block';
      reasons.push('Contains blocked term');
      cleaned = cleaned.replace(regex, (match) => '*'.repeat(match.length));
    }
  }

  // If already blocked, return early
  if (severity === 'block') {
    return { severity, reasons, cleaned };
  }

  // Check flag patterns
  for (const pattern of FLAG_PATTERNS) {
    if (pattern.test(text)) {
      severity = 'flag';
      reasons.push('Contains inappropriate language');
      cleaned = cleaned.replace(pattern, (match) => '*'.repeat(match.length));
    }
  }

  // Check spam patterns
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      if (severity === 'pass') severity = 'flag';
      reasons.push('Potential spam detected');
      break;
    }
  }

  return { severity, reasons: [...new Set(reasons)], cleaned };
}

/**
 * Quick check: returns true if content should be blocked.
 */
export function shouldBlock(text: string): boolean {
  return moderateContent(text).severity === 'block';
}

/**
 * Quick check: returns true if content needs admin review.
 */
export function shouldFlag(text: string): boolean {
  const result = moderateContent(text);
  return result.severity === 'flag' || result.severity === 'block';
}

/** Parse custom block list from environment variable */
function getCustomBlockList(): string[] {
  const raw = process.env.MODERATION_BLOCK_LIST ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
