/**
 * Shared utilities for the export pipeline.
 * Centralises HTML/script/CSS sanitisation used by gameTemplate, loadingScreen and zipExporter.
 */

/**
 * Escape HTML special characters to prevent XSS.
 * Replaces &, <, >, ", ' with HTML entities.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape content destined for inline <script> blocks.
 * Prevents </script> from terminating the script tag early
 * and <!-- from being interpreted as an HTML comment inside script.
 */
export function escapeScriptContent(content: string): string {
  return content
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--');
}

/**
 * Validate a CSS color value. Returns the validated color or '#000000' as fallback.
 * Accepts: hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb(), rgba(), hsl(), hsla().
 */
export function validateCssColor(color: string): string {
  const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[\d.]+)?\s*\)$/;
  const HSL_RE = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(\s*,\s*[\d.]+)?\s*\)$/;
  if (HEX_RE.test(color) || RGB_RE.test(color) || HSL_RE.test(color)) return color;
  return '#000000';
}
