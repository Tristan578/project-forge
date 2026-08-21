/**
 * Trademark / copyrighted IP name filter for game titles and slugs.
 *
 * Prevents users from publishing games whose title or slug references
 * well-known copyrighted/trademarked video game IPs. This protects
 * SpawnForge from hosting content that implies endorsement or ownership
 * of third-party IP, and from making structured claims about such content.
 *
 * Returns the matched IP names so a descriptive error can be surfaced to
 * the user. The list is intentionally focused on major gaming franchises;
 * additional terms can be supplied via the TRADEMARK_BLOCK_LIST env var
 * (comma-separated).
 */

export interface TrademarkResult {
  /** True if one or more protected IP names were referenced */
  matched: boolean;
  /** Human-readable names of the matched IPs */
  matches: string[];
}

// Known protected gaming IPs. Patterns are case-insensitive and match as
// whole words within titles and slugs. Slugs use hyphens instead of spaces,
// so multi-word patterns allow optional hyphen/space separators.
const TRADEMARK_PATTERNS: { pattern: RegExp; name: string }[] = [
  { name: 'Sonic the Hedgehog', pattern: /\bsonic\b/i },
  { name: 'Mario', pattern: /\bmario\b/i },
  { name: 'Nintendo', pattern: /\bnintendo\b/i },
  { name: 'Sega', pattern: /\bsega\b/i },
  { name: 'Pokemon', pattern: /(^|\W)pok[eé]mon(\W|$)/i },
  { name: 'Animal Crossing', pattern: /\banimal[\s-]*crossing\b/i },
  { name: 'The Legend of Zelda', pattern: /\bzelda\b/i },
  { name: 'Metroid', pattern: /\bmetroid\b/i },
  { name: 'Kirby', pattern: /\bkirby\b/i },
  { name: 'Star Fox', pattern: /\bstar[\s-]*fox\b/i },
  { name: 'Donkey Kong', pattern: /\bdonkey[\s-]*kong\b/i },
  { name: 'Final Fantasy', pattern: /\bfinal[\s-]*fantasy\b/i },
  { name: 'Kingdom Hearts', pattern: /\bkingdom[\s-]*hearts\b/i },
  { name: 'Halo', pattern: /\bhalo\b/i },
  { name: 'Gears of War', pattern: /\bgears[\s-]*of[\s-]*war\b/i },
  { name: 'Forza', pattern: /\bforza\b/i },
  { name: 'Gran Turismo', pattern: /\bgran[\s-]*turismo\b/i },
  { name: 'God of War', pattern: /\bgod[\s-]*of[\s-]*war\b/i },
  { name: 'Uncharted', pattern: /\buncharted\b/i },
  { name: 'The Last of Us', pattern: /\bthe[\s-]*last[\s-]*of[\s-]*us\b/i },
  { name: 'Crash Bandicoot', pattern: /\bcrash[\s-]*bandicoot\b/i },
  { name: 'Spyro', pattern: /\bspyro\b/i },
  { name: 'Tomb Raider', pattern: /\btomb[\s-]*raider\b/i },
  { name: 'Minecraft', pattern: /\bminecraft\b/i },
  { name: 'Fortnite', pattern: /\bfortnite\b/i },
  { name: "Assassin's Creed", pattern: /\bassassin'?s?[\s-]*creed\b/i },
  { name: 'Call of Duty', pattern: /\bcall[\s-]*of[\s-]*duty\b/i },
  { name: 'Tetris', pattern: /\btetris\b/i },
  { name: 'Pac-Man', pattern: /\bpac[\s-]*man\b/i },
  { name: 'Street Fighter', pattern: /\bstreet[\s-]*fighter\b/i },
  { name: 'Mortal Kombat', pattern: /\bmortal[\s-]*kombat\b/i },
  { name: "Baldur's Gate", pattern: /\bbaldur'?s?[\s-]*gate\b/i },
  { name: 'World of Warcraft', pattern: /\bworld[\s-]*of[\s-]*warcraft\b/i },
  { name: 'Diablo', pattern: /\bdiablo\b/i },
  { name: 'Overwatch', pattern: /\boverwatch\b/i },
  { name: 'League of Legends', pattern: /\bleague[\s-]*of[\s-]*legends\b/i },
  { name: 'Roblox', pattern: /\broblox\b/i },
  { name: 'The Sims', pattern: /\bthe[\s-]*sims\b/i },
  { name: 'Splatoon', pattern: /\bsplatoon\b/i },
  { name: 'Pikmin', pattern: /\bpikmin\b/i },
  { name: 'Super Smash Bros', pattern: /\bsmash[\s-]*brothers?\b|\bsmash[\s-]*bros?\b/i },
];

/**
 * Check whether text references any known protected gaming IP.
 * Returns the list of matched IP names (empty if none).
 */
export function checkTrademark(text: string): TrademarkResult {
  const matches: string[] = [];

  for (const { pattern, name } of TRADEMARK_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(name);
    }
  }

  // Check custom list from env (comma-separated additional terms).
  // Replace spaces/hyphens in the term with [\s-]* so multi-word terms
  // match both titles (spaces) and slugs (hyphens).
  for (const term of getCustomTrademarkList()) {
    const escaped = escapeRegex(term).replace(/\\?[\s-]+/g, '[\\s-]*');
    const regex = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'gi');
    if (regex.test(text)) {
      matches.push(term);
    }
  }

  return { matched: matches.length > 0, matches: [...new Set(matches)] };
}

/** Parse custom trademark block list from environment variable */
function getCustomTrademarkList(): string[] {
  const raw = process.env.TRADEMARK_BLOCK_LIST ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
