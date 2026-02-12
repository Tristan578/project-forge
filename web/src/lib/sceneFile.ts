/**
 * Scene file I/O utilities — download, upload, and localStorage auto-save.
 */

const AUTOSAVE_KEY = 'forge:autosave';
const AUTOSAVE_NAME_KEY = 'forge:autosave:name';
const AUTOSAVE_TIME_KEY = 'forge:autosave:time';

/** Trigger a browser file download of the scene JSON. */
export function downloadSceneFile(json: string, name: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'Untitled'}.forge`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Read a .forge file from a File object. Validates formatVersion. */
export async function readSceneFile(file: File): Promise<string> {
  const text = await file.text();
  // Basic validation
  const parsed = JSON.parse(text);
  if (typeof parsed.formatVersion !== 'number') {
    throw new Error('Invalid scene file: missing formatVersion');
  }
  if (parsed.formatVersion !== 1) {
    throw new Error(`Unsupported scene format version: ${parsed.formatVersion}`);
  }
  return text;
}

/** Open a file picker and return the chosen .forge file contents. */
export function openSceneFilePicker(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.forge,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const json = await readSceneFile(file);
        resolve(json);
      } catch (err) {
        console.error('[SceneFile] Failed to read file:', err);
        resolve(null);
      }
    };
    input.click();
  });
}

/** Get the auto-saved scene from localStorage. */
export function getAutoSave(): { json: string; name: string; time: string } | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    if (!json) return null;
    const name = localStorage.getItem(AUTOSAVE_NAME_KEY) || 'Untitled';
    const time = localStorage.getItem(AUTOSAVE_TIME_KEY) || '';
    return { json, name, time };
  } catch {
    return null;
  }
}

/** Clear the auto-save from localStorage. */
export function clearAutoSave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(AUTOSAVE_NAME_KEY);
    localStorage.removeItem(AUTOSAVE_TIME_KEY);
  } catch {
    // ignore
  }
}
