import { type HTMLAttributes, type ReactNode } from 'react';
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    title?: string;
    footer?: ReactNode;
}
export declare function Card({ className, title, footer, children, ...props }: CardProps): import("react/jsx-runtime").JSX.Element;
