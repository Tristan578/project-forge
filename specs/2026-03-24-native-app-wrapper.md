# Spec: Native App Wrapper

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-579
> **Scope:** One-click export to iOS TestFlight and Google Play via Capacitor

## Problem

SpawnForge games run in the browser, but app store presence is critical for discoverability and monetization. Creators want to publish their games to iOS and Android without learning Xcode, Android Studio, or native development. The existing export pipeline produces a single HTML file -- this spec extends it to produce app store-ready packages.

## Existing Infrastructure

- `web/src/lib/export/gameTemplate.ts` -- `generateGameHTML()` produces self-contained HTML with embedded WASM, scripts, scene data, touch controls.
- `.claude/docs/native-app-evaluation.md` -- Evaluated PWA, Capacitor, Tauri, React Native WebView. **Recommendation: PWA first, then Capacitor.**
- Touch controls already exist: `web/src/lib/export/touchControls.ts` with configurable overlays.
- Mobile quality reduction: auto-detects mobile and applies low quality preset.
- Orientation lock support in exported games.
- WebGL2 fallback (mandatory for iOS -- WKWebView has no WebGPU).

## Solution

### Architecture Overview

Add a **Capacitor build pipeline** that wraps the existing HTML export in a native shell. The pipeline runs server-side (Vercel Function or local CLI) since Capacitor requires Node.js + native SDKs.

```
Exported HTML game
    ↓
CapacitorWrapper (server-side)
    ↓
├── iOS: .ipa (TestFlight upload via Fastlane)
└── Android: .aab (Play Store upload via bundletool)
```

### Phase 1: PWA Completion + Capacitor Scaffold

1. **Complete PWA manifest** for instant mobile install.
   - File: `web/public/manifest.json` -- add all icon sizes (192, 512, maskable).
   - File: `web/public/sw.js` -- minimal service worker for offline shell caching.
   - Verify install-to-home-screen on iOS Safari + Android Chrome.

2. **Capacitor project scaffold** for exported games (not the editor).
   - Directory: `web/src/lib/export/capacitor/`
   - Template `capacitor.config.ts`, `AndroidManifest.xml`, `Info.plist`.
   - Script: `buildNativeApp.ts` -- takes HTML export + config, produces Capacitor project.
   - Forces WebGL2 on iOS (no WebGPU in WKWebView).

3. **NativeExportPanel** UI for configuring native builds.
   - File: `web/src/components/editor/NativeExportPanel.tsx`
   - Fields: app name, bundle ID, icon upload, splash screen, orientation, target platforms.
   - Stores config in `exportSlice` state.

4. **MCP commands**: `export_native_app`, `get_native_export_status`, `set_native_config`.

### Phase 2: Cloud Build Service

5. **Server-side build API** at `/api/export/native`.
   - Accepts: HTML export blob + native config JSON.
   - Runs Capacitor build in a container (Vercel cron or dedicated build server).
   - Returns download link for .ipa/.aab.
   - Requires: Apple Developer cert + Google signing key (stored as env vars).

6. **TestFlight upload** via Fastlane integration.
7. **Play Store upload** via Google Play Developer API.

### Phase 3: Over-the-Air Updates

8. Capacitor Live Update plugin for instant JS/WASM updates without app store review.
9. Version management UI in editor.

### Rust Changes

None. Native wrapping operates on the HTML export output.

### Web Changes (Phase 1)

| File | Change |
|------|--------|
| `web/public/manifest.json` | New/update: Complete PWA manifest |
| `web/public/sw.js` | New: Service worker for offline shell |
| `web/src/lib/export/capacitor/config.template.ts` | New: Capacitor config template |
| `web/src/lib/export/capacitor/buildNativeApp.ts` | New: Build orchestrator |
| `web/src/lib/export/capacitor/androidManifest.template.xml` | New: Android template |
| `web/src/lib/export/capacitor/infoPlist.template.ts` | New: iOS template |
| `web/src/components/editor/NativeExportPanel.tsx` | New: Native export config UI |
| `web/src/stores/slices/exportSlice.ts` | Add native config state |
| `web/src/lib/chat/handlers/exportHandlers.ts` | Add native export MCP handlers |

### MCP Commands (Phase 1)

| Command | Description |
|---------|-------------|
| `set_native_config` | Configure app name, bundle ID, icon, orientation, platforms |
| `export_native_app` | Trigger native build (returns project zip in Phase 1, .ipa/.aab in Phase 2) |
| `get_native_export_status` | Poll build progress |

## Constraints

- **iOS WebGPU**: WKWebView does NOT support WebGPU. All iOS builds force `webgl2` variant.
- **GPU particles**: `bevy_hanabi` unavailable on iOS. Particle data persists but does not render.
- **App store accounts**: Apple Developer ($99/yr) + Google Play ($25 one-time) required for Phase 2.
- **Build time**: Native builds take 3-10 minutes. Async with progress polling.
- **Binary size**: ~25MB (WASM ~15MB + Capacitor shell ~5MB + scene/assets).
- **Phase 1 scope**: Produces a downloadable Capacitor project zip. Actual .ipa/.aab building is Phase 2.

## Acceptance Criteria

- Given a completed game, When "Install to Home Screen" is used on mobile, Then the PWA installs with correct icons and works offline.
- Given native export config (app name, bundle ID, icon), When `export_native_app` is called, Then a valid Capacitor project zip is produced.
- Given the Capacitor project, When built locally with `npx cap build`, Then it produces a working Android APK that loads the game.
- Given an iOS target, When the export runs, Then the WebGL2 variant is used and the config disables WebGPU detection.

## Phase 1 Subtasks

1. Create complete `manifest.json` with all required icon sizes
2. Create minimal service worker (`sw.js`) for offline shell caching
3. Create Capacitor config templates (config, AndroidManifest, Info.plist)
4. Create `buildNativeApp.ts` that assembles HTML export into Capacitor project
5. Create `NativeExportPanel.tsx` with platform config and icon upload
6. Add MCP handlers: `set_native_config`, `export_native_app`, `get_native_export_status`
7. Add unit tests for Capacitor project generation and platform-specific config
