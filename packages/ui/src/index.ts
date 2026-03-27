// Public exports (tiers 1 + 2)
export { cn } from './utils/cn';
export {
  THEME_NAMES,
  type ThemeName,
  type ThemeColorTokens,
  type ThemeStructureTokens,
  type ThemeTokens,
  THEME_DEFINITIONS,
  generateThemeCSS,
  generateAllThemeCSS,
  SPACING,
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  RADIUS,
  Z_INDEX,
} from './tokens';
export { useTheme } from './hooks/useTheme';
export type { UseThemeOptions } from './hooks/useTheme';

// Tier 1 Primitives
export { Button, type ButtonProps } from './primitives/Button';
export { Input, type InputProps } from './primitives/Input';
export { Badge, type BadgeProps } from './primitives/Badge';
export { Card, type CardProps } from './primitives/Card';
export { Label, type LabelProps } from './primitives/Label';
export { Select, type SelectProps, type SelectOption } from './primitives/Select';
export { Textarea, type TextareaProps } from './primitives/Textarea';
export { Switch, type SwitchProps } from './primitives/Switch';
export { Checkbox, type CheckboxProps } from './primitives/Checkbox';
export { Separator, type SeparatorProps } from './primitives/Separator';
export { Tooltip, type TooltipProps } from './primitives/Tooltip';
export { Dialog, type DialogProps } from './primitives/Dialog';
export { Popover, type PopoverProps } from './primitives/Popover';
export { ScrollArea, type ScrollAreaProps } from './primitives/ScrollArea';
export { Tabs, type TabsProps, type TabItem } from './primitives/Tabs';
export { useDialogA11y, type UseDialogA11yOptions, type UseDialogA11yReturn } from './hooks/useDialogA11y';
export { Accordion, type AccordionProps, type AccordionItem } from './primitives/Accordion';
export { Avatar, type AvatarProps } from './primitives/Avatar';
export { Progress, type ProgressProps } from './primitives/Progress';
export { Skeleton, type SkeletonProps } from './primitives/Skeleton';
export { Toast, type ToastProps, type ToastVariant } from './primitives/Toast';

// Ambient theme effects
export { ThemeAmbient } from './effects/ThemeAmbient';

// Utilities
export { validateCustomTheme, type ValidatedTheme } from './utils/themeValidator';
