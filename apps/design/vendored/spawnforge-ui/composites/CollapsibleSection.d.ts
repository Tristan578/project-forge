import { type ReactNode } from 'react';
export interface CollapsibleSectionProps {
    title: string;
    children: ReactNode;
    defaultOpen?: boolean;
    headerRight?: ReactNode;
    className?: string;
}
export declare function CollapsibleSection({ title, children, defaultOpen, headerRight, className, }: CollapsibleSectionProps): import("react/jsx-runtime").JSX.Element;
