import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: [
    'bg-[var(--sf-accent)] text-[var(--sf-on-accent)]',
    'shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]',
    'hover:bg-[var(--sf-accent-hover)] hover:shadow-[0_2px_8px_color-mix(in_srgb,var(--sf-accent)_35%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]',
    'active:scale-[0.97] active:shadow-[0_0_0_rgba(0,0,0,0),inset_0_2px_4px_rgba(0,0,0,0.2)]',
  ].join(' '),
  destructive: [
    'bg-[var(--sf-destructive)] text-[var(--sf-on-accent)]',
    'shadow-[0_1px_3px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]',
    'hover:brightness-110 hover:shadow-[0_2px_8px_color-mix(in_srgb,var(--sf-destructive)_35%,transparent),inset_0_1px_0_rgba(255,255,255,0.15)]',
    'active:scale-[0.97] active:shadow-[0_0_0_rgba(0,0,0,0),inset_0_2px_4px_rgba(0,0,0,0.2)]',
  ].join(' '),
  outline: [
    'bg-[var(--sf-bg-surface)] border border-[var(--sf-border-strong)] text-[var(--sf-text)]',
    'shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
    'hover:bg-[var(--sf-bg-elevated)] hover:border-[var(--sf-accent)] hover:text-[var(--sf-accent)]',
    'active:scale-[0.97]',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--sf-text-secondary)]',
    'hover:bg-[var(--sf-bg-elevated)] hover:text-[var(--sf-text)]',
    'active:scale-[0.97]',
  ].join(' '),
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-8 min-h-[44px] sm:min-h-0 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium',
          'rounded-[var(--sf-radius-md)]',
          'transition-all duration-[var(--sf-transition)] ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sf-bg-app)]',
          'disabled:opacity-40 disabled:pointer-events-none disabled:shadow-none',
          'select-none',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
