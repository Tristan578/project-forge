# Native App Distribution Evaluation

## Context

SpawnForge runs entirely in the browser via WebGPU/WebGL2 + WASM. Evaluating native
distribution options for app store presence and improved mobile experience.

## Options Evaluated

### 1. PWA (Progressive Web App)

**Status: Partially implemented.** Viewport meta tags and mobile touch overlays exist.

**Pros:**
- Zero additional build tooling
- Works on iOS Safari and Android Chrome today
- Can be installed to home screen without app store
- Shares the exact same codebase — no port required
- Automatic updates (no app store review cycle)

**Cons:**
- No App Store / Play Store listing (discoverability)
- iOS Safari has limited WebGPU support — WebGL2 fallback is required
- Background audio and some device APIs are restricted on iOS PWA

**Effort:** Low — complete the existing PWA manifest and service worker.

---

### 2. Capacitor (Ionic)

**Status: Not started.**

Capacitor wraps a web app in a native WebView shell and provides plugin APIs for
device features (camera, filesystem, haptics, etc.).

**Pros:**
- Ships to App Store and Play Store with full listing
- Retains the full web codebase — no rewrite
- Plugin ecosystem for native device APIs (haptics already used via `forge.input.vibrate()`)
- Android WebView supports WebGPU via Chrome; iOS WKWebView supports WebGL2

**Cons:**
- iOS WKWebView does NOT support WebGPU — only WebGL2 fallback is available
- App store review process (1–7 days per release)
- Adds a build step: `npx cap sync && npx cap build`
- Binary size increase (~10 MB wrapper + WASM assets)

**Effort:** Medium — integrate Capacitor, configure iOS/Android projects, publish.

---

### 3. Tauri

**Status: Not applicable.**

Tauri uses a native OS WebView (WKWebView on macOS, WebView2 on Windows). While
excellent for desktop apps, it does not support mobile distribution to app stores in
its stable release. Tauri mobile is experimental and not production-ready as of 2026.

**Verdict:** Skip for now. Revisit when Tauri mobile reaches stable.

---

### 4. React Native WebView

**Status: Not applicable.**

React Native embeds a WebView component inside a React Native app. This is effectively
a less capable version of Capacitor with more overhead and no benefit for a
full-web product like SpawnForge.

**Verdict:** Not recommended. Capacitor is strictly superior for this use case.

---

## Recommendation

**Phase 1: Complete PWA** (low effort, immediate value)

- Add a full `manifest.json` with all icon sizes (192, 512, maskable)
- Add a minimal service worker for offline shell caching
- Test install-to-home-screen on iOS Safari and Android Chrome
- Verify WebGL2 fallback renders correctly in standalone mode

**Phase 2: Capacitor for App Store presence** (medium effort)

- Wrap the existing Next.js production build in Capacitor
- iOS: WebGL2 fallback is required (WKWebView has no WebGPU)
- Android: WebGPU works via Chrome WebView on Android 12+
- Submit to App Store and Play Store under SpawnForge publisher account
- Requires Apple Developer account ($99/yr) and Google Play account ($25 one-time)

---

## iOS WebGPU Limitation

iOS Safari added partial WebGPU support in Safari 17 (2023), but WKWebView (used by
Capacitor and all third-party iOS browsers) does NOT expose WebGPU as of early 2026.
The WebGL2 fallback path is therefore mandatory for any iOS native distribution.

This means the Bevy `webgl2` feature build must be the default for iOS targets, and
the GPU particle system (`bevy_hanabi`, WebGPU-only) will not be available on iOS.

---

## Ticket References

- PF-579: Native app evaluation (this document)
- PF-643: Apple/Google developer accounts for native distribution
