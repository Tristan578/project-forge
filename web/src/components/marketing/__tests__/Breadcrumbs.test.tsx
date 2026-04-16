/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Breadcrumbs } from '../Breadcrumbs';

// Stub next/link to plain <a> for test rendering
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('Breadcrumbs', () => {
  it('renders Home plus provided items', () => {
    const { getByText } = render(
      <Breadcrumbs items={[{ label: 'Pricing', href: '/pricing' }]} />
    );

    expect(getByText('Home')).toBeDefined();
    expect(getByText('Pricing')).toBeDefined();
  });

  it('marks the last item as current page', () => {
    const { getByText } = render(
      <Breadcrumbs items={[{ label: 'Blog', href: '/blog' }]} />
    );

    const lastItem = getByText('Blog');
    expect(lastItem.getAttribute('aria-current')).toBe('page');
  });

  it('escapes < in JSON-LD to prevent script injection', () => {
    const { container } = render(
      <Breadcrumbs items={[{ label: '<script>alert(1)</script>', href: '/xss' }]} />
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeDefined();
    const content = script!.innerHTML;

    // Raw '<' must not appear — replaced with \u003c
    expect(content).not.toContain('<script>');
    expect(content).toContain('\\u003c');
  });

  it('generates valid BreadcrumbList JSON-LD', () => {
    const { container } = render(
      <Breadcrumbs items={[{ label: 'Docs', href: '/docs' }]} />
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    // The content has \u003c escaping which is valid JSON
    const raw = script!.innerHTML.replace(/\\u003c/g, '<');
    const jsonLd = JSON.parse(raw);

    expect(jsonLd['@type']).toBe('BreadcrumbList');
    expect(jsonLd.itemListElement).toHaveLength(2); // Home + Docs
    expect(jsonLd.itemListElement[0].name).toBe('Home');
    expect(jsonLd.itemListElement[1].name).toBe('Docs');
  });
});
