'use client';

import { EditorLayout } from '@/components/editor/EditorLayout';

/**
 * Local development editor — bypasses auth and database.
 * Access at: http://localhost:3000/dev
 */
export default function DevEditorPage() {
  return <EditorLayout />;
}
