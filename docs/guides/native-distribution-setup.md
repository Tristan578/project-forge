# Native Distribution Setup Checklist

> **Ticket:** PF-643
> **Last updated:** 2026-03-24
> **Type:** Manual task -- requires human action with real identity documents and payment methods

This document provides step-by-step instructions for setting up Apple Developer and Google Play accounts for native app distribution of SpawnForge games.

---

## Prerequisites

Before starting, gather:

- [ ] Legal entity name (business or individual)
- [ ] D-U-N-S Number (required for Apple as organization -- free from Dun & Bradstreet, takes 5-14 business days)
- [ ] Credit card for annual fees
- [ ] Government-issued ID (for identity verification)
- [ ] Website URL with privacy policy and terms of service
- [ ] App icons: 1024x1024 PNG (Apple) and 512x512 PNG (Google)
- [ ] Screenshots for store listings (device-specific dimensions)

---

## Part 1: Apple Developer Account

**Cost:** $99/year (individual) or $299/year (enterprise)
**Timeline:** 1-3 business days after submission

### Steps

1. [ ] Go to https://developer.apple.com/programs/enroll/
2. [ ] Sign in with your Apple ID (create one at https://appleid.apple.com if needed)
3. [ ] Enable two-factor authentication on the Apple ID
4. [ ] Choose enrollment type:
   - **Individual** -- simpler, your personal name appears as seller
   - **Organization** -- requires D-U-N-S Number, business name appears as seller
5. [ ] Complete identity verification (automatic for individuals, may require a phone call for organizations)
6. [ ] Pay the $99/year fee
7. [ ] Wait for approval email (1-3 business days)

### Post-Approval Setup

8. [ ] Log in to App Store Connect at https://appstoreconnect.apple.com
9. [ ] Create the app listing:
   - Bundle ID: `com.spawnforge.player` (or your domain)
   - App name: "SpawnForge Player"
   - Primary language, category (Games > Simulation)
10. [ ] Set up certificates and provisioning profiles:
    - In Xcode: Preferences > Accounts > Manage Certificates
    - Create a Distribution certificate
    - Create an App Store provisioning profile
11. [ ] Configure App Store listing metadata:
    - Description, keywords, screenshots, privacy policy URL
    - Age rating questionnaire
    - Pricing (Free with IAP, or as appropriate)
12. [ ] Set up In-App Purchases if needed (for token packs)
13. [ ] Register test devices for TestFlight beta testing

### Apple-Specific Notes

- Review guidelines: https://developer.apple.com/app-store/review/guidelines/
- SpawnForge games run in WKWebView -- Apple allows this for "app-like" experiences but may reject if it feels like a thin web wrapper. Include native navigation chrome.
- WebGPU is supported in Safari 17.4+ on iOS/macOS.
- TestFlight allows up to 10,000 external testers.

---

## Part 2: Google Play Developer Account

**Cost:** $25 one-time fee
**Timeline:** Account available immediately; first app review takes 3-7 days

### Steps

1. [ ] Go to https://play.google.com/console/signup
2. [ ] Sign in with a Google account
3. [ ] Choose account type:
   - **Personal** -- your name appears as developer
   - **Organization** -- requires D-U-N-S Number, business name appears
4. [ ] Pay the $25 one-time registration fee
5. [ ] Complete identity verification:
   - Upload government-issued ID
   - Provide contact address and phone number
   - For organizations: provide official documents
6. [ ] Wait for verification (up to 48 hours, often faster)

### Post-Verification Setup

7. [ ] Create the app in Google Play Console:
   - App name: "SpawnForge Player"
   - Default language, app type (Game), category (Simulation)
   - Free or paid
8. [ ] Complete the app content section:
   - Privacy policy URL
   - Ads declaration
   - Content rating questionnaire (IARC)
   - Target audience and content
   - Data safety section (declare data collection practices)
9. [ ] Set up store listing:
   - Short and full description
   - Screenshots (phone, 7" tablet, 10" tablet)
   - Feature graphic (1024x500)
   - App icon (512x512)
10. [ ] Set up signing:
    - Let Google manage your app signing key (recommended)
    - Upload your upload key
11. [ ] Create a closed testing track first (recommended before production)
12. [ ] Set up Google Play Billing if needed (for token packs)

### Google-Specific Notes

- Policy center: https://play.google.com/console/about/policy-center/
- TWA (Trusted Web Activity) is the recommended approach for wrapping SpawnForge as an Android app. See: https://developer.chrome.com/docs/android/trusted-web-activity/
- WebGPU is supported in Chrome 113+ on Android.
- The 20-device closed testing requirement must be met before production release.

---

## Part 3: Build Pipeline Integration (Future Tickets)

Once accounts are active, create separate engineering tickets for:

### iOS Wrapper
- [ ] Create Xcode project with WKWebView pointing to published game URL
- [ ] Handle status bar, safe areas, orientation lock
- [ ] Implement Universal Links for portal system deep linking
- [ ] Set up Fastlane for CI/CD to TestFlight and App Store
- [ ] Test WebGPU rendering in WKWebView on iOS 17.4+

### Android Wrapper (Trusted Web Activity)
- [ ] Use Google's Bubblewrap CLI to generate a TWA project from the web manifest
- [ ] Configure `assetlinks.json` on the SpawnForge domain for Digital Asset Links verification
- [ ] Add custom splash screen and navigation chrome
- [ ] Set up Gradle + GitHub Actions for automated APK/AAB builds
- [ ] Test WebGPU rendering in Chrome WebView on Android 13+

### Shared
- [ ] Add a PWA web manifest (`manifest.json`) to `/play/[slug]` pages with proper icons, theme color, and display mode
- [ ] Implement offline caching via service worker for WASM binaries and game assets
- [ ] Add deep link URL scheme for portal navigation between native-wrapped games

---

## Cost Summary

| Item | Cost | Frequency |
|------|------|-----------|
| Apple Developer Program | $99 | Annual |
| Google Play Developer | $25 | One-time |
| **Total first year** | **$124** | |
| **Total subsequent years** | **$99** | |

---

## Timeline Estimate

| Task | Duration | Blocker |
|------|----------|---------|
| D-U-N-S Number (if organization) | 5-14 business days | Must complete before Apple enrollment |
| Apple enrollment | 1-3 business days | D-U-N-S |
| Google enrollment | 0-2 business days | None |
| Store listings + metadata | 1-2 days of work | Account approval |
| iOS wrapper build | 3-5 days engineering | Account + Xcode |
| Android TWA build | 2-3 days engineering | Account + domain verification |

**Recommended order:** Start D-U-N-S and Google enrollment simultaneously. Apple enrollment after D-U-N-S arrives. Build pipeline after both accounts are active.
