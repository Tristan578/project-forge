'use client';

import { useState, useCallback } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronRight, MessageSquare,
  GitBranch, Zap, CircleStop, ArrowRight, Copy,
} from 'lucide-react';
import {
  useDialogueStore,
  type DialogueTree,
  type DialogueNode,
  type TextNode,
  type ChoiceNode,
  type ConditionNode,
  type ActionNode,
} from '@/stores/dialogueStore';

// ---- Tree Selector ----

function TreeSelector() {
  const dialogueTrees = useDialogueStore((s) => s.dialogueTrees);
  const selectedTreeId = useDialogueStore((s) => s.selectedTreeId);
  const selectTree = useDialogueStore((s) => s.selectTree);
  const addTree = useDialogueStore((s) => s.addTree);
  const removeTree = useDialogueStore((s) => s.removeTree);
  const duplicateTree = useDialogueStore((s) => s.duplicateTree);

  const trees = Object.values(dialogueTrees);

  const handleCreate = useCallback(() => {
    const id = addTree('New Dialogue');
    selectTree(id);
  }, [addTree, selectTree]);

  return (
    <div className="mb-3 flex items-center gap-2">
      <select
        value={selectedTreeId ?? ''}
        onChange={(e) => selectTree(e.target.value || null)}
        className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
      >
        <option value="">-- Select Tree --</option>
        {trees.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <button onClick={handleCreate} className="rounded bg-blue-600 p-1 text-white hover:bg-blue-500" title="New Tree">
        <Plus size={14} />
      </button>
      {selectedTreeId && (
        <>
          <button onClick={() => duplicateTree(selectedTreeId)} className="rounded bg-zinc-700 p-1 text-zinc-300 hover:bg-zinc-600" title="Duplicate">
            <Copy size={14} />
          </button>
          <button
            onClick={() => { removeTree(selectedTreeId); selectTree(null); }}
            className="rounded bg-zinc-700 p-1 text-red-400 hover:bg-red-900/30"
            title="Delete Tree"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

// ---- Tree Name Editor ----

function TreeNameEditor({ tree }: { tree: DialogueTree }) {
  const updateTree = useDialogueStore((s) => s.updateTree);
  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs text-zinc-500">Tree Name</label>
      <input
        type="text"
        value={tree.name}
        onChange={(e) => updateTree(tree.id, { name: e.target.value })}
        className="w-full rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 border border-zinc-700"
      />
    </div>
  );
}

// ---- Node Type Icon ----

function NodeTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'text': return <MessageSquare size={12} className="text-blue-400" />;
    case 'choice': return <GitBranch size={12} className="text-yellow-400" />;
    case 'condition': return <Zap size={12} className="text-purple-400" />;
    case 'action': return <ArrowRight size={12} className="text-green-400" />;
    case 'end': return <CircleStop size={12} className="text-red-400" />;
    default: return null;
  }
}

// ---- Node Item ----

interface NodeItemProps {
  node: DialogueNode;
  treeId: string;
  tree: DialogueTree;
  isSelected: boolean;
  isStartNode: boolean;
  onSelect: () => void;
}

function NodeItem({ node, treeId, tree, isSelected, isStartNode, onSelect }: NodeItemProps) {
  const [expanded, setExpanded] = useState(false);
  const updateNode = useDialogueStore((s) => s.updateNode);
  const removeNode = useDialogueStore((s) => s.removeNode);
  const updateTree = useDialogueStore((s) => s.updateTree);

  const nodeLabel = (() => {
    switch (node.type) {
      case 'text': return `"${(node as TextNode).text.slice(0, 40) || '(empty)'}${(node as TextNode).text.length > 40 ? '...' : ''}"`;
      case 'choice': return `${(node as ChoiceNode).choices.length} choices`;
      case 'condition': return 'Condition';
      case 'action': return `${(node as ActionNode).actions.length} actions`;
      case 'end': return 'End';
      default: return 'Unknown';
    }
  })();

  // Available nodes for "next" dropdowns
  const nodeOptions = tree.nodes.filter((n) => n.id !== node.id);

  return (
    <div className={`rounded border ${isSelected ? 'border-blue-500/50 bg-zinc-800/80' : 'border-zinc-700/50 bg-zinc-800/30'}`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer" onClick={onSelect}>
        <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="text-zinc-500 hover:text-zinc-300">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <NodeTypeIcon type={node.type} />
        <span className="flex-1 truncate text-xs text-zinc-300">{nodeLabel}</span>
        {isStartNode && <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-[9px] text-green-400">START</span>}
        <button
          onClick={(e) => { e.stopPropagation(); removeNode(treeId, node.id); }}
          className="rounded p-0.5 text-zinc-600 hover:text-red-400"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-zinc-700/50 px-2 py-2 space-y-2">
          {/* Set as start node */}
          {!isStartNode && (
            <button
              onClick={() => updateTree(treeId, { startNodeId: node.id } as Partial<DialogueTree>)}
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              Set as Start Node
            </button>
          )}

          {/* Text node fields */}
          {node.type === 'text' && (
            <>
              <div>
                <label className="block text-[10px] text-zinc-500">Speaker</label>
                <input
                  type="text"
                  value={(node as TextNode).speaker}
                  onChange={(e) => updateNode(treeId, node.id, { speaker: e.target.value })}
                  className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500">Text</label>
                <textarea
                  value={(node as TextNode).text}
                  onChange={(e) => updateNode(treeId, node.id, { text: e.target.value })}
                  rows={3}
                  className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700 resize-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500">Next Node</label>
                <select
                  value={(node as TextNode).next ?? ''}
                  onChange={(e) => updateNode(treeId, node.id, { next: e.target.value || null })}
                  className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                >
                  <option value="">(End)</option>
                  {nodeOptions.map((n) => (
                    <option key={n.id} value={n.id}>{n.type}: {n.id.slice(0, 12)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Choice node fields */}
          {node.type === 'choice' && (
            <>
              <div>
                <label className="block text-[10px] text-zinc-500">Prompt Text (optional)</label>
                <input
                  type="text"
                  value={(node as ChoiceNode).text ?? ''}
                  onChange={(e) => updateNode(treeId, node.id, { text: e.target.value })}
                  className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-zinc-500">Choices</label>
                  <button
                    onClick={() => {
                      const choices = [...(node as ChoiceNode).choices, {
                        id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        text: 'New choice',
                        nextNodeId: null,
                      }];
                      updateNode(treeId, node.id, { choices });
                    }}
                    className="text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    + Add Choice
                  </button>
                </div>
                {(node as ChoiceNode).choices.map((ch, idx) => (
                  <div key={ch.id} className="flex items-center gap-1">
                    <span className="text-[10px] text-zinc-600 w-4">{idx + 1}.</span>
                    <input
                      type="text"
                      value={ch.text}
                      onChange={(e) => {
                        const choices = [...(node as ChoiceNode).choices];
                        choices[idx] = { ...choices[idx], text: e.target.value };
                        updateNode(treeId, node.id, { choices });
                      }}
                      className="flex-1 rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 border border-zinc-700"
                    />
                    <select
                      value={ch.nextNodeId ?? ''}
                      onChange={(e) => {
                        const choices = [...(node as ChoiceNode).choices];
                        choices[idx] = { ...choices[idx], nextNodeId: e.target.value || null };
                        updateNode(treeId, node.id, { choices });
                      }}
                      className="w-24 rounded bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-400 border border-zinc-700"
                    >
                      <option value="">(End)</option>
                      {nodeOptions.map((n) => (
                        <option key={n.id} value={n.id}>{n.id.slice(0, 10)}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const choices = (node as ChoiceNode).choices.filter((_, i) => i !== idx);
                        updateNode(treeId, node.id, { choices });
                      }}
                      className="text-zinc-600 hover:text-red-400"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Condition node fields */}
          {node.type === 'condition' && (
            <>
              <div>
                <label className="block text-[10px] text-zinc-500">Variable</label>
                <input
                  type="text"
                  value={
                    (node as ConditionNode).condition.type === 'equals' || (node as ConditionNode).condition.type === 'not_equals' ||
                    (node as ConditionNode).condition.type === 'greater' || (node as ConditionNode).condition.type === 'less'
                      ? ((node as ConditionNode).condition as { variable: string }).variable
                      : ''
                  }
                  onChange={(e) => {
                    const cond = { ...(node as ConditionNode).condition };
                    if ('variable' in cond) {
                      (cond as { variable: string }).variable = e.target.value;
                    }
                    updateNode(treeId, node.id, { condition: cond });
                  }}
                  className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] text-zinc-500">If True → Node</label>
                  <select
                    value={(node as ConditionNode).onTrue ?? ''}
                    onChange={(e) => updateNode(treeId, node.id, { onTrue: e.target.value || null })}
                    className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                  >
                    <option value="">(End)</option>
                    {nodeOptions.map((n) => (<option key={n.id} value={n.id}>{n.id.slice(0, 10)}</option>))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] text-zinc-500">If False → Node</label>
                  <select
                    value={(node as ConditionNode).onFalse ?? ''}
                    onChange={(e) => updateNode(treeId, node.id, { onFalse: e.target.value || null })}
                    className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                  >
                    <option value="">(End)</option>
                    {nodeOptions.map((n) => (<option key={n.id} value={n.id}>{n.id.slice(0, 10)}</option>))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Action node fields */}
          {node.type === 'action' && (
            <>
              <div>
                <label className="block text-[10px] text-zinc-500">Next Node</label>
                <select
                  value={(node as ActionNode).next ?? ''}
                  onChange={(e) => updateNode(treeId, node.id, { next: e.target.value || null })}
                  className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-300 border border-zinc-700"
                >
                  <option value="">(End)</option>
                  {nodeOptions.map((n) => (<option key={n.id} value={n.id}>{n.id.slice(0, 10)}</option>))}
                </select>
              </div>
              <div className="text-[10px] text-zinc-500">
                {(node as ActionNode).actions.length} actions configured
              </div>
            </>
          )}

          {/* End node — no fields */}
          {node.type === 'end' && (
            <div className="text-[10px] text-zinc-500 italic">This node ends the dialogue.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Add Node Menu ----

function AddNodeMenu({ treeId }: { treeId: string }) {
  const [open, setOpen] = useState(false);
  const addNode = useDialogueStore((s) => s.addNode);
  const selectNode = useDialogueStore((s) => s.selectNode);

  const handleAdd = useCallback((type: DialogueNode['type']) => {
    const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let node: DialogueNode;
    switch (type) {
      case 'text':
        node = { id, type: 'text', speaker: 'NPC', text: '', next: null };
        break;
      case 'choice':
        node = { id, type: 'choice', choices: [] };
        break;
      case 'condition':
        node = { id, type: 'condition', condition: { type: 'equals', variable: '', value: true }, onTrue: null, onFalse: null };
        break;
      case 'action':
        node = { id, type: 'action', actions: [], next: null };
        break;
      case 'end':
        node = { id, type: 'end' };
        break;
    }
    addNode(treeId, node);
    selectNode(id);
    setOpen(false);
  }, [treeId, addNode, selectNode]);

  return (
    <div className="relative mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
      >
        <Plus size={12} /> Add Node
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {(['text', 'choice', 'condition', 'action', 'end'] as const).map((type) => (
            <button
              key={type}
              onClick={() => handleAdd(type)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <NodeTypeIcon type={type} />
              <span className="capitalize">{type} Node</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main Component ----

export function DialogueTreeEditor() {
  const dialogueTrees = useDialogueStore((s) => s.dialogueTrees);
  const selectedTreeId = useDialogueStore((s) => s.selectedTreeId);
  const selectedNodeId = useDialogueStore((s) => s.selectedNodeId);
  const selectNode = useDialogueStore((s) => s.selectNode);
  const loadFromLocalStorage = useDialogueStore((s) => s.loadFromLocalStorage);

  // Load on mount
  useState(() => { loadFromLocalStorage(); });

  const tree = selectedTreeId ? dialogueTrees[selectedTreeId] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zinc-800 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Dialogue Editor</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <TreeSelector />

        {tree ? (
          <>
            <TreeNameEditor tree={tree} />

            <div className="mb-2 text-[10px] text-zinc-500">
              {tree.nodes.length} nodes · Start: {tree.startNodeId.slice(0, 10)}
            </div>

            <div className="space-y-1.5">
              {tree.nodes.map((node) => (
                <NodeItem
                  key={node.id}
                  node={node}
                  treeId={tree.id}
                  tree={tree}
                  isSelected={selectedNodeId === node.id}
                  isStartNode={tree.startNodeId === node.id}
                  onSelect={() => selectNode(node.id)}
                />
              ))}
            </div>

            <AddNodeMenu treeId={tree.id} />
          </>
        ) : (
          <div className="mt-8 text-center text-xs text-zinc-500">
            <MessageSquare size={32} className="mx-auto mb-2 text-zinc-700" />
            <p>Select or create a dialogue tree</p>
            <p className="mt-1 text-zinc-600">Trees define branching conversations for NPCs</p>
          </div>
        )}
      </div>
    </div>
  );
}
