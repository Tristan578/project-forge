import { type ReactNode } from 'react';
export interface AccordionItem {
    id: string;
    title: string;
    content: ReactNode;
}
export interface AccordionProps {
    items: AccordionItem[];
    defaultOpen?: string;
    className?: string;
}
export declare function Accordion({ items, defaultOpen, className }: AccordionProps): import("react/jsx-runtime").JSX.Element;
