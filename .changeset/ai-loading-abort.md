---
'web': minor
---

Add `useAIGeneration` hook for abort/cancel support in AI generation dialogs. All 7 Generate dialogs (Texture, Sprite, Sound, Music, Skybox, Model, PixelArt) now cancel in-flight requests when closed or unmounted, preventing leaked network requests and double-submission. Includes 11 unit tests for the hook.
