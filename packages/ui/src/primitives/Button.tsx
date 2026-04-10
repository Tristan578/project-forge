import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-[var(--sf-accent)] text-[var(--sf-on-accent)] hover:bg-[var(--sf-accent-hover)]',
  destructive: 'bg-[var(--sf-destructive)] sf-destructive text-[var(--sf-on-accent)] hover:opacity-90',
  outline: 'bg-transparent border-[length:var(--sf-border-width)] border-[var(--sf-border-strong)] text-[var(--sf-text)] hover:bg-[var(--sf-bg-elevated)]',
  ghost: 'bg-transparent text-[var(--sf-text)] hover:bg-[var(--sf-bg-elevated)]',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  // sm must meet 44px touch target on mobile (WCAG 2.5.5)
  sm: 'h-8 min-h-[44px] sm:min-h-0 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-6 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium',
          'rounded-[var(--sf-radius-md)]',
          'transition-colors duration-[var(--sf-transition)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-accent)]',
          'disabled:opacity-50 disabled:pointer-events-none',
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
