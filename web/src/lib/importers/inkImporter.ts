/**
 * Ink narrative script (.ink.json) importer.
 *
 * Parses the compiled Ink JSON format produced by `inklecate` and converts it
 * into the SpawnForge DialogueTree type.
 *
 * Ink JSON structure overview:
 *   {
 *     "inkVersion": 21,
 *     "root": [ ...content items..., { "#f": 5, "#n": "g-0" } ],
 *     "listDefs": {}
 *   }
 *
 * Content items can be:
 *   - string  — instruction codes (e.g. "^text", "ev", "/ev", "str", "/str",
 *               "end", "done", "\n") or variable references
 *   - number  — inline integer (divert target / literal)
 *   - null    — noop
 *   - object  — divert, choice, container, conditional, variable assignment,
 *               function call, glue, tag, etc.
 *   - array   — nested container
 *
 * This importer focuses on the common authoring patterns:
 *   - Text lines  (TextNode)
 *   - Choice sets (ChoiceNode / DialogueChoice)
 *   - Conditional branches (ConditionNode)
 *   - Divert tunnels / returns (EndNode)
 *   - Variable assignments (ActionNode with set_state)
 *
 * Ink is highly dynamic; constructs that have no clean mapping are represented
 * as TextNode stubs so the tree remains valid.
 */

import type {
  DialogueTree,
  DialogueNode,
  TextNode,
  ChoiceNode,
  ActionNode,
  ConditionNode,
  EndNode,
  DialogueChoice,
  Condition,
  DialogueAction,
} from '@/stores/dialogueStore';

// ---------------------------------------------------------------------------
// ID generation (deterministic within a parse run)
// ---------------------------------------------------------------------------

let _idCounter = 0;

function resetIdCounter(): void {
  _idCounter = 0;
}

function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${_idCounter}`;
}

// ---------------------------------------------------------------------------
// Ink JSON type definitions (structural, not exhaustive)
// ---------------------------------------------------------------------------

/** A raw Ink JSON content item. */
type InkItem = string | number | null | InkObject | InkItem[];

interface InkObject {
  '#f'?: number;
  '#n'?: string;
  '->'?: string;
  '*'?: string;
  flg?: number;
  'b'?: InkItem[][];
  'VAR='?: string;
  temp?: string;
  'VAR?'?: string;
  'CNT?'?: string;
  '#'?: string;
  f?: string;
  '<>'?: boolean;
  [key: string]: unknown;
}

/** Top-level Ink compiled JSON. */
interface InkJson {
  inkVersion?: number;
  root?: InkItem;
  listDefs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parse context
// ---------------------------------------------------------------------------

interface ParseContext {
  nodes: DialogueNode[];
  pendingText: string;
  lastNodeId: string | null;
}

function flushText(ctx: ParseContext): string | null {
  const text = ctx.pendingText.trim();
  ctx.pendingText = '';
  return text.length > 0 ? text : null;
}

function emitTextNode(ctx: ParseContext, text: string): TextNode {
  const id = nextId('ink_text');
  const node: TextNode = {
    id,
    type: 'text',
    speaker: 'Narrator',
    text,
    next: null,
    position: { x: 100 + ctx.nodes.length * 20, y: 100 + ctx.nodes.length * 80 },
  };
  if (ctx.lastNodeId !== null) {
    const prev = ctx.nodes.find(n => n.id === ctx.lastNodeId);
    if (prev && (prev.type === 'text' || prev.type === 'action')) {
      (prev as TextNode | ActionNode).next = id;
    }
  }
  ctx.nodes.push(node);
  ctx.lastNodeId = id;
  return node;
}

function emitEndNode(ctx: ParseContext): EndNode {
  const id = nextId('ink_end');
  const node: EndNode = {
    id,
    type: 'end',
    position: { x: 100 + ctx.nodes.length * 20, y: 100 + ctx.nodes.length * 80 },
  };
  if (ctx.lastNodeId !== null) {
    const prev = ctx.nodes.find(n => n.id === ctx.lastNodeId);
    if (prev && (prev.type === 'text' || prev.type === 'action')) {
      (prev as TextNode | ActionNode).next = id;
    }
  }
  ctx.nodes.push(node);
  ctx.lastNodeId = id;
  return node;
}

// ---------------------------------------------------------------------------
// Choice parsing helpers
// ---------------------------------------------------------------------------

const INK_CHOICE_FLAG_HAS_CONDITION = 0x01;
const INK_CHOICE_FLAG_IS_FALLBACK = 0x02;

function parseChoiceText(item: InkObject): string {
  const raw = item['*'];
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  return '(choice)';
}

function parseChoiceTarget(item: InkObject): string | null {
  if (typeof item['->'] === 'string') {
    return item['->'];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Condition parsing helpers
// ---------------------------------------------------------------------------

function tryParseConditionString(expr: string): Condition | null {
  const eqMatch = /^(\w+)\s*==\s*(.+)$/.exec(expr.trim());
  if (eqMatch) {
    return { type: 'equals', variable: eqMatch[1], value: parseValue(eqMatch[2].trim()) };
  }
  const neqMatch = /^(\w+)\s*!=\s*(.+)$/.exec(expr.trim());
  if (neqMatch) {
    return { type: 'not_equals', variable: neqMatch[1], value: parseValue(neqMatch[2].trim()) };
  }
  const gtMatch = /^(\w+)\s*>\s*(.+)$/.exec(expr.trim());
  if (gtMatch) {
    const val = parseValue(gtMatch[2].trim());
    if (typeof val === 'number') {
      return { type: 'greater', variable: gtMatch[1], value: val };
    }
  }
  const ltMatch = /^(\w+)\s*<\s*(.+)$/.exec(expr.trim());
  if (ltMatch) {
    const val = parseValue(ltMatch[2].trim());
    if (typeof val === 'number') {
      return { type: 'less', variable: ltMatch[1], value: val };
    }
  }
  const boolMatch = /^(\w+)$/.exec(expr.trim());
  if (boolMatch) {
    return { type: 'equals', variable: boolMatch[1], value: true };
  }
  return null;
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!isNaN(n)) return n;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Recursive container walker
// ---------------------------------------------------------------------------

function walkContainer(items: InkItem[], ctx: ParseContext): void {
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item === null || typeof item === 'number') {
      i++;
      continue;
    }

    if (typeof item === 'string') {
      i = handleStringItem(item, i, ctx);
      continue;
    }

    if (Array.isArray(item)) {
      const flushed = flushText(ctx);
      if (flushed) emitTextNode(ctx, flushed);
      walkContainer(item, ctx);
      i++;
      continue;
    }

    if (typeof item === 'object') {
      i = handleObjectItem(item as InkObject, i, ctx);
      continue;
    }

    i++;
  }

  const remaining = flushText(ctx);
  if (remaining) emitTextNode(ctx, remaining);
}

function handleStringItem(item: string, i: number, ctx: ParseContext): number {
  if (item.startsWith('^')) {
    const text = item.slice(1);
    if (text.length > 0) {
      ctx.pendingText += (ctx.pendingText.length > 0 ? ' ' : '') + text;
    }
    return i + 1;
  }

  if (item === '\n') {
    const flushed = flushText(ctx);
    if (flushed) emitTextNode(ctx, flushed);
    return i + 1;
  }

  if (item === 'end' || item === 'done') {
    const flushed = flushText(ctx);
    if (flushed) emitTextNode(ctx, flushed);
    emitEndNode(ctx);
    return i + 1;
  }

  // Runtime instruction codes: ev, /ev, str, /str, out, pop, nop, visit — skip
  return i + 1;
}

function handleObjectItem(item: InkObject, i: number, ctx: ParseContext): number {
  // Divert without choice marker
  if (typeof item['->'] === 'string' && !('*' in item)) {
    const target = item['->'];
    const flushed = flushText(ctx);
    if (flushed) emitTextNode(ctx, flushed);
    if (target === 'END' || target === 'DONE') {
      emitEndNode(ctx);
    } else {
      emitEndNode(ctx);
    }
    return i + 1;
  }

  if ('*' in item) {
    return handleChoiceObject(item, i, ctx);
  }

  if (Array.isArray(item['b'])) {
    return handleConditional(item, i, ctx);
  }

  if (typeof item['VAR='] === 'string' || typeof item['temp'] === 'string') {
    return handleVarAssign(item, i, ctx);
  }

  if (typeof item['#'] === 'string') {
    return i + 1;
  }

  if ('<>' in item) {
    return i + 1;
  }

  return i + 1;
}

function handleChoiceObject(item: InkObject, i: number, ctx: ParseContext): number {
  const flushed = flushText(ctx);
  if (flushed) emitTextNode(ctx, flushed);

  const flags = typeof item.flg === 'number' ? item.flg : 0;
  const isFallback = (flags & INK_CHOICE_FLAG_IS_FALLBACK) !== 0;
  const hasCondition = (flags & INK_CHOICE_FLAG_HAS_CONDITION) !== 0;

  if (isFallback) {
    return i + 1;
  }

  const choiceText = parseChoiceText(item);
  const target = parseChoiceTarget(item);

  let choiceNextId: string | null = null;
  if (target) {
    const branchEndId = nextId('ink_end');
    const branchEnd: EndNode = {
      id: branchEndId,
      type: 'end',
      position: { x: 100 + ctx.nodes.length * 20, y: 100 + ctx.nodes.length * 80 },
    };
    ctx.nodes.push(branchEnd);
    choiceNextId = branchEndId;
  }

  const choiceCondition = hasCondition
    ? (tryParseConditionString(String(item['VAR?'] ?? '')) ?? undefined)
    : undefined;

  const choice: DialogueChoice = {
    id: nextId('ink_choice'),
    text: choiceText,
    nextNodeId: choiceNextId,
    ...(choiceCondition !== undefined ? { condition: choiceCondition } : {}),
  };

  // Append to existing ChoiceNode if last node is already one
  if (ctx.lastNodeId !== null) {
    const prev = ctx.nodes.find(n => n.id === ctx.lastNodeId);
    if (prev && prev.type === 'choice') {
      (prev as ChoiceNode).choices.push(choice);
      return i + 1;
    }
  }

  const choiceNodeId = nextId('ink_choice_node');
  const choiceNode: ChoiceNode = {
    id: choiceNodeId,
    type: 'choice',
    choices: [choice],
    position: { x: 100 + ctx.nodes.length * 20, y: 100 + ctx.nodes.length * 80 },
  };

  if (ctx.lastNodeId !== null) {
    const prev = ctx.nodes.find(n => n.id === ctx.lastNodeId);
    if (prev && (prev.type === 'text' || prev.type === 'action')) {
      (prev as TextNode | ActionNode).next = choiceNodeId;
    }
  }

  ctx.nodes.push(choiceNode);
  ctx.lastNodeId = choiceNodeId;
  return i + 1;
}

function handleConditional(item: InkObject, i: number, ctx: ParseContext): number {
  const flushed = flushText(ctx);
  if (flushed) emitTextNode(ctx, flushed);

  const branches = item['b'] as InkItem[][];
  if (!branches || branches.length === 0) return i + 1;

  const condId = nextId('ink_cond');

  // Link previous node to this condition before pushing anything
  if (ctx.lastNodeId !== null) {
    const prev = ctx.nodes.find(n => n.id === ctx.lastNodeId);
    if (prev && (prev.type === 'text' || prev.type === 'action')) {
      (prev as TextNode | ActionNode).next = condId;
    }
  }

  // Push the condition node FIRST so it appears before branch nodes.
  // This ensures ctx.nodes[0] is the condition when a conditional starts the story.
  const condNode: ConditionNode = {
    id: condId,
    type: 'condition',
    condition: { type: 'equals', variable: '_ink_cond', value: true },
    onTrue: null,
    onFalse: null,
    position: { x: 100 + ctx.nodes.length * 20, y: 100 + ctx.nodes.length * 80 },
  };
  ctx.nodes.push(condNode);

  const trueCtx: ParseContext = { nodes: [], pendingText: '', lastNodeId: null };
  if (branches[0] && branches[0].length > 0) {
    walkContainer(branches[0], trueCtx);
  }
  if (trueCtx.nodes.length > 0) {
    condNode.onTrue = trueCtx.nodes[0].id;
    ctx.nodes.push(...trueCtx.nodes);
  }

  if (branches.length > 1 && branches[1].length > 0) {
    const falseCtx: ParseContext = { nodes: [], pendingText: '', lastNodeId: null };
    walkContainer(branches[1], falseCtx);
    if (falseCtx.nodes.length > 0) {
      condNode.onFalse = falseCtx.nodes[0].id;
      ctx.nodes.push(...falseCtx.nodes);
    }
  }

  ctx.lastNodeId = condId;
  return i + 1;
}

function handleVarAssign(item: InkObject, i: number, ctx: ParseContext): number {
  const varName = typeof item['VAR='] === 'string' ? item['VAR='] : (item['temp'] as string);
  const action: DialogueAction = { type: 'set_state', key: varName, value: null };

  const flushed = flushText(ctx);
  if (flushed) emitTextNode(ctx, flushed);

  const actionId = nextId('ink_action');
  const actionNode: ActionNode = {
    id: actionId,
    type: 'action',
    actions: [action],
    next: null,
    position: { x: 100 + ctx.nodes.length * 20, y: 100 + ctx.nodes.length * 80 },
  };

  if (ctx.lastNodeId !== null) {
    const prev = ctx.nodes.find(n => n.id === ctx.lastNodeId);
    if (prev && (prev.type === 'text' || prev.type === 'action')) {
      (prev as TextNode | ActionNode).next = actionId;
    }
  }

  ctx.nodes.push(actionNode);
  ctx.lastNodeId = actionId;
  return i + 1;
}

// ---------------------------------------------------------------------------
// Root container extraction
// ---------------------------------------------------------------------------

function extractRootContent(root: InkItem): InkItem[] {
  if (Array.isArray(root)) {
    return root;
  }
  if (root !== null && typeof root === 'object' && !Array.isArray(root)) {
    const obj = root as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key !== '#f' && key !== '#n' && Array.isArray(obj[key])) {
        return obj[key] as InkItem[];
      }
    }
    return [root];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a compiled Ink JSON (.ink.json) file and return a DialogueTree.
 *
 * Throws Error if the input is not a valid Ink JSON document.
 */
export function parseInkJson(json: unknown): DialogueTree {
  resetIdCounter();

  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Invalid Ink JSON: expected a top-level object');
  }

  const doc = json as InkJson;

  if ('inkVersion' in doc && typeof doc.inkVersion !== 'number') {
    throw new Error('Invalid Ink JSON: inkVersion must be a number');
  }

  if (!('root' in doc) || doc.root === undefined) {
    throw new Error('Invalid Ink JSON: missing root container');
  }

  const rootContent = extractRootContent(doc.root);

  const ctx: ParseContext = {
    nodes: [],
    pendingText: '',
    lastNodeId: null,
  };

  walkContainer(rootContent, ctx);

  if (ctx.nodes.length === 0) {
    const fallbackId = nextId('ink_end');
    const fallback: EndNode = { id: fallbackId, type: 'end' };
    ctx.nodes.push(fallback);
  }

  const lastNode = ctx.nodes[ctx.nodes.length - 1];
  if (lastNode.type !== 'end') {
    const endId = nextId('ink_end');
    const endNode: EndNode = { id: endId, type: 'end' };
    if (lastNode.type === 'text' || lastNode.type === 'action') {
      (lastNode as TextNode | ActionNode).next = endId;
    }
    ctx.nodes.push(endNode);
  }

  const treeId = nextId('ink_tree');
  const treeName = (doc as Record<string, unknown>)['#n'] as string | undefined ?? 'Ink Story';

  return {
    id: treeId,
    name: treeName,
    nodes: ctx.nodes,
    startNodeId: ctx.nodes[0].id,
    variables: {},
  };
}
