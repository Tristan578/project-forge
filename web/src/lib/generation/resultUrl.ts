/** Validate bounded HTTP artifact URLs and inline PNGs for generation and saved jobs. */
import { z } from 'zod';

/** Keep inline PNG artifacts below the function's 4.5 MB JSON body limit. */
export const MAX_INLINE_RESULT_URL_LENGTH = 4 * 1024 * 1024;

/** Bounded HTTP artifact URL or inline PNG; never use this value as a job ID. */
export const generationResultUrlSchema = z.string().min(1).max(MAX_INLINE_RESULT_URL_LENGTH).refine(
  (value) => value.startsWith('data:image/png;base64,')
    ? /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && (value.length - 22) % 4 === 0
    : value.length <= 2000 && /^https?:\/\//.test(value),
  'Result must be an HTTP URL or a bounded non-empty PNG data URL',
);
