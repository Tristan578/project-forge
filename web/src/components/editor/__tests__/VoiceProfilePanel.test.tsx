/**
 * Render tests for VoiceProfilePanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { VoiceProfilePanel } from '../VoiceProfilePanel';
import { useVoiceProfileStore } from '@/stores/voiceProfileStore';
import { useDialogueStore } from '@/stores/dialogueStore';

vi.mock('@/stores/voiceProfileStore', () => ({
  useVoiceProfileStore: vi.fn(() => ({})),
  VOICE_PRESETS: [
    { id: 'voice-1', label: 'Alice', gender: 'female', accent: 'American' },
    { id: 'voice-2', label: 'Bob', gender: 'male', accent: 'British' },
  ],
}));

vi.mock('@/stores/dialogueStore', () => ({
  useDialogueStore: {
    getState: vi.fn(() => ({
      dialogueTrees: {},
    })),
  },
}));

vi.mock('lucide-react', () => ({
  Mic: (props: Record<string, unknown>) => <span data-testid="mic-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Play: (props: Record<string, unknown>) => <span data-testid="play-icon" {...props} />,
  Users: (props: Record<string, unknown>) => <span data-testid="users-icon" {...props} />,
}));

const baseProfile = {
  speaker: 'Hero',
  voiceId: 'voice-1',
  voiceLabel: 'Alice',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  updatedAt: 1000,
};

describe('VoiceProfilePanel', () => {
  const mockSetProfile = vi.fn();
  const mockRemoveProfile = vi.fn();

  function setupStore({
    profiles = {} as Record<string, typeof baseProfile>,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useVoiceProfileStore).mockImplementation((selector: any) => {
      const state = {
        profiles,
        setProfile: mockSetProfile,
        removeProfile: mockRemoveProfile,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Voice Profiles heading', () => {
    render(<VoiceProfilePanel />);
    expect(screen.getByText('Voice Profiles')).toBeInTheDocument();
  });

  it('shows "No voice profiles" when empty', () => {
    render(<VoiceProfilePanel />);
    expect(screen.getByText('No voice profiles')).toBeInTheDocument();
  });

  it('shows profile count badge', () => {
    render(<VoiceProfilePanel />);
    expect(screen.getByText('(0)')).toBeInTheDocument();
  });

  it('shows Add voice profile button', () => {
    render(<VoiceProfilePanel />);
    expect(screen.getByTitle('Add voice profile')).toBeInTheDocument();
  });

  it('shows add form when + button clicked', () => {
    render(<VoiceProfilePanel />);
    fireEvent.click(screen.getByTitle('Add voice profile'));
    // When no unmapped speakers, shows a text input for speaker name
    expect(screen.getByPlaceholderText('Speaker name')).toBeInTheDocument();
  });

  it('shows Cancel button in add form', () => {
    render(<VoiceProfilePanel />);
    fireEvent.click(screen.getByTitle('Add voice profile'));
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('hides add form when Cancel clicked', () => {
    render(<VoiceProfilePanel />);
    fireEvent.click(screen.getByTitle('Add voice profile'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Speaker name')).toBeNull();
  });

  it('renders profile speaker name when profiles exist', () => {
    setupStore({ profiles: { Hero: baseProfile } });
    render(<VoiceProfilePanel />);
    expect(screen.getByText('Hero')).toBeInTheDocument();
  });

  it('shows profile voice label', () => {
    setupStore({ profiles: { Hero: baseProfile } });
    render(<VoiceProfilePanel />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows profile count with profiles', () => {
    setupStore({ profiles: { Hero: baseProfile } });
    render(<VoiceProfilePanel />);
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('expands edit panel when profile row clicked', () => {
    setupStore({ profiles: { Hero: baseProfile } });
    render(<VoiceProfilePanel />);
    // Click the profile row button (shows speaker name)
    fireEvent.click(screen.getByText('Hero'));
    expect(screen.getByText('Stability')).toBeInTheDocument();
  });

  it('calls setProfile when Save clicked in edit panel', () => {
    setupStore({ profiles: { Hero: baseProfile } });
    render(<VoiceProfilePanel />);
    fireEvent.click(screen.getByText('Hero'));
    fireEvent.click(screen.getByText('Save'));
    expect(mockSetProfile).toHaveBeenCalled();
  });

  it('calls removeProfile when delete button clicked in edit panel', () => {
    setupStore({ profiles: { Hero: baseProfile } });
    render(<VoiceProfilePanel />);
    fireEvent.click(screen.getByText('Hero'));
    fireEvent.click(screen.getByTitle('Delete profile'));
    expect(mockRemoveProfile).toHaveBeenCalledWith('Hero');
  });

  it('uses useDialogueStore.getState for speaker discovery', () => {
    render(<VoiceProfilePanel />);
    expect(useDialogueStore.getState).toHaveBeenCalled();
  });
});
