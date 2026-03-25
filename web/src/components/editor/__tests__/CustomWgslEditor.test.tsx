/**
 * Tests for CustomWgslEditor — compile, template selection, keyboard shortcut,
 * status indicator, dirty-state detection, and sync with store.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { CustomWgslEditor } from '../CustomWgslEditor';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

const mockUpdateCustomWgslSource = vi.fn();

function setupStore(overrides: {
  customWgslSource?: {
    userCode: string;
    name: string;
    compileStatus?: 'ok' | 'error' | 'pending' | null;
    compileError?: string | null;
  } | null;
} = {}) {
  const source =
    'customWgslSource' in overrides
      ? overrides.customWgslSource
      : { userCode: 'return base_color;', name: 'My Shader', compileStatus: null, compileError: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) =>
    selector({
      customWgslSource: source,
      updateCustomWgslSource: mockUpdateCustomWgslSource,
    })
  );
}

describe('CustomWgslEditor', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  // ── Basic rendering ────────────────────────────────────────────────────

  it('renders the WGSL editor heading', () => {
    setupStore();
    render(<CustomWgslEditor />);
    expect(screen.getByText('Custom WGSL Shader')).not.toBeNull();
  });

  it('renders the shader name input with current name', () => {
    setupStore();
    render(<CustomWgslEditor />);
    const nameInput = screen.getByPlaceholderText('Shader name') as HTMLInputElement;
    expect(nameInput.value).toBe('My Shader');
  });

  it('renders the textarea with the current WGSL code', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('return base_color;');
  });

  it('renders the Compile Shader button', () => {
    setupStore();
    render(<CustomWgslEditor />);
    expect(screen.getByText('Compile Shader')).not.toBeNull();
  });

  // ── Compile button ─────────────────────────────────────────────────────

  it('calls updateCustomWgslSource when Compile button is clicked', () => {
    setupStore();
    render(<CustomWgslEditor />);
    fireEvent.click(screen.getByText('Compile Shader'));
    expect(mockUpdateCustomWgslSource).toHaveBeenCalledWith('return base_color;', 'My Shader');
  });

  it('compiles with updated code after textarea change', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'return vec4(1.0);' } });
    fireEvent.click(screen.getByText('Compile Shader'));

    expect(mockUpdateCustomWgslSource).toHaveBeenCalledWith('return vec4(1.0);', 'My Shader');
  });

  it('compiles with updated name after name input change', () => {
    setupStore();
    render(<CustomWgslEditor />);
    const nameInput = screen.getByPlaceholderText('Shader name') as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: 'Glow Shader' } });
    fireEvent.click(screen.getByText('Compile Shader'));

    expect(mockUpdateCustomWgslSource).toHaveBeenCalledWith('return base_color;', 'Glow Shader');
  });

  // ── Ctrl+Enter keyboard shortcut ───────────────────────────────────────

  it('compiles on Ctrl+Enter in the textarea', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(mockUpdateCustomWgslSource).toHaveBeenCalledWith('return base_color;', 'My Shader');
  });

  it('compiles on Meta+Enter (Mac) in the textarea', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(mockUpdateCustomWgslSource).toHaveBeenCalledWith('return base_color;', 'My Shader');
  });

  it('does not compile on plain Enter', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockUpdateCustomWgslSource).not.toHaveBeenCalled();
  });

  // ── Template selector ──────────────────────────────────────────────────

  it('shows template dropdown toggle button', () => {
    setupStore();
    render(<CustomWgslEditor />);
    expect(screen.getByText('Insert template')).not.toBeNull();
  });

  it('opens template list on toggle button click', () => {
    setupStore();
    render(<CustomWgslEditor />);
    fireEvent.click(screen.getByText('Insert template'));
    expect(screen.getByText('Passthrough')).not.toBeNull();
    expect(screen.getByText('Color Tint')).not.toBeNull();
  });

  it('selects a template and closes the dropdown', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor />);
    fireEvent.click(screen.getByText('Insert template'));
    fireEvent.click(screen.getByText('Grayscale'));

    // Dropdown should close
    expect(screen.queryByText('Passthrough')).toBeNull();

    // Textarea should now contain the grayscale template code
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('luma');
  });

  it('selecting template updates shader name field', () => {
    setupStore();
    render(<CustomWgslEditor />);
    fireEvent.click(screen.getByText('Insert template'));
    fireEvent.click(screen.getByText('Rim Light'));

    const nameInput = screen.getByPlaceholderText('Shader name') as HTMLInputElement;
    expect(nameInput.value).toBe('Rim Light');
  });

  // ── Status indicators ──────────────────────────────────────────────────

  it('shows check-circle icon when status is ok and not dirty', () => {
    setupStore({
      customWgslSource: {
        userCode: 'return base_color;',
        name: 'My Shader',
        compileStatus: 'ok',
        compileError: null,
      },
    });
    const { container } = render(<CustomWgslEditor />);
    // The CheckCircle icon has a title attribute "Compiled successfully"
    expect(container.querySelector('[title="Compiled successfully"]')).not.toBeNull();
  });

  it('shows error icon and message when status is error', () => {
    setupStore({
      customWgslSource: {
        userCode: 'return base_color;',
        name: 'My Shader',
        compileStatus: 'error',
        compileError: 'Undefined variable: foo',
      },
    });
    render(<CustomWgslEditor />);
    expect(screen.getByText('Undefined variable: foo')).not.toBeNull();
  });

  it('shows pending clock icon when status is pending', () => {
    setupStore({
      customWgslSource: {
        userCode: 'return base_color;',
        name: 'My Shader',
        compileStatus: 'pending',
        compileError: null,
      },
    });
    const { container } = render(<CustomWgslEditor />);
    expect(container.querySelector('[title="Pending compilation"]')).not.toBeNull();
  });

  // ── Null source ────────────────────────────────────────────────────────

  it('renders with fallback defaults when customWgslSource is null', () => {
    setupStore({ customWgslSource: null });
    const { container } = render(<CustomWgslEditor />);
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('return base_color;');
  });

  // ── className prop ─────────────────────────────────────────────────────

  it('passes className to the wrapper div', () => {
    setupStore();
    const { container } = render(<CustomWgslEditor className="test-class" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('test-class');
  });
});
