import { describe, it, expect } from 'vitest';
import { generationResultUrlSchema, MAX_INLINE_RESULT_URL_LENGTH } from '../resultUrl';

describe('bounded generation artifact URL', () => {
  it('accepts large PNG data URLs without placing them in a query string', () => {
    const image = 'data:image/png;base64,' + 'A'.repeat(4096);
    expect(generationResultUrlSchema.parse(image)).toBe(image);
  });
  it.each(['data:image/png;base64,', 'data:image/png;base64,AAAA!', 'data:image/png;base64,A', 'data:text/html;base64,AAAA', 'javascript:alert(1)'])('rejects malformed or unsupported artifact %s', (value) => {
    expect(generationResultUrlSchema.safeParse(value).success).toBe(false);
  });
  it('rejects oversized inline images and HTTP URLs', () => {
    expect(generationResultUrlSchema.safeParse('data:image/png;base64,' + 'A'.repeat(MAX_INLINE_RESULT_URL_LENGTH)).success).toBe(false);
    expect(generationResultUrlSchema.safeParse('https://example.com/' + 'a'.repeat(2000)).success).toBe(false);
  });
});
