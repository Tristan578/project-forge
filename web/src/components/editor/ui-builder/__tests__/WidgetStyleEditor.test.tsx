/**
 * Tests for WidgetStyleEditor.
 *
 * Covers: the null-render guard when nothing is selected, the
 * expand/collapse toggle, every property onChange handler dispatching
 * updateWidgetStyle with the expected field, and the padding-array
 * handler preserving the other three sides while replacing one index.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { WidgetStyleEditor } from '../WidgetStyleEditor';
import { useUIBuilderStore } from '@/stores/uiBuilderStore';

vi.mock('@/stores/uiBuilderStore', () => ({
  useUIBuilderStore: vi.fn(),
}));

const mockUpdateWidgetStyle = vi.fn();

const baseStyle = {
  backgroundColor: '#abcdef',
  borderWidth: 1,
  borderColor: '#333333',
  borderRadius: 4,
  padding: [1, 2, 3, 4] as [number, number, number, number],
  opacity: 0.75,
  fontFamily: 'system-ui',
  fontSize: 16,
  fontWeight: 'normal',
  color: '#ffffff',
  textAlign: 'left',
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
};

function setupStore(widget: { id: string; style: typeof baseStyle } | null) {
  const screens = [
    {
      id: 'screen-1',
      widgets: widget ? [widget] : [],
    },
  ];
  const state = {
    activeScreenId: widget ? 'screen-1' : null,
    selectedWidgetId: widget ? widget.id : null,
    screens,
    updateWidgetStyle: mockUpdateWidgetStyle,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useUIBuilderStore).mockImplementation((selector: any) =>
    typeof selector === 'function' ? selector(state) : state
  );
}

describe('WidgetStyleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no widget is selected', () => {
    setupStore(null);

    const { container } = render(<WidgetStyleEditor />);

    expect(container).toBeEmptyDOMElement();
  });

  it('collapses and re-expands the property list on toggle', () => {
    setupStore({ id: 'w1', style: baseStyle });

    render(<WidgetStyleEditor />);
    expect(screen.getByText('Background Color')).toBeDefined();

    fireEvent.click(screen.getByText('Style Properties'));
    expect(screen.queryByText('Background Color')).toBeNull();

    fireEvent.click(screen.getByText('Style Properties'));
    expect(screen.getByText('Background Color')).toBeDefined();
  });

  it('updates backgroundColor, converting an empty string to null', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    fireEvent.change(screen.getByLabelText('Background Color'), { target: { value: '' } });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', {
      backgroundColor: null,
    });
  });

  it('passes through a non-empty backgroundColor value', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    fireEvent.change(screen.getByLabelText('Background Color'), {
      target: { value: '#123456' },
    });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', {
      backgroundColor: '#123456',
    });
  });

  it('updates borderWidth, borderColor and borderRadius', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    fireEvent.change(screen.getByLabelText('Border Width'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Border Color'), { target: { value: '#ff0000' } });
    fireEvent.change(screen.getByLabelText('Border Radius (px)'), { target: { value: '8' } });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { borderWidth: 3 });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', {
      borderColor: '#ff0000',
    });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { borderRadius: 8 });
  });

  it('updates one padding side while leaving the others untouched', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    const [, , bottomInput] = screen.getAllByLabelText(/^[TRBL]$/);
    fireEvent.change(bottomInput, { target: { value: '9' } });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', {
      padding: [1, 2, 9, 4],
    });
  });

  it('updates opacity via the range input', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    fireEvent.change(screen.getByLabelText(/^Opacity/), { target: { value: '0.5' } });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { opacity: 0.5 });
  });

  it('updates font family, size, weight, color and text-align', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    fireEvent.change(screen.getByLabelText('Font Family'), { target: { value: 'monospace' } });
    fireEvent.change(screen.getByLabelText('Font Size'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('Font Weight'), { target: { value: 'bold' } });
    fireEvent.change(screen.getByLabelText('Text Color'), { target: { value: '#000000' } });
    fireEvent.change(screen.getByLabelText('Text Align'), { target: { value: 'center' } });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', {
      fontFamily: 'monospace',
    });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { fontSize: 24 });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { fontWeight: 'bold' });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { color: '#000000' });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', {
      textAlign: 'center',
    });
  });

  it('updates rotation, scaleX and scaleY', () => {
    setupStore({ id: 'w1', style: baseStyle });
    render(<WidgetStyleEditor />);

    fireEvent.change(screen.getByLabelText('Rotation (deg)'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Scale X'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Scale Y'), { target: { value: '3' } });

    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { rotation: 45 });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { scaleX: 2 });
    expect(mockUpdateWidgetStyle).toHaveBeenCalledWith('screen-1', 'w1', { scaleY: 3 });
  });
});
