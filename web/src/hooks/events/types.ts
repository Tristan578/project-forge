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
 * The cast is safe because bridge payloads are always plain JS objects that
 * structurally match the target type T at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function castPayload<T>(data: Record<string, any>): T {
  return data as T;
}
