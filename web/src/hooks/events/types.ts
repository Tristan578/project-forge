/**
 * Shared types for event handlers.
 */

import type { EditorState } from '@/stores/editorStore';

export type SetFn = (partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
export type GetFn = () => EditorState;
