import { type ImgHTMLAttributes } from 'react';
export interface AvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
    src?: string;
    alt?: string;
    name?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}
export declare function Avatar({ className, src, alt, name, size, ...props }: AvatarProps): import("react/jsx-runtime").JSX.Element;
