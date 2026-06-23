import { type ReactNode } from 'react';
export interface TreeNode {
    id: string;
    label: string;
    children?: TreeNode[];
    icon?: ReactNode;
}
export interface TreeViewProps {
    nodes: TreeNode[];
    selectedId?: string;
    onSelect?: (id: string) => void;
    expandedIds?: string[];
    onToggleExpand?: (id: string) => void;
    className?: string;
}
export declare function TreeView({ nodes, selectedId, onSelect, expandedIds: controlledExpandedIds, onToggleExpand: controlledOnToggle, className, }: TreeViewProps): import("react/jsx-runtime").JSX.Element;
