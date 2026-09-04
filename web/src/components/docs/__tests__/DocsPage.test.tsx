/**
 * Tests for DocsPage.
 *
 * Uses the real docsIndex/docsSearch implementations (only `fetch` and
 * `next/navigation` are mocked) so search relevance, category grouping, and
 * markdown rendering are all exercised for real rather than through mocks
 * that could pin a wrong contract.
 *
 * Both the desktop (`.min-w-0.flex-1`) and mobile (`md:hidden`) layouts are
 * always present in jsdom regardless of Tailwind's responsive classes (jsdom
 * does not evaluate media queries), so every assertion below is scoped to
 * one copy via the `nav` (desktop sidebar, uniquely identified by its
 * aria-label) or the desktop content wrapper.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@/test/utils/componentTestUtils';
import { DocsPage } from '../DocsPage';
import { clearDocsCache, type DocEntry } from '@/lib/docs/docsIndex';

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();
let currentPathParam: string | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'path' ? currentPathParam : null),
    toString: () => '',
  }),
}));

const mockFetch = vi.fn();

const setupContent = [
  '# Setup Guide',
  '',
  '## Installation',
  '',
  'Some **bold** text here.',
  'Some `inline code` snippet.',
  'An external [link](https://example.com) reference.',
  'A local [link](/docs/other) reference.',
  '',
  '- bullet one',
  '- bullet two',
  '* star bullet',
  '',
  '1. First step',
  '2. Second step',
  '',
  '### Details',
  '',
  '```',
  'fenced code line 1',
  'fenced code line 2',
  '```',
  '',
  'Final paragraph.',
].join('\n');

const docs: DocEntry[] = [
  {
    path: 'index',
    title: 'Welcome to SpawnForge',
    content: '# Welcome\n\nStart here.',
    category: 'root',
    sections: [{ heading: 'Welcome', content: 'Start here.' }],
  },
  {
    path: 'getting-started/setup',
    title: 'Setup Guide',
    content: setupContent,
    category: 'getting-started',
    sections: [
      { heading: 'Setup Guide', content: 'Installation steps.' },
      { heading: 'Installation', content: 'Installation steps for setup.' },
    ],
  },
  {
    path: 'features/a',
    title: 'Feature Alpha',
    content: 'Feature Alpha body mentions uniqueterm somewhere in the text.',
    category: 'features',
    sections: [{ heading: 'Feature Alpha', content: 'uniqueterm body' }],
  },
  {
    path: 'features/b',
    title: 'Feature Beta',
    content: 'Feature Beta body.',
    category: 'features',
    sections: [{ heading: 'Feature Beta', content: 'body' }],
  },
  {
    path: 'features/c',
    title: 'Feature Gamma',
    content: 'Feature Gamma body.',
    category: 'features',
    sections: [{ heading: 'Feature Gamma', content: 'body' }],
  },
  {
    path: 'features/d',
    title: 'Feature Delta',
    content: 'Feature Delta body.',
    category: 'features',
    sections: [{ heading: 'Feature Delta', content: 'body' }],
  },
  {
    path: 'features/e',
    title: 'Feature Epsilon',
    content: 'Feature Epsilon body.',
    category: 'features',
    sections: [{ heading: 'Feature Epsilon', content: 'body' }],
  },
  {
    path: 'features/f',
    title: 'Feature Zeta',
    content: 'Feature Zeta body.',
    category: 'features',
    sections: [{ heading: 'Feature Zeta', content: 'body' }],
  },
];

function mockLoadSuccess() {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ docs, meta: {} }),
  });
}

async function renderLoaded() {
  mockLoadSuccess();
  const utils = render(<DocsPage />);
  await waitFor(() =>
    expect(screen.queryByText('Loading documentation...')).not.toBeInTheDocument()
  );
  return utils;
}

function getNav() {
  return screen.getByRole('navigation', { name: 'Documentation navigation' });
}

describe('DocsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    clearDocsCache();
    currentPathParam = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a loading state before the docs index resolves', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<DocsPage />);

    expect(screen.getByText('Loading documentation...')).toBeInTheDocument();
  });

  it('shows an error state when the API responds with a non-OK status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<DocsPage />);

    await waitFor(() => expect(screen.getByText(/Failed to load docs: 500/)).toBeInTheDocument());
  });

  it('shows an error state when the fetch itself rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    render(<DocsPage />);

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  it('renders the docs home with a quick-start link and category grid', async () => {
    const { container } = await renderLoaded();
    const pane = within(container.querySelector('.min-w-0.flex-1') as HTMLElement);

    // Quick-start button, from the "index" doc.
    expect(pane.getByText('Welcome to SpawnForge')).toBeInTheDocument();

    // Category grid excludes "root" and truncates each category to 5 with a
    // "+N more" indicator — the features category here has 6 docs.
    expect(pane.getByText('Getting Started')).toBeInTheDocument();
    expect(pane.getByText('Features')).toBeInTheDocument();
    expect(pane.getByText('Feature Alpha')).toBeInTheDocument();
    expect(pane.getByText('+ 1 more')).toBeInTheDocument();
  });

  it('filters the sidebar via search and navigates to the matching doc on click', async () => {
    await renderLoaded();
    const nav = getNav();

    fireEvent.change(within(nav).getByPlaceholderText('Search docs...'), {
      target: { value: 'uniqueterm' },
    });

    const result = await within(nav).findByText('Feature Alpha', {}, { timeout: 1000 });
    fireEvent.click(result);

    expect(mockRouterReplace).toHaveBeenCalledWith('/docs?path=features%2Fa', { scroll: false });
  });

  it('shows "No results" for a search query that matches nothing', async () => {
    await renderLoaded();
    const nav = getNav();

    fireEvent.change(within(nav).getByPlaceholderText('Search docs...'), {
      target: { value: 'zzzznomatch' },
    });

    const empty = await within(nav).findByText('No results', {}, { timeout: 1000 });
    expect(empty).toBeInTheDocument();
    expect(within(nav).queryByText('Feature Alpha')).not.toBeInTheDocument();
  });

  it('collapses and re-expands a category on toggle', async () => {
    await renderLoaded();
    const nav = getNav();

    // "features" starts expanded by default.
    expect(within(nav).getByText('Feature Beta')).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: /Features/ }));
    expect(within(nav).queryByText('Feature Beta')).not.toBeInTheDocument();

    fireEvent.click(within(nav).getByRole('button', { name: /Features/ }));
    expect(within(nav).getByText('Feature Beta')).toBeInTheDocument();
  });

  it('renders a doc with breadcrumb, TOC, and every markdown construct on nav click', async () => {
    const { container } = await renderLoaded();
    const nav = getNav();

    fireEvent.click(within(nav).getByText('Setup Guide'));

    const pane = container.querySelector('.min-w-0.flex-1') as HTMLElement;
    const content = within(pane);

    // Breadcrumb: category label + doc title.
    expect(content.getByText('Getting Started')).toBeInTheDocument();

    // Table of contents, built from doc.sections via slugify().
    const toc = pane.querySelectorAll('a[href^="#"]');
    const hrefs = Array.from(toc).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#setup-guide');
    expect(hrefs).toContain('#installation');

    // Headers get slugified ids.
    expect(pane.querySelector('h1#setup-guide')?.textContent).toBe('Setup Guide');
    expect(pane.querySelector('h2#installation')?.textContent).toBe('Installation');
    expect(pane.querySelector('h3#details')?.textContent).toBe('Details');

    // Bold / inline code / links.
    expect(pane.querySelector('strong')?.textContent).toBe('bold');
    expect(pane.querySelector('p code')?.textContent).toBe('inline code');

    const externalLink = pane.querySelector('a[href="https://example.com"]') as HTMLAnchorElement;
    expect(externalLink.textContent).toBe('link');
    expect(externalLink.target).toBe('_blank');
    expect(externalLink.rel).toBe('noopener noreferrer');

    const localLink = pane.querySelector('a[href="/docs/other"]') as HTMLAnchorElement;
    expect(localLink.textContent).toBe('link');
    expect(localLink.target).toBe('');

    // Bullets ("-" and "*") and a numbered list.
    expect(content.getByText('bullet one')).toBeInTheDocument();
    expect(content.getByText('bullet two')).toBeInTheDocument();
    expect(content.getByText('star bullet')).toBeInTheDocument();
    expect(content.getByText('1.')).toBeInTheDocument();
    expect(content.getByText('First step')).toBeInTheDocument();
    expect(content.getByText('2.')).toBeInTheDocument();
    expect(content.getByText('Second step')).toBeInTheDocument();

    // Blank lines render spacer divs.
    expect(pane.querySelectorAll('.h-3').length).toBeGreaterThan(0);

    // Fenced code block.
    expect(pane.querySelector('pre code')?.textContent).toBe(
      'fenced code line 1\nfenced code line 2'
    );

    expect(content.getByText('Final paragraph.')).toBeInTheDocument();
  });

  it('returns to docs home via the breadcrumb back button', async () => {
    const { container } = await renderLoaded();
    const nav = getNav();

    fireEvent.click(within(nav).getByText('Setup Guide'));
    const pane = container.querySelector('.min-w-0.flex-1') as HTMLElement;
    expect(within(pane).getByText('Getting Started')).toBeInTheDocument();

    fireEvent.click(within(pane).getByTitle('Back to docs home'));

    expect(mockRouterReplace).toHaveBeenCalledWith('/docs', { scroll: false });
    expect(within(pane).getByText('Welcome to SpawnForge')).toBeInTheDocument();
  });

  it('syncs activePath when the "path" search param changes after mount', async () => {
    const { container, rerender } = await renderLoaded();
    const pane = container.querySelector('.min-w-0.flex-1') as HTMLElement;

    // No doc active yet — docs home is showing.
    expect(within(pane).getByText('Welcome to SpawnForge')).toBeInTheDocument();

    currentPathParam = 'features/a';
    rerender(<DocsPage />);

    expect(within(pane).getByText('Feature Alpha')).toBeInTheDocument();
  });
});
