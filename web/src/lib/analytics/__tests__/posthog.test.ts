import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock posthog-js before importing the module under test
const mockCapture = vi.fn();
const mockIdentify = vi.fn();
const mockInit = vi.fn();
const mockReset = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: mockInit,
    capture: mockCapture,
    identify: mockIdentify,
    reset: mockReset,
  },
}));

const CONSENT_KEY = 'forge-cookie-consent';

describe('posthog analytics wrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset env vars
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.stubEnv('NODE_ENV', 'test');
    // Clear consent state between tests
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CONSENT_KEY);
    }
  });

  // ── Consent guard ──────────────────────────────────────────────────────────

  it('does not initialize when consent has not been granted', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    // No localStorage entry = no consent
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('does not initialize when consent was declined', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'false');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('initializes when consent was accepted', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    expect(mockInit).toHaveBeenCalledWith('phc_test123', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
    }));
  });

  // ── hasConsented ───────────────────────────────────────────────────────────

  it('hasConsented returns false when nothing is stored', async () => {
    const mod = await import('@/lib/analytics/posthog');
    expect(mod.hasConsented()).toBe(false);
  });

  it('hasConsented returns false when consent is declined', async () => {
    localStorage.setItem(CONSENT_KEY, 'false');
    const mod = await import('@/lib/analytics/posthog');
    expect(mod.hasConsented()).toBe(false);
  });

  it('hasConsented returns true when consent is accepted', async () => {
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    expect(mod.hasConsented()).toBe(true);
  });

  // ── Existing guards (key + env) ────────────────────────────────────────────

  it('does not initialize when key is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('does not initialize in non-production environment', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'development');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('initializes in production with a valid key and consent', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    expect(mockInit).toHaveBeenCalledWith('phc_test123', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
    }));
  });

  // ── Event tracking ─────────────────────────────────────────────────────────

  it('trackEvent is a no-op when not initialized', async () => {
    const mod = await import('@/lib/analytics/posthog');
    mod.trackEvent('test_event', { key: 'value' });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('trackEvent calls posthog.capture when initialized', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    mod.trackEvent('test_event', { key: 'value' });
    expect(mockCapture).toHaveBeenCalledWith('test_event', { key: 'value' });
  });

  it('identifyUser is a no-op when not initialized', async () => {
    const mod = await import('@/lib/analytics/posthog');
    mod.identifyUser('user123', { tier: 'pro' });
    expect(mockIdentify).not.toHaveBeenCalled();
  });

  it('identifyUser calls posthog.identify when initialized', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    mod.identifyUser('user123', { tier: 'pro' });
    expect(mockIdentify).toHaveBeenCalledWith('user123', { tier: 'pro' });
  });

  it('trackPageView calls posthog.capture with $pageview event', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    mod.trackPageView('/editor');
    expect(mockCapture).toHaveBeenCalledWith('$pageview', { $current_url: '/editor' });
  });

  it('resetAnalytics calls posthog.reset when initialized', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test123');
    vi.stubEnv('NODE_ENV', 'production');
    localStorage.setItem(CONSENT_KEY, 'true');
    const mod = await import('@/lib/analytics/posthog');
    mod.initPostHog();
    mod.resetAnalytics();
    expect(mockReset).toHaveBeenCalled();
  });

  it('resetAnalytics is a no-op when not initialized', async () => {
    const mod = await import('@/lib/analytics/posthog');
    mod.resetAnalytics();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('exports AnalyticsEvent enum with expected values', async () => {
    const mod = await import('@/lib/analytics/posthog');
    expect(mod.AnalyticsEvent.GAME_CREATED).toBe('game_created');
    expect(mod.AnalyticsEvent.AI_GENERATION_STARTED).toBe('ai_generation_started');
    expect(mod.AnalyticsEvent.AI_GENERATION_COMPLETED).toBe('ai_generation_completed');
    expect(mod.AnalyticsEvent.GAME_PUBLISHED).toBe('game_published');
    expect(mod.AnalyticsEvent.GAME_EXPORTED).toBe('game_exported');
    expect(mod.AnalyticsEvent.TEMPLATE_USED).toBe('template_used');
    expect(mod.AnalyticsEvent.SUBSCRIPTION_STARTED).toBe('subscription_started');
    expect(mod.AnalyticsEvent.EDITOR_SESSION_STARTED).toBe('editor_session_started');
    expect(mod.AnalyticsEvent.FEATURE_FLAG_EVALUATED).toBe('feature_flag_evaluated');
    expect(mod.AnalyticsEvent.TIER_UPGRADE_PROMPTED).toBe('tier_upgrade_prompted');
    expect(mod.AnalyticsEvent.TEMPLATE_APPLIED).toBe('template_applied');
  });
});
