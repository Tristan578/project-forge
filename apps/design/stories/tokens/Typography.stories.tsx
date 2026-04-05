import type { Meta, StoryObj } from '@storybook/react';
import { FONT_FAMILY, FONT_SIZE, FONT_WEIGHT } from '@spawnforge/ui/tokens';

function TypographyReference() {
  return (
    <div className="p-6 font-sans">
      <h2 className="mb-6">Typography Tokens</h2>

      <section className="mb-8">
        <h3 className="mb-3 text-sm uppercase opacity-60">
          Font Families
        </h3>
        {Object.entries(FONT_FAMILY).map(([key, value]) => (
          <div key={key} className="mb-3" style={{ '--ff': value } as React.CSSProperties}>
            <div className="font-mono text-xs opacity-50 mb-1">
              FONT_FAMILY.{key}
            </div>
            <div className="font-[family-name:var(--ff)] text-lg">
              The quick brown fox jumps over the lazy dog
            </div>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <h3 className="mb-3 text-sm uppercase opacity-60">
          Font Sizes
        </h3>
        {Object.entries(FONT_SIZE).map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline gap-4 mb-2"
            style={{ '--fs': value } as React.CSSProperties}
          >
            <div className="w-[100px] font-mono text-xs opacity-50">
              FONT_SIZE.{key}
            </div>
            <div className="w-[60px] font-mono text-xs opacity-50">
              {value}
            </div>
            <div className="text-[length:var(--fs)]">
              Sample text at {key}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3 className="mb-3 text-sm uppercase opacity-60">
          Font Weights
        </h3>
        {Object.entries(FONT_WEIGHT).map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline gap-4 mb-2"
            style={{ '--fw': value } as React.CSSProperties}
          >
            <div className="w-[100px] font-mono text-xs opacity-50">
              FONT_WEIGHT.{key}
            </div>
            <div className="w-[40px] font-mono text-xs opacity-50">
              {value}
            </div>
            <div className="font-[number:var(--fw)] text-lg">
              Sample text at {key} weight
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

const meta: Meta = {
  title: 'Tokens/Typography',
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj;

export const Reference: Story = {
  render: () => <TypographyReference />,
};
