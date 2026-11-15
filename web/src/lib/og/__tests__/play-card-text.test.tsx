// @vitest-environment node
/** Guard logical Arabic word order, wrapping, and unchanged non-Arabic text. */
import { describe, expect, it } from 'vitest';
import type { CSSProperties, ReactElement } from 'react';
import { renderPlayCardText } from '../play-card-text';

type Paragraph = ReactElement<{ style: CSSProperties; children: ReactElement<{ style: CSSProperties; children: string }>[] }>;

describe('Arabic play-card paragraph flow', () => {
  it.each(['مغامرة النجوم', 'مغامرة النجوم في السماء الواسعة', 'مغامرة النجوم 123', 'م'.repeat(80)])('keeps logical words while placing and wrapping from the right: %s', text => {
    const paragraph = renderPlayCardText(text, 56) as Paragraph;
    expect(paragraph.props.style.flexDirection).toBe('row-reverse');
    expect(paragraph.props.style.flexWrap).toBe('wrap');
    expect(paragraph.props.style.width).toBe('100%');
    expect(paragraph.props.children.map(word => word.props.children)).toEqual(text.split(/\s+/u));
    expect(paragraph.props.children.every(word => word.props.style.whiteSpace === 'normal' && word.props.style.wordBreak === 'break-all' && word.props.style.maxWidth === '100%' && word.props.style.flexShrink === 0)).toBe(true);
    expect(paragraph.props.style.columnGap).toBeCloseTo(56 * 0.28);
  });
  it.each(['Space Game', '星の冒険', 'Звёздное приключение', 'مغامرة Space Game', '123'])('preserves other and mixed-script text: %s', text => {
    expect(renderPlayCardText(text, 24)).toBe(text);
  });
});
