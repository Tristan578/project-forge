import { type ReactNode } from "react";
import { cn } from "../utils/cn";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { useScrollLock } from "../hooks/useScrollLock";
import { Z_INDEX } from "../tokens";
import { ScrollArea } from "./ScrollArea";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  className,
}: DialogProps) {
  const { dialogProps, titleProps } = useDialogA11y({
    title,
    isOpen: open,
    onClose,
  });
  useScrollLock(open);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        data-dialog-overlay
        className="fixed inset-0 bg-[color-mix(in_srgb,var(--sf-bg-app)_70%,transparent)] backdrop-blur-sm"
        style={{ zIndex: Z_INDEX.modals - 1 }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog panel */}
      <div
        {...dialogProps}
        tabIndex={-1}
        className={cn(
          "fixed",
          "w-full max-w-md",
          "max-h-[85vh]",
          "rounded-[var(--sf-radius-xl)]",
          "border border-[var(--sf-border)]",
          "bg-[var(--sf-bg-surface)] text-[var(--sf-text)]",
          "shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]",
          "flex flex-col",
          className
        )}
        style={{
          zIndex: Z_INDEX.modals,
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <h2 {...titleProps} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-sm text-[var(--sf-text-secondary)] leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {/* Body -- ScrollArea gives this its own scroll container (so tall
            content scrolls internally rather than growing the fixed panel
            past the viewport) and carries `[overscroll-behavior:contain]`,
            which stops a drag that hits the end of this list from chaining
            into the (locked) document behind it (PF-1032 / #9052 acceptance
            criterion 5). */}
        {children && (
          <ScrollArea className="min-h-0 flex-1 px-6 py-3 text-sm">
            {children}
          </ScrollArea>
        )}
        {/* Actions */}
        {actions && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--sf-border)] bg-[var(--sf-bg-app)]/30 rounded-b-[var(--sf-radius-xl)]">
            {actions}
          </div>
        )}
      </div>
    </>
  );
}

Dialog.displayName = "Dialog";
