/**
 * "Customize with AI" after a starter template loads (#10172).
 *
 * The toast's action PRE-FILLS the chat composer and reveals the chat. It never
 * sends: `ChatInput` shows a token estimate before anything is spent, so the
 * user finishes the sentence and decides. Shared by every template success path
 * (the gallery and the onboarding wizard) so both offer the same thing.
 */
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chatStore';
import { revealChat } from './revealChat';

/** The starter text placed in the composer, naming the template. */
export function customizeDraftFor(templateName: string): string {
  return `Change this ${templateName} so that `;
}

/** Offer to customise the template that just loaded. */
export function offerCustomizeWithAi(templateName: string): void {
  toast.success(`${templateName} is ready`, {
    description: 'Make it yours: describe a change in the AI chat.',
    action: {
      label: 'Customize with AI',
      onClick: () => {
        useChatStore.getState().setComposerDraft(customizeDraftFor(templateName));
        revealChat();
      },
    },
  });
}
