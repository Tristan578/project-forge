/**
 * The composer draft (#10172) against the REAL chat store: a draft set from
 * anywhere is placed in the composer once, after anything the user typed, and
 * is never sent on their behalf. The sibling ChatInput.test.tsx mocks the
 * store, which cannot show the adopt-then-clear round trip.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';
import { ChatInput } from '../ChatInput';
import { useChatStore } from '@/stores/chatStore';

vi.mock('../EntityPicker', () => ({ EntityPicker: () => null }));

const sendMessage = vi.fn();

function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Describe what you want/) as HTMLTextAreaElement;
}

function setDraft(text: string) {
  act(() => {
    useChatStore.getState().setComposerDraft(text);
  });
}

beforeEach(() => {
  sendMessage.mockReset();
  useChatStore.setState({ composerDraft: '', sendMessage });
});

afterEach(() => {
  cleanup();
  useChatStore.setState({ composerDraft: '' });
});

describe('ChatInput composer draft (#10172)', () => {
  it('adopts a draft set before it mounted, then clears the store copy', () => {
    setDraft('Change this Platformer so that ');

    render(<ChatInput draftTarget />);

    expect(composer().value).toBe('Change this Platformer so that ');
    expect(useChatStore.getState().composerDraft).toBe('');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not apply the same draft again on a later mount', () => {
    setDraft('Change this Platformer so that ');
    const first = render(<ChatInput draftTarget />);
    expect(composer().value).toBe('Change this Platformer so that ');
    first.unmount();

    render(<ChatInput draftTarget />);

    expect(composer().value).toBe('');
  });

  it('puts a draft after what the user already typed, on its own line', () => {
    render(<ChatInput draftTarget />);
    fireEvent.change(composer(), { target: { value: 'make it night' } });

    setDraft('Change this Platformer so that ');

    expect(composer().value).toBe('make it night\nChange this Platformer so that ');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('focuses the composer with the caret at the end so the user can finish the sentence', () => {
    render(<ChatInput draftTarget />);

    setDraft('Change this Platformer so that ');

    const el = composer();
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(el.value.length);
    expect(el.selectionEnd).toBe(el.value.length);
  });

  it('a composer that is not the draft target neither adopts, clears, nor focuses', () => {
    render(<ChatInput />);

    setDraft('Change this Platformer so that ');

    expect(composer().value).toBe('');
    expect(document.activeElement).not.toBe(composer());
    expect(useChatStore.getState().composerDraft).toBe('Change this Platformer so that ');
  });

  it('adopts a second, different draft while still mounted', () => {
    render(<ChatInput draftTarget />);
    setDraft('First draft');
    fireEvent.change(composer(), { target: { value: '' } });

    setDraft('Second draft');

    expect(composer().value).toBe('Second draft');
  });
});
