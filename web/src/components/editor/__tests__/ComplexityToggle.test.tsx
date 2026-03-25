/**
 * Tests for the ComplexityToggle component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';

// ---------------------------------------------------------------------------
// Mock localStorage for jsdom environment
// ---------------------------------------------------------------------------
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); },
  length: 0,
  key: () => null,
};

vi.stubGlobal('localStorage', localStorageMock);

// ---------------------------------------------------------------------------
// Mock lucide-react icons
// ---------------------------------------------------------------------------
vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
}));

// ---------------------------------------------------------------------------
// Mock the complexity store so we control state cleanly
// ---------------------------------------------------------------------------
const mockSetLevel = vi.fn();
let mockLevel = 'beginner' as import('@/stores/slices/complexitySlice').ComplexityLevel;

vi.mock('@/stores/slices/complexitySlice', async () => {
  const actual = await vi.importActual<typeof import('@/stores/slices/complexitySlice')>(
    '@/stores/slices/complexitySlice'
  );
  return {
    ...actual,
    useComplexityStore: (selector: (s: { level: typeof mockLevel; setLevel: typeof mockSetLevel }) => unknown) =>
      selector({ level: mockLevel, setLevel: mockSetLevel }),
  };
});

import { ComplexityToggle } from '../ComplexityToggle';

describe('ComplexityToggle (full panel)', () => {
  beforeEach(() => {
    mockLevel = 'beginner';
    mockSetLevel.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all three level options', () => {
    render(<ComplexityToggle />);
    expect(screen.getByText('Beginner')).not.toBeNull();
    expect(screen.getByText('Intermediate')).not.toBeNull();
    expect(screen.getByText('Expert')).not.toBeNull();
  });

  it('marks the current level as active', () => {
    mockLevel = 'intermediate';
    render(<ComplexityToggle />);
    const activeButton = screen.getAllByRole('option', { selected: true });
    expect(activeButton).toHaveLength(1);
    expect(activeButton[0].textContent).toContain('Intermediate');
  });

  it('calls setLevel when a different level is clicked', () => {
    render(<ComplexityToggle />);
    const expertButton = screen.getByRole('option', { name: (n) => n.includes('Expert') });
    fireEvent.click(expertButton);
    expect(mockSetLevel).toHaveBeenCalledWith('expert');
  });

  it('displays descriptions for each level', () => {
    render(<ComplexityToggle />);
    // Beginner description text should appear
    expect(screen.getByText(/Essential tools/)).not.toBeNull();
    // Intermediate description text should appear
    expect(screen.getByText(/Adds physics/)).not.toBeNull();
    // Expert description text should appear
    expect(screen.getByText(/Full feature set/)).not.toBeNull();
  });

  it('shows the "always available" note', () => {
    render(<ComplexityToggle />);
    expect(screen.getByText(/Critical features are always available/)).not.toBeNull();
  });

  it('renders the listbox with accessible label', () => {
    render(<ComplexityToggle />);
    expect(screen.getByRole('listbox', { name: 'Complexity level' })).not.toBeNull();
  });
});

describe('ComplexityToggle (compact)', () => {
  beforeEach(() => {
    mockLevel = 'beginner';
    mockSetLevel.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a badge button with current level label', () => {
    render(<ComplexityToggle compact />);
    // The button should show the current level label
    expect(screen.getByRole('button', { name: /Complexity level: Beginner/ })).not.toBeNull();
  });

  it('opens the dropdown on click', () => {
    render(<ComplexityToggle compact />);
    const badge = screen.getByRole('button', { name: /Complexity level: Beginner/ });
    fireEvent.click(badge);
    expect(screen.getByRole('listbox', { name: 'Select complexity level' })).not.toBeNull();
  });

  it('closes the dropdown after selecting a level', () => {
    render(<ComplexityToggle compact />);
    const badge = screen.getByRole('button', { name: /Complexity level: Beginner/ });
    fireEvent.click(badge);
    const expertOption = screen.getByRole('option', { name: (n) => n.includes('Expert') });
    fireEvent.click(expertOption);
    expect(mockSetLevel).toHaveBeenCalledWith('expert');
    // Dropdown should be closed — listbox should no longer be present
    expect(screen.queryByRole('listbox', { name: 'Select complexity level' })).toBeNull();
  });

  it('closes the dropdown when clicking the backdrop', () => {
    render(<ComplexityToggle compact />);
    const badge = screen.getByRole('button', { name: /Complexity level: Beginner/ });
    fireEvent.click(badge);
    // Click the backdrop div (inset-0 overlay)
    const backdrop = document.querySelector('.fixed.inset-0.z-40');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole('listbox', { name: 'Select complexity level' })).toBeNull();
  });

  it('toggles dropdown closed when badge clicked a second time', () => {
    render(<ComplexityToggle compact />);
    const badge = screen.getByRole('button', { name: /Complexity level: Beginner/ });
    fireEvent.click(badge);
    expect(screen.getByRole('listbox', { name: 'Select complexity level' })).not.toBeNull();
    fireEvent.click(badge);
    expect(screen.queryByRole('listbox', { name: 'Select complexity level' })).toBeNull();
  });
});
