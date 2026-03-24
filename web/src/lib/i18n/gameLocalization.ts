/**
 * Game text localization pipeline.
 *
 * Extracts all user-authored translatable strings from a scene graph,
 * formats them for LLM batch translation, and parses the response back
 * into a per-locale dictionary.
 *
 * This module is pure functions only — no I/O, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranslatableString {
  /** Stable identifier used as the dictionary key (e.g. "entity.abc123.name"). */
  id: string;
  /** The source text to translate. */
  text: string;
  /** Contextual hint for the translator — helps with game-specific meaning. */
  context: string;
}

export interface LocaleBundle {
  /** BCP-47 locale code (e.g. "ja", "fr", "zh-CN"). */
  locale: string;
  /** Map of string ID to translated text. */
  translations: Record<string, string>;
}

export interface LocaleDefinition {
  /** BCP-47 code. */
  code: string;
  /** Human-readable name in English. */
  displayName: string;
  /** Native name (shown to speakers of that language). */
  nativeName: string;
  /** Reading direction. */
  direction: 'ltr' | 'rtl';
}

// ---------------------------------------------------------------------------
// Supported locales (50+)
// ---------------------------------------------------------------------------

export const SUPPORTED_LOCALES: LocaleDefinition[] = [
  // European — Western
  { code: 'en', displayName: 'English', nativeName: 'English', direction: 'ltr' },
  { code: 'fr', displayName: 'French', nativeName: 'Français', direction: 'ltr' },
  { code: 'de', displayName: 'German', nativeName: 'Deutsch', direction: 'ltr' },
  { code: 'es', displayName: 'Spanish', nativeName: 'Español', direction: 'ltr' },
  { code: 'pt', displayName: 'Portuguese', nativeName: 'Português', direction: 'ltr' },
  { code: 'pt-BR', displayName: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', direction: 'ltr' },
  { code: 'it', displayName: 'Italian', nativeName: 'Italiano', direction: 'ltr' },
  { code: 'nl', displayName: 'Dutch', nativeName: 'Nederlands', direction: 'ltr' },
  { code: 'pl', displayName: 'Polish', nativeName: 'Polski', direction: 'ltr' },
  { code: 'cs', displayName: 'Czech', nativeName: 'Čeština', direction: 'ltr' },
  { code: 'sk', displayName: 'Slovak', nativeName: 'Slovenčina', direction: 'ltr' },
  { code: 'hu', displayName: 'Hungarian', nativeName: 'Magyar', direction: 'ltr' },
  { code: 'ro', displayName: 'Romanian', nativeName: 'Română', direction: 'ltr' },
  { code: 'bg', displayName: 'Bulgarian', nativeName: 'Български', direction: 'ltr' },
  { code: 'hr', displayName: 'Croatian', nativeName: 'Hrvatski', direction: 'ltr' },
  { code: 'sr', displayName: 'Serbian', nativeName: 'Српски', direction: 'ltr' },
  { code: 'uk', displayName: 'Ukrainian', nativeName: 'Українська', direction: 'ltr' },
  { code: 'ru', displayName: 'Russian', nativeName: 'Русский', direction: 'ltr' },
  // European — Nordic
  { code: 'sv', displayName: 'Swedish', nativeName: 'Svenska', direction: 'ltr' },
  { code: 'da', displayName: 'Danish', nativeName: 'Dansk', direction: 'ltr' },
  { code: 'no', displayName: 'Norwegian', nativeName: 'Norsk', direction: 'ltr' },
  { code: 'fi', displayName: 'Finnish', nativeName: 'Suomi', direction: 'ltr' },
  // Asian — CJK
  { code: 'ja', displayName: 'Japanese', nativeName: '日本語', direction: 'ltr' },
  { code: 'ko', displayName: 'Korean', nativeName: '한국어', direction: 'ltr' },
  { code: 'zh-CN', displayName: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr' },
  { code: 'zh-TW', displayName: 'Chinese (Traditional)', nativeName: '繁體中文', direction: 'ltr' },
  // Asian — SEA
  { code: 'id', displayName: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr' },
  { code: 'ms', displayName: 'Malay', nativeName: 'Bahasa Melayu', direction: 'ltr' },
  { code: 'th', displayName: 'Thai', nativeName: 'ไทย', direction: 'ltr' },
  { code: 'vi', displayName: 'Vietnamese', nativeName: 'Tiếng Việt', direction: 'ltr' },
  { code: 'tl', displayName: 'Filipino', nativeName: 'Filipino', direction: 'ltr' },
  // Asian — South
  { code: 'hi', displayName: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr' },
  { code: 'bn', displayName: 'Bengali', nativeName: 'বাংলা', direction: 'ltr' },
  { code: 'ta', displayName: 'Tamil', nativeName: 'தமிழ்', direction: 'ltr' },
  { code: 'te', displayName: 'Telugu', nativeName: 'తెలుగు', direction: 'ltr' },
  { code: 'mr', displayName: 'Marathi', nativeName: 'मराठी', direction: 'ltr' },
  // Middle East — RTL
  { code: 'ar', displayName: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  { code: 'he', displayName: 'Hebrew', nativeName: 'עברית', direction: 'rtl' },
  { code: 'fa', displayName: 'Persian', nativeName: 'فارسی', direction: 'rtl' },
  { code: 'ur', displayName: 'Urdu', nativeName: 'اردو', direction: 'rtl' },
  // African
  { code: 'sw', displayName: 'Swahili', nativeName: 'Kiswahili', direction: 'ltr' },
  { code: 'af', displayName: 'Afrikaans', nativeName: 'Afrikaans', direction: 'ltr' },
  { code: 'am', displayName: 'Amharic', nativeName: 'አማርኛ', direction: 'ltr' },
  // Americas
  { code: 'es-MX', displayName: 'Spanish (Mexico)', nativeName: 'Español (México)', direction: 'ltr' },
  { code: 'es-419', displayName: 'Spanish (Latin America)', nativeName: 'Español (Latinoamérica)', direction: 'ltr' },
  // Other
  { code: 'tr', displayName: 'Turkish', nativeName: 'Türkçe', direction: 'ltr' },
  { code: 'el', displayName: 'Greek', nativeName: 'Ελληνικά', direction: 'ltr' },
  { code: 'ca', displayName: 'Catalan', nativeName: 'Català', direction: 'ltr' },
  { code: 'eu', displayName: 'Basque', nativeName: 'Euskara', direction: 'ltr' },
  { code: 'lt', displayName: 'Lithuanian', nativeName: 'Lietuvių', direction: 'ltr' },
  { code: 'lv', displayName: 'Latvian', nativeName: 'Latviešu', direction: 'ltr' },
  { code: 'et', displayName: 'Estonian', nativeName: 'Eesti', direction: 'ltr' },
];

/** Fast lookup from BCP-47 code to definition. */
export const LOCALE_MAP: Map<string, LocaleDefinition> = new Map(
  SUPPORTED_LOCALES.map((l) => [l.code, l])
);

// ---------------------------------------------------------------------------
// Scene graph extraction types (minimal shape — avoids importing full store)
// ---------------------------------------------------------------------------

interface SceneNode {
  entityId: string;
  name: string;
}

interface DialogueNode {
  id: string;
  type: string;
  text?: string;
  choices?: Array<{ id: string; label: string }>;
  speakerName?: string;
}

interface UiWidget {
  id: string;
  type: string;
  text?: string;
  placeholder?: string;
  label?: string;
}

export interface SceneForExtraction {
  nodes?: Record<string, SceneNode>;
  dialogueTrees?: Record<string, { nodes?: Record<string, DialogueNode> }>;
  uiWidgets?: Record<string, UiWidget>;
}

// ---------------------------------------------------------------------------
// String extraction
// ---------------------------------------------------------------------------

/**
 * Walk a scene graph, dialogue trees, and UI widgets to collect all
 * user-authored text with contextual metadata.
 *
 * Only includes strings that are non-empty, non-whitespace, and
 * meaningfully longer than a single character.
 */
export function extractTranslatableStrings(scene: SceneForExtraction): TranslatableString[] {
  const strings: TranslatableString[] = [];

  // 1. Entity display names
  if (scene.nodes) {
    for (const [entityId, node] of Object.entries(scene.nodes)) {
      const text = (node.name ?? '').trim();
      if (text.length > 1) {
        strings.push({
          id: `entity.${entityId}.name`,
          text,
          context: 'Entity name shown in the game scene',
        });
      }
    }
  }

  // 2. Dialogue tree content
  if (scene.dialogueTrees) {
    for (const [treeId, tree] of Object.entries(scene.dialogueTrees)) {
      if (!tree.nodes) continue;
      for (const [nodeId, node] of Object.entries(tree.nodes)) {
        // Main text
        if (node.text && node.text.trim().length > 0) {
          strings.push({
            id: `dialogue.${treeId}.${nodeId}.text`,
            text: node.text.trim(),
            context: node.speakerName
              ? `Dialogue spoken by "${node.speakerName}"`
              : 'Dialogue text displayed to player',
          });
        }
        // Speaker name
        if (node.speakerName && node.speakerName.trim().length > 1) {
          strings.push({
            id: `dialogue.${treeId}.${nodeId}.speaker`,
            text: node.speakerName.trim(),
            context: 'Name of the character speaking this dialogue',
          });
        }
        // Choice labels
        if (node.choices) {
          for (const choice of node.choices) {
            if (choice.label && choice.label.trim().length > 0) {
              strings.push({
                id: `dialogue.${treeId}.${nodeId}.choice.${choice.id}`,
                text: choice.label.trim(),
                context: 'Player dialogue choice option',
              });
            }
          }
        }
      }
    }
  }

  // 3. UI widget text
  if (scene.uiWidgets) {
    for (const [widgetId, widget] of Object.entries(scene.uiWidgets)) {
      const widgetType = widget.type ?? 'UI element';
      if (widget.text && widget.text.trim().length > 0) {
        strings.push({
          id: `ui.${widgetId}.text`,
          text: widget.text.trim(),
          context: `Text on a ${widgetType} UI element`,
        });
      }
      if (widget.label && widget.label.trim().length > 0) {
        strings.push({
          id: `ui.${widgetId}.label`,
          text: widget.label.trim(),
          context: `Label for a ${widgetType} UI element`,
        });
      }
      if (widget.placeholder && widget.placeholder.trim().length > 0) {
        strings.push({
          id: `ui.${widgetId}.placeholder`,
          text: widget.placeholder.trim(),
          context: `Placeholder text for a ${widgetType} input`,
        });
      }
    }
  }

  // Deduplicate by ID (last writer wins)
  const seen = new Map<string, TranslatableString>();
  for (const s of strings) {
    seen.set(s.id, s);
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

/**
 * Build a context-aware prompt for LLM batch translation.
 *
 * Preserves variables (`{varName}`), HTML tags, and emoji.
 * Chunks are expected to be at most 200 strings.
 */
export function buildTranslationPrompt(
  strings: TranslatableString[],
  sourceLocale: string,
  targetLocale: string
): string {
  const sourceDef = LOCALE_MAP.get(sourceLocale);
  const targetDef = LOCALE_MAP.get(targetLocale);
  const sourceName = sourceDef?.displayName ?? sourceLocale;
  const targetName = targetDef?.displayName ?? targetLocale;

  const stringsJson = JSON.stringify(
    strings.map((s) => ({ id: s.id, text: s.text, context: s.context })),
    null,
    2
  );

  return `You are translating text for a video game from ${sourceName} to ${targetName}.

CRITICAL RULES:
1. Preserve ALL variable placeholders exactly as-is (e.g. {playerName}, {score}, {count}).
2. Preserve ALL HTML tags exactly as-is (e.g. <b>, <color=#ff0000>).
3. Preserve ALL emoji exactly as-is.
4. Preserve newlines and spacing structure.
5. Translate ONLY the text content — never translate the "id" or "context" fields.
6. Return ONLY a valid JSON object mapping string IDs to translated text.
7. Every ID in the input MUST appear in the output.
8. Game-specific nouns (item names, character names, place names) may be transliterated if there is no natural translation.

Input strings (${strings.length} total):
${stringsJson}

Respond with ONLY a JSON object in this exact format:
{
  "<id>": "<translated text>",
  ...
}`;
}

// ---------------------------------------------------------------------------
// Variable preservation validation
// ---------------------------------------------------------------------------

/** Extract all {varName} placeholders from a string. */
function extractVariables(text: string): Set<string> {
  const found = new Set<string>();
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    found.add(match[1]);
  }
  return found;
}

/** Return true if all source variables are present in the translation. */
function variablesPreserved(source: string, translation: string): boolean {
  const srcVars = extractVariables(source);
  if (srcVars.size === 0) return true;
  const dstVars = extractVariables(translation);
  for (const v of srcVars) {
    if (!dstVars.has(v)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export interface ParseResult {
  translations: Record<string, string>;
  /** IDs that were in the request but missing from the response. */
  missing: string[];
  /** IDs whose variable placeholders were not preserved. */
  variableErrors: string[];
}

/**
 * Parse and validate the LLM translation response.
 *
 * - Accepts raw JSON text from the model.
 * - Falls back to source text for missing or over-length strings.
 * - Validates variable preservation for each translation.
 */
export function parseTranslationResponse(
  rawResponse: string,
  sourceStrings: TranslatableString[]
): ParseResult {
  const sourceMap = new Map<string, string>(sourceStrings.map((s) => [s.id, s.text]));
  const missing: string[] = [];
  const variableErrors: string[] = [];

  let parsed: Record<string, unknown>;
  try {
    // Strip markdown code fences if the model wraps its response
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // If we cannot parse at all, fall back to source text for all strings
    const translations: Record<string, string> = {};
    for (const s of sourceStrings) {
      translations[s.id] = s.text;
      missing.push(s.id);
    }
    return { translations, missing, variableErrors };
  }

  const translations: Record<string, string> = {};

  for (const s of sourceStrings) {
    const raw = parsed[s.id];

    // Validate type and length (cap at 10x source length to catch hallucination)
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      translations[s.id] = sourceMap.get(s.id) ?? s.text; // fallback to source
      missing.push(s.id);
      continue;
    }

    const translation = raw.trim();
    const maxLen = Math.max(s.text.length * 10, 500);
    const safeTranslation = translation.length > maxLen ? s.text : translation;

    if (!variablesPreserved(s.text, safeTranslation)) {
      variableErrors.push(s.id);
      // Still use the translation but log the error — don't silently drop
    }

    translations[s.id] = safeTranslation;
  }

  return { translations, missing, variableErrors };
}

// ---------------------------------------------------------------------------
// Chunk helper
// ---------------------------------------------------------------------------

/** Split an array into chunks of at most `size` elements. */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
