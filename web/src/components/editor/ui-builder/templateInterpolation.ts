/**
 * Template Interpolation
 *
 * Replaces {{variableName}} patterns in template strings with values from state.
 * Missing keys resolve to empty string (fail-safe).
 */

/**
 * Replace {{variableName}} patterns in a template string with values from state.
 * Missing keys resolve to empty string.
 */
export function interpolateTemplate(template: string, state: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = state[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}
