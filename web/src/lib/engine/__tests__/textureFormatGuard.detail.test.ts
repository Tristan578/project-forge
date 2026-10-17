/**
 * The thrown-error detail in the load and import sentences is bounded, like
 * the file name beside it (#10396 round 4 minors): a very long store error
 * must not swamp a transient toast.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ERROR_DETAIL,
  assetImportFailureMessage,
  textureLoadFailureMessage,
} from '../textureFormatGuard';

describe('thrown-error detail in the picker sentences', () => {
  const long = 'x'.repeat(MAX_ERROR_DETAIL + 50);
  const exact = 'y'.repeat(MAX_ERROR_DETAIL);

  it('cuts a long Error message at the limit with an ellipsis, in both sentences', () => {
    const load = textureLoadFailureMessage('a.png', new Error(long));
    const imported = assetImportFailureMessage('a.glb', new Error(long));
    expect(load).toBe(`Could not load texture "a.png": ${'x'.repeat(MAX_ERROR_DETAIL)}…`);
    expect(imported).toBe(`Could not import "a.glb": ${'x'.repeat(MAX_ERROR_DETAIL)}…`);
    expect([...load].length).toBeLessThan(long.length);
  });

  it('leaves a message at or under the limit untouched, and stringifies a non-Error throw', () => {
    expect(textureLoadFailureMessage('a.png', new Error(exact))).toBe(`Could not load texture "a.png": ${exact}`);
    expect(textureLoadFailureMessage('a.png', new Error('engine not ready'))).toBe('Could not load texture "a.png": engine not ready');
    expect(assetImportFailureMessage('a.glb', 'audio graph not ready')).toBe('Could not import "a.glb": audio graph not ready');
    expect(assetImportFailureMessage('a.glb', 42)).toBe('Could not import "a.glb": 42');
  });

  it('bounds the detail and the name independently', () => {
    const name = 'n'.repeat(100) + '.png';
    const message = textureLoadFailureMessage(name, new Error(long));
    expect(message).toContain(`"${'n'.repeat(60)}…"`);
    expect(message.endsWith(`${'x'.repeat(MAX_ERROR_DETAIL)}…`)).toBe(true);
  });
});
