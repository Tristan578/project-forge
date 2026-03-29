import { type HTMLAttributes } from 'react';
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
    width?: string;
    height?: string;
}
export declare function Skeleton({ className, width, height, style, ...props }: SkeletonProps): import("react/jsx-runtime").JSX.Element;
