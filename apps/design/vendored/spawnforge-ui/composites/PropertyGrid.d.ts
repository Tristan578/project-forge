import { type ReactNode } from 'react';
export interface PropertyGridItem {
    label: string;
    value: ReactNode;
    id?: string;
}
export interface PropertyGridProps {
    items: PropertyGridItem[];
    labelWidth?: string;
    className?: string;
}
export declare function PropertyGrid({ items, labelWidth, className, }: PropertyGridProps): import("react/jsx-runtime").JSX.Element;
