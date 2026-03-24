# Spec: One-Click Game Text Localization

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-561
> **Scope:** Auto-translate all user-authored game text to 50+ languages

## Problem

Game creators on SpawnForge want to reach a global audience but lack translation skills and budget. Currently, all in-game text (UI labels, dialogue, item descriptions, NPC names) is hardcoded in the author's language. Exporting a game produces a single-language artifact. This limits distribution and marketability.

## Existing Infrastructure

- `web/src/lib/i18n/useTranslation.ts` -- wraps `next-intl` for the **editor UI** (not game text)
- `web/src/lib/scripting/forgeTypes.ts` -- `forge.*` runtime API (no i18n namespace yet)
- `web/src/app/api/generate/` -- established pattern for AI generation routes with auth, rate limiting, token billing, content safety
- `web/src/stores/generationStore.ts` -- job tracking for async AI operations
- `web/src/lib/export/scriptBundler.ts` -- export pipeline for game artifacts
- `engine/src/core/commands/scene.rs` -- scene export/load commands
- `.forge` scene format -- JSON-serializable entity snapshots

## Solution

A two-layer system: (1) an extraction + translation pipeline that collects all translatable strings from a scene, sends them to an LLM for batch translation, and stores results in a per-locale JSON dictionary; (2) a runtime resolver that swaps strings at game startup based on browser locale.

### Architecture Overview

```
Scene entities (dialogue, UI text, entity names)
    |  extract_translatable_strings (JS-side)
    v
TranslationJob { sourceLocale, targetLocales, strings[] }
    |  POST /api/generate/localize
    v
LLM batch translation (Claude / GPT-4o -- context-aware, not word-by-word)
    |
    v
LocaleBundle { locale: string, translations: Record<stringId, string> }
    |  stored in scene.locales{} alongside .forge data
    v
Exported game loads forge.i18n.t(stringId) at runtime
```

### Phase 1: String Extraction + Translation API

**Web Changes**

1. `web/src/lib/i18n/gameLocalization.ts` -- Pure-function module:
   - `extractTranslatableStrings(sceneGraph, dialogueNodes, uiWidgets): TranslatableString[]` -- walks scene graph, dialogue trees, UI builder widgets to collect all user-authored text with contextual metadata (speaker name, UI element type, etc.)
   - `buildTranslationPrompt(strings, sourceLocale, targetLocale): string` -- creates a context-aware prompt that preserves variables (`{playerName}`), HTML tags, and emoji
   - `parseTranslationResponse(response): Record<stringId, string>` -- extracts translated strings with validation (length bounds, variable preservation)
   - `SUPPORTED_LOCALES: LocaleDefinition[]` -- 50+ locales with display names and script directions (RTL support metadata)

2. `web/src/app/api/generate/localize/route.ts` -- API route following established pattern:
   - Auth via `authenticateRequest()`
   - Rate limit: 5 requests / 10 min per user (translation is expensive)
   - Token cost: `localization_batch` (new pricing tier, ~50 tokens per 100 strings per locale)
   - Input: `{ strings: TranslatableString[], sourceLocale, targetLocales: string[] }`
   - Uses AI SDK `generateText()` with structured output for reliable parsing
   - Batches large string sets (>200 strings) into chunks to stay within context limits
   - Returns: `Record<locale, Record<stringId, translatedString>>`

3. `web/src/stores/slices/localizationSlice.ts` -- Zustand slice:
   - `locales: Record<string, LocaleBundle>` -- per-locale translation dictionaries
   - `sourceLocale: string` -- default 'en'
   - `extractStrings()`, `translateToLocales(locales: string[])`, `removeLocale(locale)`
   - `previewLocale: string | null` -- live preview in editor

4. `web/src/components/editor/LocalizationPanel.tsx` -- Inspector panel:
   - Language grid with checkboxes (50+ languages, grouped by region)
   - "Translate All" button with progress indicator
   - Per-string review/edit table (source vs. translated side-by-side)
   - Preview toggle to swap editor text to a target locale
   - Export includes/excludes per locale

**MCP Commands (3 new)**

| Command | Params | Description |
|---------|--------|-------------|
| `extract_translatable_strings` | `{}` | Scan scene and return all translatable text with IDs |
| `translate_scene` | `{ targetLocales: string[], sourceLocale? }` | Batch-translate all extracted strings |
| `set_preview_locale` | `{ locale: string \| null }` | Preview translations in editor |

**Chat Handlers**

- `localizationHandlers.ts` -- "Translate my game to Japanese and Spanish", "How many strings need translation?", "Preview the French version"

### Phase 2: Runtime Integration + Export

5. `web/src/lib/export/localeExporter.ts` -- Export pipeline addition:
   - Bundles `locales/` directory into exported game with one JSON per locale
   - Injects locale-detection script that reads `navigator.language`
   - Falls back to source locale for missing translations

6. `forge.i18n` runtime namespace additions to `forgeTypes.ts`:
   - `forge.i18n.t(stringId: string): string` -- resolve string for current locale
   - `forge.i18n.setLocale(locale: string): void` -- switch at runtime
   - `forge.i18n.getLocale(): string` -- current locale
   - `forge.i18n.getAvailableLocales(): string[]` -- translated locales

### Phase 3: Incremental + Quality

7. Incremental translation -- only re-translate changed strings (diff against stored hashes)
8. Translation memory -- reuse translations from previous scenes in the same project
9. Glossary support -- user-defined term mappings (character names, invented words)

## Engine Changes (Rust)

**None in Phase 1.** Localization is entirely JS-side. Scene text lives in entity names, dialogue node text, and UI widget content -- all accessible from the web layer. The `.forge` file gains a `locales` top-level field alongside `entities`.

In Phase 2, a `set_locale` command could be added to `core/commands/scene.rs` to update entity display names in the viewport, but this is optional since preview can be handled by the React shell.

## Constraints

- **No WASM changes required** -- localization is a web-layer feature
- **Token cost scales linearly** with string count x locale count -- must batch efficiently
- **RTL languages** (Arabic, Hebrew) need CSS `direction: rtl` in exported games -- Phase 2
- **Variable interpolation** (`{playerName}`) must survive translation -- validated in `parseTranslationResponse`
- **Context window limits** -- batch strings into chunks of 200 to avoid truncation
- **Offline export** -- translated strings bundled as static JSON, no runtime API calls

## Acceptance Criteria

- Given a scene with 50 dialogue strings, When user clicks "Translate to Japanese", Then all 50 strings are translated and stored in `locales.ja` within 30 seconds
- Given a translated scene, When user exports the game, Then the exported artifact contains `locales/ja.json` and runtime resolves strings based on `navigator.language`
- Given a string containing `{playerName}`, When translated to any locale, Then the variable placeholder is preserved verbatim in the output
- Given a scene with no translatable text, When user clicks "Translate", Then a helpful message explains no strings were found
- Given an AI chat message "translate my game to French and German", When processed, Then `translate_scene` is called with `targetLocales: ["fr", "de"]`

## Alternatives Considered

1. **Google Translate API directly** -- Rejected: word-by-word translation loses game context (e.g., "Fire" as attack vs. element). LLM translation with context metadata produces significantly better results for game text.
2. **Engine-side string tables** -- Rejected for Phase 1: adds WASM complexity for a feature that works entirely in JS. Can be added later if runtime performance requires it.
3. **Per-entity locale components** -- Rejected: over-engineers the ECS for what is fundamentally a lookup table problem. A flat `Record<stringId, string>` per locale is simpler and sufficient.
