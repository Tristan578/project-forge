/**
 * Render tests for LegalLayout component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';

vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import { LegalLayout } from '../LegalLayout';

const tableOfContents = [
  { id: 'section-1', label: 'Introduction' },
  { id: 'section-2', label: 'Terms of Use' },
  { id: 'section-3', label: 'Privacy Policy' },
];

describe('LegalLayout', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the page title', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={tableOfContents}>
        <p>Content</p>
      </LegalLayout>
    );
    // Title appears multiple times (h1 + nav link); use heading role to find the h1
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).not.toBeNull();
  });

  it('renders last updated date', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={tableOfContents}>
        <p>Content</p>
      </LegalLayout>
    );
    expect(screen.getByText(/Last updated: January 1, 2024/)).not.toBeNull();
  });

  it('renders table of contents items', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={tableOfContents}>
        <p>Content</p>
      </LegalLayout>
    );
    expect(screen.getByText('Introduction')).not.toBeNull();
    expect(screen.getByText('Terms of Use')).not.toBeNull();
    expect(screen.getAllByText('Privacy Policy').length).toBeGreaterThanOrEqual(1);
  });

  it('renders children content', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={tableOfContents}>
        <p>This is the legal content.</p>
      </LegalLayout>
    );
    expect(screen.getByText('This is the legal content.')).not.toBeNull();
  });

  it('renders SpawnForge brand link', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={[]}>
        <p>Content</p>
      </LegalLayout>
    );
    expect(screen.getAllByText('SpawnForge').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Back to home link', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={[]}>
        <p>Content</p>
      </LegalLayout>
    );
    expect(screen.getByText(/Back to home/)).not.toBeNull();
  });

  it('renders footer with copyright notice', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={[]}>
        <p>Content</p>
      </LegalLayout>
    );
    expect(screen.getByText(/SpawnForge\. All rights reserved\./)).not.toBeNull();
  });

  it('renders TOC anchor hrefs with correct ids', () => {
    render(
      <LegalLayout title="Terms of Service" lastUpdated="January 1, 2024" tableOfContents={tableOfContents}>
        <p>Content</p>
      </LegalLayout>
    );
    const introLink = screen.getByText('Introduction').closest('a');
    expect(introLink?.getAttribute('href')).toBe('#section-1');
  });
});
