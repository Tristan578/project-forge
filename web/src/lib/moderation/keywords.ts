/**
 * Keyword-based spam detection for community content moderation.
 *
 * FIX (PF-457): Multi-word phrases like "act now" previously used plain
 * substring matching (text.includes(phrase)), which caused false positives
 * on words like "react now" or "interact now". Now uses word-boundary
 * regex (\b...\b) to ensure each word matches as a complete word.
 */

const SPAM_KEYWORDS: string[] = [
  'viagra', 'cialis', 'cryptocurrency', 'nft', 'airdrop',
  'giveaway', 'lottery', 'jackpot', 'casino', 'betting',
];

const SPAM_PHRASES: string[] = [
  'act now', 'buy now', 'click here', 'free money',
  'make money fast', 'limited offer', 'double your',
  'no risk', 'sign up free', 'work from home',
  'earn extra cash', 'get rich', 'online income',
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a word-boundary regex for a phrase.
 * Each word gets \b boundaries to prevent substring false positives.
 * "act now" -> /\bact\b\s+\bnow\b/i (matches "act now" NOT "react now")
 */
function buildPhraseRegex(phrase: string): RegExp {
  const words = phrase.trim().split(/\s+/);
  const pattern = words
    .map((w) => '\\b' + escapeRegex(w) + '\\b')
    .join('\\s+');
  return new RegExp(pattern, 'i');
}

export interface KeywordMatchResult {
  matched: boolean;
  matches: string[];
}

export function matchSpamKeywords(text: string): KeywordMatchResult {
  const matches: string[] = [];

  for (const keyword of SPAM_KEYWORDS) {
    const regex = new RegExp('\\b' + escapeRegex(keyword) + '\\b', 'i');
    if (regex.test(text)) {
      matches.push(keyword);
    }
  }

  for (const phrase of SPAM_PHRASES) {
    const regex = buildPhraseRegex(phrase);
    if (regex.test(text)) {
      matches.push(phrase);
    }
  }

  return { matched: matches.length > 0, matches };
}

export function getSpamKeywords(): { keywords: string[]; phrases: string[] } {
  return { keywords: [...SPAM_KEYWORDS], phrases: [...SPAM_PHRASES] };
}
