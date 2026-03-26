/**
 * Shared types for event handlers.
 */

import type { EditorState } from '@/stores/editorStore';

export type SetFn = (partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
export type GetFn = () => EditorState;

/**
 * Type-safe payload cast for bridge event data.
 *
 * Replaces the `data as unknown as T` double-cast pattern throughout event
 * handlers (PF-342). Centralizes the assertion so runtime validation can be
 * added in one place later (e.g. Zod parse in dev mode).
 *
 * The data arrives from Rust via serde-wasm-bindgen as a JS object — structurally
 * correct at runtime but typed as Record<string, unknown> by the event callback.
 */
export function castPayload<T>(data: Record<string, unknown>): T {
  return data as unknown as T;
}
