import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { EconomyPanel } from '../EconomyPanel';

// Use vi.hoisted so the mock data is available when vi.mock factories run
const { mockEconomy } = vi.hoisted(() => {
  const mockEconomy = {
    currencies: [{ id: 'gold', name: 'Gold', symbol: 'G', startingAmount: 100, maxAmount: 9999, earnRate: 1.0, color: '#FFD700', sinks: ['shop', 'crafting'] }],
    shop: [
      { id: 'sword', name: 'Iron Sword', description: 'A basic sword', price: 50, currency: 'Gold', category: 'weapons', rarity: 'common', unlockLevel: 1 },
    ],
    lootTables: [],
    progression: {
      xpPerLevel: [100, 250, 500, 1000],
      maxLevel: 4,
      statScaling: { health: 1.1, damage: 1.05, defense: 1.08 },
    },
    balanceScore: 85,
  };
  return { mockEconomy };
});

vi.mock('@/lib/ai/economyDesigner', () => ({
  ECONOMY_PRESETS: {
    casual_mobile: mockEconomy,
    rpg_classic: mockEconomy,
  },
  validateBalance: vi.fn(() => ({
    score: 85,
    passed: true,
    issues: [],
    recommendations: ['Consider adding a premium currency tier'],
  })),
  economyToScript: vi.fn(() => '// Economy script\nconst economy = {};'),
  generateEconomy: vi.fn(() => Promise.resolve(mockEconomy)),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

import { generateEconomy, validateBalance } from '@/lib/ai/economyDesigner';

describe('EconomyPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders the Economy Designer heading', () => {
    render(<EconomyPanel />);
    expect(screen.getByText('Economy Designer')).toBeDefined();
  });

  it('renders preset selector and game description controls', () => {
    render(<EconomyPanel />);
    expect(screen.getByLabelText('Economy preset')).toBeDefined();
    expect(screen.getByLabelText('Game description for economy generation')).toBeDefined();
  });

  it('shows empty state message before any economy is loaded', () => {
    render(<EconomyPanel />);
    expect(screen.getByText(/Select a preset or describe your game/)).toBeDefined();
  });

  it('calls generateEconomy when Generate Economy button is clicked', async () => {
    render(<EconomyPanel />);
    fireEvent.click(screen.getByLabelText('Generate economy'));
    expect(vi.mocked(generateEconomy)).toHaveBeenCalledOnce();
  });

  it('shows generating state while generateEconomy is pending', () => {
    vi.mocked(generateEconomy).mockReturnValue(new Promise(() => {}));
    render(<EconomyPanel />);
    fireEvent.click(screen.getByLabelText('Generate economy'));
    expect(screen.getByText('Generating...')).toBeDefined();
  });

  it('loads economy from preset when preset is selected', () => {
    render(<EconomyPanel />);
    const select = screen.getByLabelText('Economy preset') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'casual_mobile' } });
    // Economy should be loaded — Balance Score section should appear
    expect(screen.getByText('Balance Score')).toBeDefined();
  });

  it('calls validateBalance when preset is loaded', () => {
    render(<EconomyPanel />);
    fireEvent.change(screen.getByLabelText('Economy preset') as HTMLSelectElement, {
      target: { value: 'casual_mobile' },
    });
    expect(vi.mocked(validateBalance)).toHaveBeenCalledWith(mockEconomy);
  });

  it('shows balance score after preset load', () => {
    render(<EconomyPanel />);
    fireEvent.change(screen.getByLabelText('Economy preset') as HTMLSelectElement, {
      target: { value: 'casual_mobile' },
    });
    expect(screen.getByText('85')).toBeDefined();
    expect(screen.getByText('/100')).toBeDefined();
  });

  it('shows Currencies section after economy is loaded', () => {
    render(<EconomyPanel />);
    fireEvent.change(screen.getByLabelText('Economy preset') as HTMLSelectElement, {
      target: { value: 'casual_mobile' },
    });
    // Section title is "Currencies (N)" with count
    expect(screen.getByText(/^Currencies/)).toBeDefined();
  });

  it('shows Shop Items section after economy is loaded', () => {
    render(<EconomyPanel />);
    fireEvent.change(screen.getByLabelText('Economy preset') as HTMLSelectElement, {
      target: { value: 'casual_mobile' },
    });
    // Section title is "Shop Items (N)" with count
    expect(screen.getByText(/^Shop Items/)).toBeDefined();
  });

  it('description textarea accepts text input', () => {
    render(<EconomyPanel />);
    const textarea = screen.getByLabelText('Game description for economy generation');
    fireEvent.change(textarea, { target: { value: 'A fantasy RPG with crafting' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('A fantasy RPG with crafting');
  });

  it('shows preset options for all defined presets', () => {
    render(<EconomyPanel />);
    const select = screen.getByLabelText('Economy preset') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('casual_mobile');
    expect(options).toContain('rpg_classic');
  });
});
