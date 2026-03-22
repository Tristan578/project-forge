/**
 * Unit tests for email/templates.ts
 *
 * Verifies HTML template generation, XSS escaping, and structural correctness
 * for all email template functions.
 */
import { describe, it, expect } from 'vitest';
import {
  welcomeEmail,
  subscriptionConfirmation,
  paymentFailed,
  tokenBalanceLow,
} from '@/lib/email/templates';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if the html contains a properly formed DOCTYPE/html skeleton. */
function isValidHtmlDocument(html: string): boolean {
  return (
    html.includes('<!DOCTYPE html>') &&
    html.includes('<html') &&
    html.includes('</html>') &&
    html.includes('<body') &&
    html.includes('</body>')
  );
}

/** Extracts the raw text content between HTML tags (very naive — for assertions only). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// welcomeEmail
// ---------------------------------------------------------------------------

describe('welcomeEmail', () => {
  it('returns subject and html', () => {
    const result = welcomeEmail('Alice');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(typeof result.subject).toBe('string');
    expect(typeof result.html).toBe('string');
  });

  it('subject mentions SpawnForge', () => {
    const { subject } = welcomeEmail('Alice');
    expect(subject).toContain('SpawnForge');
  });

  it('html is a valid document', () => {
    const { html } = welcomeEmail('Alice');
    expect(isValidHtmlDocument(html)).toBe(true);
  });

  it('includes the user name in the html', () => {
    const { html } = welcomeEmail('Alice');
    expect(html).toContain('Alice');
  });

  it('escapes < in user name (XSS prevention)', () => {
    const { html } = welcomeEmail('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes > in user name', () => {
    const { html } = welcomeEmail('name>suffix');
    expect(html).not.toMatch(/>suffix/);
    expect(html).toContain('&gt;suffix');
  });

  it('escapes & in user name', () => {
    const { html } = welcomeEmail('Tom & Jerry');
    expect(html).toContain('Tom &amp; Jerry');
  });

  it('escapes double-quote in user name', () => {
    const { html } = welcomeEmail('"quoted"');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('escapes single-quote in user name', () => {
    const { html } = welcomeEmail("O'Reilly");
    expect(html).toContain('&#39;');
  });

  it('html includes SpawnForge brand header', () => {
    const { html } = welcomeEmail('Alice');
    expect(html).toContain('SpawnForge');
  });

  it('works with empty string user name', () => {
    const { html, subject } = welcomeEmail('');
    expect(isValidHtmlDocument(html)).toBe(true);
    expect(subject.length).toBeGreaterThan(0);
  });

  it('works with very long user name', () => {
    const longName = 'A'.repeat(500);
    const { html } = welcomeEmail(longName);
    expect(html).toContain(longName);
    expect(isValidHtmlDocument(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// subscriptionConfirmation
// ---------------------------------------------------------------------------

describe('subscriptionConfirmation', () => {
  it('returns subject and html', () => {
    const result = subscriptionConfirmation('pro');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
  });

  it('subject includes the tier name', () => {
    const { subject } = subscriptionConfirmation('creator');
    expect(subject).toContain('creator');
  });

  it('html includes the tier name', () => {
    const { html } = subscriptionConfirmation('hobbyist');
    expect(html).toContain('hobbyist');
  });

  it('html is a valid document', () => {
    const { html } = subscriptionConfirmation('starter');
    expect(isValidHtmlDocument(html)).toBe(true);
  });

  it('escapes < in tier name (XSS prevention)', () => {
    const { html } = subscriptionConfirmation('<evil>');
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });

  it('escapes & in tier name', () => {
    const { html } = subscriptionConfirmation('starter & plus');
    expect(html).toContain('starter &amp; plus');
  });

  it('subject mentions SpawnForge', () => {
    const { subject } = subscriptionConfirmation('pro');
    expect(subject).toContain('SpawnForge');
  });

  it('works with all standard tier names', () => {
    const tiers = ['starter', 'hobbyist', 'creator', 'pro'];
    for (const tier of tiers) {
      const { html, subject } = subscriptionConfirmation(tier);
      expect(isValidHtmlDocument(html)).toBe(true);
      expect(subject).toContain(tier);
    }
  });
});

// ---------------------------------------------------------------------------
// paymentFailed
// ---------------------------------------------------------------------------

describe('paymentFailed', () => {
  it('returns subject and html', () => {
    const result = paymentFailed('Bob');
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
  });

  it('subject indicates action required', () => {
    const { subject } = paymentFailed('Bob');
    expect(subject.toLowerCase()).toContain('payment');
  });

  it('html includes the user name', () => {
    const { html } = paymentFailed('Bob');
    expect(html).toContain('Bob');
  });

  it('html is a valid document', () => {
    const { html } = paymentFailed('Bob');
    expect(isValidHtmlDocument(html)).toBe(true);
  });

  it('escapes HTML in user name', () => {
    const { html } = paymentFailed('<b>Bobby</b>');
    expect(html).not.toContain('<b>Bobby</b>');
    expect(html).toContain('&lt;b&gt;Bobby&lt;/b&gt;');
  });

  it('escapes single-quote in user name', () => {
    const { html } = paymentFailed("O'Brien");
    expect(html).toContain('&#39;');
  });

  it('html mentions payment and account settings', () => {
    const text = stripHtml(paymentFailed('User').html);
    expect(text.toLowerCase()).toContain('payment');
  });

  it('works with empty user name', () => {
    const { html } = paymentFailed('');
    expect(isValidHtmlDocument(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tokenBalanceLow
// ---------------------------------------------------------------------------

describe('tokenBalanceLow', () => {
  it('returns subject and html', () => {
    const result = tokenBalanceLow('Carol', 5000);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
  });

  it('subject mentions token balance', () => {
    const { subject } = tokenBalanceLow('Carol', 5000);
    expect(subject.toLowerCase()).toContain('token');
  });

  it('html includes the user name', () => {
    const { html } = tokenBalanceLow('Carol', 5000);
    expect(html).toContain('Carol');
  });

  it('html includes the remaining token count', () => {
    const { html } = tokenBalanceLow('Dave', 1234);
    // toLocaleString may format as "1,234" or "1234" depending on locale
    // Check that the digits are present
    expect(html).toContain('1');
    expect(html).toContain('234');
  });

  it('html is a valid document', () => {
    const { html } = tokenBalanceLow('Eve', 100);
    expect(isValidHtmlDocument(html)).toBe(true);
  });

  it('escapes HTML in user name', () => {
    const { html } = tokenBalanceLow('<script>', 100);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles zero remaining tokens', () => {
    const { html, subject } = tokenBalanceLow('Frank', 0);
    expect(isValidHtmlDocument(html)).toBe(true);
    expect(subject.length).toBeGreaterThan(0);
  });

  it('handles large token counts', () => {
    const { html } = tokenBalanceLow('Grace', 1_000_000);
    expect(isValidHtmlDocument(html)).toBe(true);
  });

  it('subject mentions SpawnForge', () => {
    const { subject } = tokenBalanceLow('Henry', 500);
    expect(subject).toContain('SpawnForge');
  });
});

// ---------------------------------------------------------------------------
// Cross-template structural requirements
// ---------------------------------------------------------------------------

describe('all email templates structural requirements', () => {
  const allTemplates = [
    () => welcomeEmail('TestUser'),
    () => subscriptionConfirmation('pro'),
    () => paymentFailed('TestUser'),
    () => tokenBalanceLow('TestUser', 1000),
  ];

  it('all templates return a non-empty subject', () => {
    for (const fn of allTemplates) {
      expect(fn().subject.length).toBeGreaterThan(0);
    }
  });

  it('all templates return a valid HTML document', () => {
    for (const fn of allTemplates) {
      expect(isValidHtmlDocument(fn().html)).toBe(true);
    }
  });

  it('all templates include viewport meta tag', () => {
    for (const fn of allTemplates) {
      expect(fn().html).toContain('viewport');
    }
  });

  it('all templates include charset declaration', () => {
    for (const fn of allTemplates) {
      expect(fn().html).toContain('UTF-8');
    }
  });

  it('all templates include SpawnForge brand name', () => {
    for (const fn of allTemplates) {
      expect(fn().html).toContain('SpawnForge');
    }
  });
});
