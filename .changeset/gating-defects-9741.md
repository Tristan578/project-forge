---
"web": patch
---

Fix three defects in the #9117 generation gating that reached `main` (#9741).

The capability cache could strand itself: `isCacheStale()` returned early whenever the cached state was the loading placeholder, so if a consumer unmounted before the first fetch settled and an invalidation then ran with no subscribers, no further fetch was ever issued and `useCapabilities()` stayed `loading` for the rest of the session — during which every capability reported as not blocked, including the permanently unavailable `music`, and the dialogs re-enabled Generate with no notice.

The Audio inspector keyed its "Unavailable" badge on `blocked` while its label and title keyed on `unprovisionable`, so a tier-locked user on an unconfigured capability saw a badge saying the feature is not offered beside a label saying they need a higher tier, with the upgrade affordance gone. Both now key on `unprovisionable`, matching the Asset panel.

The guidance no longer points at Settings for a capability whose providers Settings cannot accept: `useGenerationGate` reports `byokConfigurable`, false for `sprite` (Replicate + OpenAI), `image` and `bg_removal` (OpenAI, remove.bg), so the notice stops offering a link to a page where the named key cannot be added.

Also corrects the single-sprite price. The dialog hard-coded 15 for both the quote and its balance check while the route charges `SPRITE_TOKEN_COST` for the provider the style resolves to — 10 for SDXL, 20 for DALL·E — so a 10–14 balance was refused on a request the server would have charged 10 for, a 15–19 balance submitted one the server then rejected for 20, and the displayed price was wrong for every single-sprite generation. Both now derive from one shared `resolveSpriteProvider` / `spriteTokenCost`. The sprite style select also gained the `htmlFor`/`id` pair it was missing, so it is no longer announced as an unlabelled combobox.
