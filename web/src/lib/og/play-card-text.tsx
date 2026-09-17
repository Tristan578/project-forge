/** Lay out pure Arabic OG paragraphs in reading order using Satori-supported flex. */
import type { ReactNode } from 'react';

/**
 * Return card text with Arabic words flowing from the right and wrapping in
 * logical line order. Satori shapes each Arabic word but lays paragraph words
 * left to right; a reversed flex row fixes that without reversing source text.
 * @param text Sanitized, locally covered card text.
 * @param fontSize Font size in pixels, used for a proportional word gap.
 * @returns The original text for other or mixed scripts, or a wrapping Arabic
 * word container. Mixed bidirectional paragraphs still require a full bidi renderer.
 */
export function renderPlayCardText(text: string, fontSize: number): ReactNode {
  const arabic = /\p{Script_Extensions=Arabic}/u.test(text)
    && [...text].every(character => !/\p{Letter}/u.test(character)
      || /\p{Script_Extensions=Arabic}/u.test(character));
  if (!arabic) return text;
  return (
    <div style={{ display: 'flex', flexDirection: 'row-reverse', flexWrap: 'wrap',
      width: '100%', alignItems: 'baseline', columnGap: fontSize * 0.28 }}>
      {text.trim().split(/\s+/u).map((word, index) => (
        <span key={index} style={{ display: 'flex', whiteSpace: 'pre', flexShrink: 0 }}>{word}</span>
      ))}
    </div>
  );
}
