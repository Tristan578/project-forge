/**
 * Tests for DocsPanel — loading, error, browse, search, category toggle,
 * navigation, back button, markdown rendering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@/test/utils/componentTestUtils';
import { DocsPanel } from '../DocsPanel';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { loadDocsIndex, getCategories, getDocsByCategory, getDocByPath } from '@/lib/docs/docsIndex';
import { searchDocs } from '@/lib/docs/docsSearch';

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('@/lib/docs/docsIndex', () => ({
  loadDocsIndex: vi.fn(),
  getCategories: vi.fn(() => []),
  getDocsByCategory: vi.fn(() => []),
  getDocByPath: vi.fn(() => null),
}));

vi.mock('@/lib/docs/docsSearch', () => ({
  buildClientIndex: vi.fn(() => 'mock-index'),
  searchDocs: vi.fn(() => []),
}));

const mockDocs = [
  { path: 'getting-started/intro', title: 'Introduction', content: '# Introduction\nWelcome to SpawnForge.', category: 'getting-started', sections: [] },
  { path: 'features/physics', title: 'Physics', content: '# Physics\nPhysics engine docs.', category: 'features', sections: [] },
  { path: 'features/materials', title: 'Materials', content: '# Materials\n## Basics\nMaterial **basics** and `code`.', category: 'features', sections: [] },
];

function setupStore(docsPath: string | null = null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useWorkspaceStore).mockImplementation((selector: any) => {
    const state = { docsPath };
    return selector(state);
  });
}

function setupDocsLoaded() {
  vi.mocked(loadDocsIndex).mockResolvedValue({ docs: mockDocs, meta: {} });
  vi.mocked(getCategories).mockReturnValue(['getting-started', 'features']);
  vi.mocked(getDocsByCategory).mockImplementation((_docs, cat) =>
    mockDocs.filter((d) => d.category === cat),
  );
  vi.mocked(getDocByPath).mockImplementation((_docs, path) =>
    mockDocs.find((d) => d.path === path) ?? undefined,
  );
}

describe('DocsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Loading state ─────────────────────────────────────────────────────

  it('shows loading state initially', () => {
    setupStore();
    vi.mocked(loadDocsIndex).mockReturnValue(new Promise(() => {})); // never resolves
    render(<DocsPanel />);
    expect(screen.getByText('Loading documentation...')).toBeDefined();
  });

  // ── Error state ───────────────────────────────────────────────────────

  it('shows error when docs fail to load', async () => {
    setupStore();
    vi.mocked(loadDocsIndex).mockRejectedValue(new Error('Network failure'));
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Network failure')).toBeDefined();
    });
  });

  // ── Browse view ───────────────────────────────────────────────────────

  it('renders Documentation header after loading', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Documentation')).toBeDefined();
    });
  });

  it('renders category headings', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Getting Started')).toBeDefined();
      expect(screen.getByText('Features')).toBeDefined();
    });
  });

  it('shows doc count per category', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('(1)')).toBeDefined(); // getting-started has 1
      expect(screen.getByText('(2)')).toBeDefined(); // features has 2
    });
  });

  it('renders docs under expanded categories', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Introduction')).toBeDefined();
      expect(screen.getByText('Physics')).toBeDefined();
      expect(screen.getByText('Materials')).toBeDefined();
    });
  });

  // ── Category toggle ───────────────────────────────────────────────────

  it('collapses category on click', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Introduction')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Getting Started'));
    expect(screen.queryByText('Introduction')).toBeNull();
  });

  it('re-expands category on second click', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Introduction')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Getting Started'));
    fireEvent.click(screen.getByText('Getting Started'));
    expect(screen.getByText('Introduction')).toBeDefined();
  });

  // ── Navigation ────────────────────────────────────────────────────────

  it('navigates to a doc on click', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Materials')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Materials'));
    // Should show document view with back button
    await waitFor(() => {
      expect(screen.getByTitle('Back')).toBeDefined();
    });
  });

  it('goes back from doc view on back button', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Materials')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Materials'));
    await waitFor(() => {
      expect(screen.getByTitle('Back')).toBeDefined();
    });
    fireEvent.click(screen.getByTitle('Back'));
    await waitFor(() => {
      expect(screen.getByText('Documentation')).toBeDefined();
    });
  });

  // ── Search ────────────────────────────────────────────────────────────

  it('renders search input', async () => {
    setupStore();
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search docs...')).toBeDefined();
    });
  });

  it('shows no results message for unmatched query', async () => {
    setupStore();
    setupDocsLoaded();
    vi.mocked(searchDocs).mockReturnValue([]);
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search docs...')).toBeDefined();
    });
    fireEvent.change(screen.getByPlaceholderText('Search docs...'), {
      target: { value: 'xyznonexistent' },
    });
    await waitFor(() => {
      expect(screen.getByText(/No results for/)).toBeDefined();
    });
  });

  it('shows search results when query matches', async () => {
    setupStore();
    setupDocsLoaded();
    vi.mocked(searchDocs).mockReturnValue([
      { path: 'features/physics', title: 'Physics', score: 5, snippet: 'Physics engine docs.', matchSection: 'Overview' },
    ]);
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search docs...')).toBeDefined();
    });
    fireEvent.change(screen.getByPlaceholderText('Search docs...'), {
      target: { value: 'physics' },
    });
    await waitFor(() => {
      expect(screen.getByText('Physics engine docs.')).toBeDefined();
    });
  });

  // ── External navigation via docsPath ──────────────────────────────────

  it('navigates to doc when docsPath is set externally', async () => {
    setupStore('features/physics');
    setupDocsLoaded();
    render(<DocsPanel />);
    await waitFor(() => {
      expect(screen.getByTitle('Back')).toBeDefined();
    });
  });
});
