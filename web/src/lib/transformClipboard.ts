/**
 * Transform clipboard utilities for copy/paste functionality.
 *
 * Uses the browser Clipboard API with JSON-formatted transform data.
 */

export type TransformProperty = 'position' | 'rotation' | 'scale';

export interface TransformClipboardData {
  type: 'forge-transform';
  property?: TransformProperty;
  position?: [number, number, number];
  rotation?: [number, number, number]; // Stored in degrees
  scale?: [number, number, number];
}

/**
 * Validate that data is a valid TransformClipboardData object.
 */
function isValidTransformData(data: unknown): data is TransformClipboardData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj.type !== 'forge-transform') return false;

  // Must have at least one transform property
  const hasPosition = Array.isArray(obj.position) && obj.position.length === 3;
  const hasRotation = Array.isArray(obj.rotation) && obj.rotation.length === 3;
  const hasScale = Array.isArray(obj.scale) && obj.scale.length === 3;

  return hasPosition || hasRotation || hasScale;
}

/**
 * Copy a single transform property to clipboard.
 */
export async function copyTransformProperty(
  property: TransformProperty,
  value: [number, number, number]
): Promise<boolean> {
  try {
    const data: TransformClipboardData = {
      type: 'forge-transform',
      property,
      [property]: value,
    };
    await navigator.clipboard.writeText(JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Copy entire transform to clipboard.
 */
export async function copyFullTransform(
  position: [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number]
): Promise<boolean> {
  try {
    const data: TransformClipboardData = {
      type: 'forge-transform',
      position,
      rotation,
      scale,
    };
    await navigator.clipboard.writeText(JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * Read transform data from clipboard.
 * Returns null if clipboard is empty or doesn't contain valid transform data.
 */
export async function readTransformFromClipboard(): Promise<TransformClipboardData | null> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return null;

    const data = JSON.parse(text);
    if (isValidTransformData(data)) {
      return data;
    }
    return null;
  } catch {
    // Clipboard empty, permission denied, or invalid JSON
    return null;
  }
}

/**
 * Get a specific property value from clipboard data.
 * If clipboard has a single property that matches, returns it.
 * If clipboard has full transform, extracts the requested property.
 */
export async function getPropertyFromClipboard(
  property: TransformProperty
): Promise<[number, number, number] | null> {
  const data = await readTransformFromClipboard();
  if (!data) return null;

  const value = data[property];
  if (Array.isArray(value) && value.length === 3) {
    return value as [number, number, number];
  }

  return null;
}

/**
 * Check if clipboard has valid transform data.
 */
export async function hasTransformInClipboard(): Promise<boolean> {
  const data = await readTransformFromClipboard();
  return data !== null;
}

/**
 * Check if clipboard has a specific property.
 */
export async function hasPropertyInClipboard(
  property: TransformProperty
): Promise<boolean> {
  const data = await readTransformFromClipboard();
  if (!data) return false;
  return Array.isArray(data[property]) && data[property]!.length === 3;
}
