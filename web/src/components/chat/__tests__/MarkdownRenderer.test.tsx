import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { MarkdownRenderer } from '../MarkdownRenderer';

const mockSelectEntity = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sceneGraph: {
        nodes: {
          'entity-1': { entityId: 'entity-1', name: 'Player', parentId: null, children: [], components: [], visible: true },
          'entity-2': { entityId: 'entity-2', name: 'Enemy', parentId: null, children: [], components: [], visible: true },
        },
      },
      selectEntity: mockSelectEntity,
    })
  ),
}));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeTruthy();
  });

  it('renders bold and italic text', () => {
    render(<MarkdownRenderer content="This is **bold** and *italic*" />);
    expect(screen.getByText('bold')).toBeTruthy();
    expect(screen.getByText('italic')).toBeTruthy();
  });

  it('renders inline code', () => {
    render(<MarkdownRenderer content="Use `spawn_entity` command" />);
    const code = screen.getByText('spawn_entity');
    expect(code.tagName).toBe('CODE');
  });

  it('renders code blocks with language label', () => {
    const content = '```typescript\nconst x = 1;\n```';
    render(<MarkdownRenderer content={content} />);
    expect(screen.getByText('typescript')).toBeTruthy();
    expect(screen.getByText('const x = 1;')).toBeTruthy();
  });

  it('renders unordered lists', () => {
    const content = '- Item 1\n- Item 2\n- Item 3';
    render(<MarkdownRenderer content={content} />);
    expect(screen.getByText('Item 1')).toBeTruthy();
    expect(screen.getByText('Item 2')).toBeTruthy();
    expect(screen.getByText('Item 3')).toBeTruthy();
  });

  it('renders ordered lists', () => {
    const content = '1. First\n2. Second';
    render(<MarkdownRenderer content={content} />);
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('renders headings', () => {
    const content = '# Title\n## Subtitle\n### Section';
    render(<MarkdownRenderer content={content} />);
    expect(screen.getByText('Title').tagName).toBe('H1');
    expect(screen.getByText('Subtitle').tagName).toBe('H2');
    expect(screen.getByText('Section').tagName).toBe('H3');
  });

  it('renders links with target=_blank', () => {
    render(<MarkdownRenderer content="Click [here](https://example.com)" />);
    const link = screen.getByText('here');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('renders blockquotes', () => {
    render(<MarkdownRenderer content="> This is a quote" />);
    const quote = screen.getByText('This is a quote');
    // blockquote wraps a p which contains text
    expect(quote.closest('blockquote')).toBeTruthy();
  });

  it('renders tables with GFM', () => {
    const content = '| Col A | Col B |\n|-------|-------|\n| 1 | 2 |';
    render(<MarkdownRenderer content={content} />);
    expect(screen.getByText('Col A').tagName).toBe('TH');
    expect(screen.getByText('1').tagName).toBe('TD');
  });

  it('renders entity names as clickable chips', () => {
    render(<MarkdownRenderer content="The Player entity is ready" />);
    const chip = screen.getByText('Player');
    expect(chip.tagName).toBe('BUTTON');
    fireEvent.click(chip);
    expect(mockSelectEntity).toHaveBeenCalledWith('entity-1', 'replace');
  });

  it('renders multiple entity chips in text', () => {
    render(<MarkdownRenderer content="The Player fights the Enemy" />);
    const playerChip = screen.getByText('Player');
    const enemyChip = screen.getByText('Enemy');
    expect(playerChip.tagName).toBe('BUTTON');
    expect(enemyChip.tagName).toBe('BUTTON');
  });

  it('handles entity names case-insensitively', () => {
    render(<MarkdownRenderer content="The player is ready" />);
    const chip = screen.getByText('player');
    expect(chip.tagName).toBe('BUTTON');
    fireEvent.click(chip);
    expect(mockSelectEntity).toHaveBeenCalledWith('entity-1', 'replace');
  });

  it('does not render raw HTML', () => {
    render(<MarkdownRenderer content='<script>alert("xss")</script>' />);
    // react-markdown strips raw HTML by default
    const container = document.body;
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders horizontal rules', () => {
    const content = ['Above', '', '---', '', 'Below'].join('\n');
    render(<MarkdownRenderer content={content} />);
    expect(screen.getByText('Above')).toBeTruthy();
    expect(screen.getByText('Below')).toBeTruthy();
    expect(document.querySelector('hr')).toBeTruthy();
  });

  it('renders strikethrough (GFM)', () => {
    render(<MarkdownRenderer content="This is ~~deleted~~ text" />);
    const del = document.querySelector('del');
    expect(del).toBeTruthy();
    expect(del?.textContent).toBe('deleted');
  });
});
