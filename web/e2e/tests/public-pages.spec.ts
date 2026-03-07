import { test, expect } from '@playwright/test';

/**
 * Public pages E2E tests — verifies all unauthenticated routes render correctly
 * with proper content, structure, navigation, and cross-links.
 *
 * These pages are critical for customer acquisition and legal compliance.
 */
test.describe('Public Pages @ui', () => {
  test.describe('Pricing Page', () => {
    // PricingPage uses useAuth() from Clerk — skip if Clerk is not configured
    const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

    test('renders with all four pricing tiers', async ({ page }) => {
      test.skip(!hasClerk, 'Pricing page requires Clerk (useAuth hook)');
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('SpawnForge').first()).toBeVisible();
      await expect(page.getByText('Build Games with AI')).toBeVisible();

      const plans = ['Free', 'Starter', 'Creator', 'Studio'];
      for (const plan of plans) {
        await expect(page.getByRole('heading', { name: plan }).first()).toBeVisible();
      }
    });

    test('displays correct pricing for each tier', async ({ page }) => {
      test.skip(!hasClerk, 'Pricing page requires Clerk (useAuth hook)');
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('$0')).toBeVisible();
      await expect(page.getByText('$9')).toBeVisible();
      await expect(page.getByText('$29')).toBeVisible();
      await expect(page.getByText('$79')).toBeVisible();
    });

    test('Creator tier is marked as recommended', async ({ page }) => {
      test.skip(!hasClerk, 'Pricing page requires Clerk (useAuth hook)');
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Recommended')).toBeVisible();
    });

    test('each tier has a CTA button', async ({ page }) => {
      test.skip(!hasClerk, 'Pricing page requires Clerk (useAuth hook)');
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByRole('button', { name: 'Get Started' })).toBeVisible();
      const subscribeButtons = page.getByRole('button', { name: 'Subscribe' });
      expect(await subscribeButtons.count()).toBe(3);
    });

    test('feature lists contain real content per tier', async ({ page }) => {
      test.skip(!hasClerk, 'Pricing page requires Clerk (useAuth hook)');
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('1 project')).toBeVisible();
      await expect(page.getByText('No AI features')).toBeVisible();
      await expect(page.getByText('Unlimited projects')).toBeVisible();
      await expect(page.getByText(/5,000 tokens/)).toBeVisible();
    });

    test('has sign-in navigation link', async ({ page }) => {
      test.skip(!hasClerk, 'Pricing page requires Clerk (useAuth hook)');
      await page.goto('/pricing');
      await page.waitForLoadState('domcontentloaded');

      const signInBtn = page.getByRole('button', { name: /sign in/i });
      await expect(signInBtn).toBeVisible();
    });
  });

  test.describe('Terms of Service', () => {
    test('renders with title and last updated date', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Terms of Service').first()).toBeVisible();
      await expect(page.getByText(/February 27, 2026/)).toBeVisible();
    });

    test('has all 16 sections with correct headings', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      const sectionHeadings = [
        'Acceptance of Terms',
        'Description of Service',
        'Account Registration',
        'Subscriptions and Billing',
        'User Content',
        'AI-Generated Content',
        'Acceptable Use',
        'Intellectual Property',
        'Third-Party Services',
        'Disclaimers',
        'Limitation of Liability',
        'Indemnification',
        'Termination',
        'Governing Law',
        'Changes to Terms',
        'Contact Information',
      ];

      for (const heading of sectionHeadings) {
        const h2 = page.locator('h2').filter({ hasText: heading });
        await expect(h2.first()).toBeVisible();
      }
    });

    test('table of contents has navigation links', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      // ToC links should be present
      const tocLinks = page.locator('a[href^="#"]');
      expect(await tocLinks.count()).toBeGreaterThanOrEqual(10);
    });

    test('cross-links to privacy policy exist', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      const privacyLink = page.locator('a[href="/privacy"]');
      expect(await privacyLink.count()).toBeGreaterThan(0);
    });

    test('contact information section has email', async ({ page }) => {
      await page.goto('/terms');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('legal@spawnforge.ai')).toBeVisible();
    });
  });

  test.describe('Privacy Policy', () => {
    test('renders with title and last updated date', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Privacy Policy').first()).toBeVisible();
      await expect(page.getByText(/February 27, 2026/)).toBeVisible();
    });

    test('has all 12 sections with correct headings', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      const sectionHeadings = [
        'Introduction',
        'Information We Collect',
        'How We Use Your Information',
        'Third-Party Services',
        'Cookies and Tracking',
        'Data Retention',
        'Your Rights',
        'Data Security',
        "Children's Privacy",
        'International Data Transfers',
        'Changes to This Policy',
        'Contact Information',
      ];

      for (const heading of sectionHeadings) {
        const h2 = page.locator('h2').filter({ hasText: heading });
        await expect(h2.first()).toBeVisible();
      }
    });

    test('mentions key third-party services (Clerk, Stripe)', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Clerk').first()).toBeVisible();
      await expect(page.getByText('Stripe').first()).toBeVisible();
    });

    test('has data security measures listed', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText(/AES-256-GCM/).first()).toBeVisible();
      await expect(page.getByText(/TLS\/HTTPS/).first()).toBeVisible();
    });

    test('cross-links to terms of service', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      const termsLink = page.locator('a[href="/terms"]');
      expect(await termsLink.count()).toBeGreaterThan(0);
    });

    test('contact section has privacy email', async ({ page }) => {
      await page.goto('/privacy');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('privacy@spawnforge.ai').first()).toBeVisible();
    });
  });

  test.describe('API Docs Page', () => {
    test('renders with header and branding', async ({ page }) => {
      await page.goto('/api-docs');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('SpawnForge').first()).toBeVisible();
      await expect(page.getByText('REST API Reference')).toBeVisible();
    });

    test('has OpenAPI JSON download link', async ({ page }) => {
      await page.goto('/api-docs');
      await page.waitForLoadState('domcontentloaded');

      const downloadLink = page.locator('a[href="/api/openapi"]');
      await expect(downloadLink).toBeVisible();
      await expect(downloadLink).toHaveText(/Download OpenAPI JSON/);
    });

    test('swagger-ui container is present in DOM', async ({ page }) => {
      await page.goto('/api-docs');
      await page.waitForLoadState('domcontentloaded');

      // Container exists in the DOM (may be empty until CDN loads)
      const swaggerContainer = page.locator('#swagger-ui');
      await expect(swaggerContainer).toBeAttached();
    });
  });
});
