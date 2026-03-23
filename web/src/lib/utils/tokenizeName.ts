/**
 * Splits entity names into searchable keywords.
 *
 * Handles common naming conventions used in game engines:
 *   - snake_case:   "Player_Character_01" → ["player", "character", "01"]
 *   - PascalCase:   "RedDragon"           → ["red", "dragon"]
 *   - camelCase:    "playerHealth"        → ["player", "health"]
 *   - kebab-case:   "boss-enemy"          → ["boss", "enemy"]
 *   - spaces:       "Big Rock"            → ["big", "rock"]
 *   - mixed:        "EnemySpawner_01"     → ["enemy", "spawner", "01"]
 *
 * Used by scene search, entity @-mentions, and AI context building
 * to provide a single canonical splitting implementation.
 */
export function tokenizeName(name: string): string[] {
  if (!name || typeof name !== 'string') return [];

  // 1. Insert a separator at case and letter/digit boundaries so the regex
  //    split in step 2 produces fine-grained tokens.
  const withBoundaries = name
    // camelCase / PascalCase: lowercase-to-uppercase boundary
    // "RedDragon" → "Red Dragon", "playerHealth" → "player Health"
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Acronym followed by a capitalised word: "HTTPSRequest" → "HTTPS Request"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Letter-to-digit boundary: "Enemy3" → "Enemy 3", "platform3Jump" → "platform 3 Jump"
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    // Digit-to-letter boundary: "3D" → "3 D", "01Player" → "01 Player"
    .replace(/(\d)([a-zA-Z])/g, '$1 $2');

  // 2. Split on any non-alphanumeric character (underscore, hyphen, space, dot, etc.)
  const parts = withBoundaries.split(/[^a-zA-Z0-9]+/);

  // 3. Lowercase, filter empties and single-character noise tokens
  return parts
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 0);
}
