/**
 * User notice when a requested background removal step was skipped.
 * @param outcome Provider response backgroundRemoval value.
 * @returns Warning for unavailable/unsupported removal, otherwise undefined.
 */
export function backgroundRemovalWarning(outcome: unknown): string | undefined {
  if (outcome === 'unsupported') return 'Background removal is not supported for this sprite type; the image will keep its background.';
  if (outcome === 'unavailable') return 'Background removal is unavailable; the generated image keeps its background.';
  return undefined;
}
