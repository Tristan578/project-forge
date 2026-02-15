'use client';

import { HelpCircle } from 'lucide-react';
import { TOOLTIP_DICTIONARY } from '@/lib/workspace/tooltipDictionary';

interface InfoTooltipProps {
  /** Key into the tooltip dictionary */
  term?: string;
  /** Optional override text (instead of dictionary lookup) */
  text?: string;
  /** Size of the icon in pixels (default 12) */
  size?: number;
}

/**
 * A small (?) icon that shows a plain-English tooltip on hover.
 * Designed to help non-developer users understand technical game dev terms.
 *
 * Usage: <InfoTooltip term="bloom" /> next to a label
 */
export function InfoTooltip({ term, text, size = 12 }: InfoTooltipProps) {
  const tooltip = text ?? (term ? TOOLTIP_DICTIONARY[term] : undefined);
  if (!tooltip) return null;

  return (
    <span
      className="ml-1 inline-flex cursor-help text-zinc-600 hover:text-zinc-400 transition-colors"
      title={tooltip}
    >
      <HelpCircle size={size} />
    </span>
  );
}
