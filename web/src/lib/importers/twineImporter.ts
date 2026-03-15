/**
 * Twine/Twee3 importer — converts .twee content into a DialogueTree.
 *
 * Twee3 format:
 *   :: PassageName [optional tags]
 *   Body text until the next :: header
 *
 * Links:
 *   [[Target]]               — shorthand jump
 *   [[Display Text->Target]] — arrow syntax (Twee3 / SugarCube)
 *   [[Display Text|Target]]  — pipe syntax (Twee1 / Twine1)
 *
 * Macros parsed (best effort):
 *   (set: $var to value)     -> ActionNode (set_state)
 *   (if: $var is value)      -> ConditionNode
 *   (if: $var > value)       -> ConditionNode (greater)
 *   (if: $var < value)       -> ConditionNode (less)
 *   (if: $var is not value)  -> ConditionNode (not_equals)
 */

import type {
  DialogueTree,
  DialogueNode,
  TextNode,
  ChoiceNode,
  ConditionNode,
  ActionNode,
  EndNode,
  DialogueChoice,
  DialogueAction,
  Condition,
} from '@/stores/dialogueStore';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

function makeId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}_${_idCounter}_${Math.floor(Math.random() * 100000)}`;
}

// ---------------------------------------------------------------------------
// Passage splitting
// ---------------------------------------------------------------------------

interface RawPassage {
  name: string;
  tags: string[];
  body: string;
}

/**
 * Split .twee content into raw passages.
 * A passage header is `:: Name [optional tags] { optional metadata }` on its own line.
 */
function splitPassages(content: string): RawPassage[] {
  const passages: RawPassage[] = [];
  // Match :: followed by passage name, optional [tags], optional {metadata}, at start of line
  const headerPattern = /^:: ([^\[{]+?)(?:\s+\[([^\]]*)\])?(?:\s+\{[^}]*\})?\s*$/gm;

  const headers: Array<{ name: string; tags: string[]; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headerPattern.exec(content)) !== null) {
    headers.push({
      name: match[1].trim(),
      tags: match[2] ? match[2].split(/\s+/).filter(Boolean) : [],
      index: match.index + match[0].length,
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index;
    const end = i + 1 < headers.length
      ? content.lastIndexOf('\n', headers[i + 1].index - 1)
      : content.length;

    passages.push({
      name: headers[i].name,
      tags: headers[i].tags,
      body: content.slice(start, end).trim(),
    });
  }

  return passages;
}

// ---------------------------------------------------------------------------
// Link extraction helpers
// ---------------------------------------------------------------------------

interface ParsedLink {
  display: string;
  target: string;
}

/**
 * Extract all [[...]] links from a line of text.
 * Supports:
 *   [[Target]]
 *   [[Display->Target]]
 *   [[Display|Target]]
 */
function extractLinks(text: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;

  while ((m = linkPattern.exec(text)) !== null) {
    const inner = m[1];
    if (inner.includes('->')) {
      const sep = inner.indexOf('->');
      links.push({ display: inner.slice(0, sep).trim(), target: inner.slice(sep + 2).trim() });
    } else if (inner.includes('|')) {
      const sep = inner.indexOf('|');
      links.push({ display: inner.slice(0, sep).trim(), target: inner.slice(sep + 1).trim() });
    } else {
      links.push({ display: inner.trim(), target: inner.trim() });
    }
  }

  return links;
}

/** Remove all [[...]] link markup from a string. */
function stripLinks(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]/g, '').trim();
}

// ---------------------------------------------------------------------------
// Macro parsers
// ---------------------------------------------------------------------------

/**
 * Parse a `(set: $var to value)` macro into a set_state action.
 */
function parseSetMacro(macroBody: string): DialogueAction | null {
  // (set: $varName to value)
  const m = /\bset:\s*\$(\w+)\s+to\s+(.+)/i.exec(macroBody);
  if (!m) return null;

  const key = m[1];
  // Strip trailing ) and whitespace that bleeds in from the outer macro parentheses
  const rawValue = m[2].trim().replace(/\)+$/, '').trim();
  const value = parseScalarValue(rawValue);

  return { type: 'set_state', key, value };
}

/**
 * Parse a `(if: $var is value)` / `(if: $var > n)` / `(if: $var < n)` macro
 * into a Condition.
 */
function parseIfCondition(macroBody: string): Condition | null {
  // (if: $varName OPERATOR value)
  const m = /\bif:\s*\$(\w+)\s+(is\s+not|is|!=|==|>=|<=|>|<)\s+(.+)/i.exec(macroBody);
  if (!m) return null;

  const variable = m[1];
  const op = m[2].replace(/\s+/g, ' ').toLowerCase().trim();
  const rawValue = m[3].trim().replace(/[()]/g, '');
  const value = parseScalarValue(rawValue);

  switch (op) {
    case 'is':
    case '==':
      return { type: 'equals', variable, value };
    case 'is not':
    case '!=':
      return { type: 'not_equals', variable, value };
    case '>':
      return { type: 'greater', variable, value: value as number };
    case '<':
      return { type: 'less', variable, value: value as number };
    default:
      return { type: 'equals', variable, value };
  }
}

function parseScalarValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === 'none') return null;
  const num = Number(raw);
  if (!isNaN(num) && raw.length > 0) return num;
  // Strip surrounding quotes
  return raw.replace(/^["']|["']$/g, '');
}

// ---------------------------------------------------------------------------
// Passage to nodes
// ---------------------------------------------------------------------------

/**
 * Convert a single passage body into one or more DialogueNodes.
 * Returns the generated nodes and the ID of the first node in this passage.
 */
function passageToNodes(
  passageName: string,
  body: string,
  passageStartIds: Map<string, string>,
): { nodes: DialogueNode[]; firstId: string } {
  const nodes: DialogueNode[] = [];

  function makeEndNode(): EndNode {
    const n: EndNode = { id: makeId('end'), type: 'end' };
    nodes.push(n);
    return n;
  }

  const lines = body.split('\n');

  interface Block {
    kind: 'text' | 'choice' | 'action' | 'condition' | 'end';
    lines: string[];
  }

  const blocks: Block[] = [];
  let textBuf: string[] = [];

  const flushText = () => {
    if (textBuf.length > 0) {
      blocks.push({ kind: 'text', lines: [...textBuf] });
      textBuf = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      if (textBuf.length > 0) textBuf.push('');
      continue;
    }

    // Detect Twine macros: (macroName: ...)
    const macroMatch = /^\((\w+):/i.exec(trimmed);
    if (macroMatch) {
      flushText();
      const macroName = macroMatch[1].toLowerCase();
      if (macroName === 'set') {
        blocks.push({ kind: 'action', lines: [trimmed] });
      } else if (macroName === 'if') {
        blocks.push({ kind: 'condition', lines: [trimmed] });
      } else {
        blocks.push({ kind: 'action', lines: [trimmed] });
      }
      continue;
    }

    // Detect a standalone [[link-only]] line
    const stripped = stripLinks(trimmed);
    const links = extractLinks(trimmed);

    if (links.length > 0 && stripped === '') {
      flushText();
      // Merge consecutive link-only lines into one choice block
      const last = blocks[blocks.length - 1];
      if (last && last.kind === 'choice') {
        last.lines.push(trimmed);
      } else {
        blocks.push({ kind: 'choice', lines: [trimmed] });
      }
      continue;
    }

    textBuf.push(trimmed);
  }

  flushText();

  if (blocks.length === 0) {
    const end = makeEndNode();
    return { nodes, firstId: end.id };
  }

  const generatedIds: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'text': {
        const lineTexts = block.lines.filter(l => l.trim() !== '');
        if (lineTexts.length === 0) break;

        for (const lt of lineTexts) {
          const inlineLinks = extractLinks(lt);
          if (inlineLinks.length > 0) {
            const promptText = stripLinks(lt).trim();
            const choiceId = makeId('choice');
            const choices: DialogueChoice[] = inlineLinks.map(link => ({
              id: makeId('ch'),
              text: link.display,
              nextNodeId: passageStartIds.get(link.target) ?? link.target,
            }));
            const choiceNode: ChoiceNode = {
              id: choiceId,
              type: 'choice',
              text: promptText || undefined,
              choices,
            };
            nodes.push(choiceNode);
            generatedIds.push(choiceId);
          } else {
            const textId = makeId('text');
            const textNode: TextNode = {
              id: textId,
              type: 'text',
              speaker: 'Narrator',
              text: lt,
              next: null,
            };
            nodes.push(textNode);
            generatedIds.push(textId);
          }
        }
        break;
      }

      case 'choice': {
        const allLinks: ParsedLink[] = [];
        for (const l of block.lines) {
          allLinks.push(...extractLinks(l));
        }
        if (allLinks.length === 0) break;

        const choiceId = makeId('choice');
        const choices: DialogueChoice[] = allLinks.map(link => ({
          id: makeId('ch'),
          text: link.display,
          nextNodeId: passageStartIds.get(link.target) ?? link.target,
        }));
        const choiceNode: ChoiceNode = {
          id: choiceId,
          type: 'choice',
          choices,
        };
        nodes.push(choiceNode);
        generatedIds.push(choiceId);
        break;
      }

      case 'action': {
        const macroText = block.lines[0];
        const setAction = parseSetMacro(macroText);
        const actions: DialogueAction[] = setAction
          ? [setAction]
          : [{ type: 'trigger_event', eventName: macroText.replace(/[()]/g, '').toLowerCase() }];

        const actionId = makeId('action');
        const actionNode: ActionNode = {
          id: actionId,
          type: 'action',
          actions,
          next: null,
        };
        nodes.push(actionNode);
        generatedIds.push(actionId);
        break;
      }

      case 'condition': {
        const macroText = block.lines[0];
        const condition = parseIfCondition(macroText) ?? {
          type: 'equals' as const,
          variable: 'unknown',
          value: true,
        };

        const condId = makeId('cond');
        const condNode: ConditionNode = {
          id: condId,
          type: 'condition',
          condition,
          onTrue: null,
          onFalse: null,
        };
        nodes.push(condNode);
        generatedIds.push(condId);
        break;
      }

      case 'end': {
        const end = makeEndNode();
        generatedIds.push(end.id);
        break;
      }
    }
  }

  if (generatedIds.length === 0) {
    const end = makeEndNode();
    return { nodes, firstId: end.id };
  }

  // Wire up the chain
  for (let i = 0; i < generatedIds.length - 1; i++) {
    const curr = nodes.find(n => n.id === generatedIds[i]);
    const nextId = generatedIds[i + 1];
    if (curr && curr.type === 'text') {
      (curr as TextNode).next = nextId;
    } else if (curr && curr.type === 'action') {
      (curr as ActionNode).next = nextId;
    }
  }

  // Ensure last node ends with EndNode if text or action
  const lastId = generatedIds[generatedIds.length - 1];
  const lastNode = nodes.find(n => n.id === lastId);
  if (lastNode && (lastNode.type === 'text' || lastNode.type === 'action')) {
    const end = makeEndNode();
    if (lastNode.type === 'text') {
      (lastNode as TextNode).next = end.id;
    } else {
      (lastNode as ActionNode).next = end.id;
    }
  }

  passageStartIds.set(passageName, generatedIds[0]);

  return { nodes, firstId: generatedIds[0] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Twee3 file into a `DialogueTree`.
 *
 * - Each passage becomes a group of nodes.
 * - The start node is the first passage or the one tagged `startup`.
 * - Links ([[Display->Target]], [[Target]]) are wired between nodes.
 *
 * @throws {Error} When no valid passages are found.
 */
export function parseTweeFile(content: string): DialogueTree {
  if (!content || content.trim() === '') {
    throw new Error('No valid Twee passages found in input');
  }

  const passages = splitPassages(content);
  if (passages.length === 0) {
    throw new Error('No valid Twee passages found in input');
  }

  // Phase 1: pre-scan passage names to reserve stable first-node IDs
  const passageStartIds = new Map<string, string>();
  for (const p of passages) {
    passageStartIds.set(p.name, makeId('text'));
  }

  // Phase 2: convert each passage to nodes
  const allNodes: DialogueNode[] = [];
  const passageFirstIds = new Map<string, string>();

  for (const p of passages) {
    const reservedId = passageStartIds.get(p.name)!;
    const { nodes, firstId } = passageToNodes(p.name, p.body, passageStartIds);

    // Remap reserved ID to actual first node ID
    if (firstId !== reservedId && nodes.length > 0) {
      const firstNode = nodes.find(n => n.id === firstId);
      if (firstNode) {
        firstNode.id = reservedId;
        // Fix intra-passage references
        for (const n of nodes) {
          if (n.type === 'text' && n.next === firstId) n.next = reservedId;
          if (n.type === 'action' && n.next === firstId) n.next = reservedId;
          if (n.type === 'choice') {
            for (const c of n.choices) {
              if (c.nextNodeId === firstId) c.nextNodeId = reservedId;
            }
          }
          if (n.type === 'condition') {
            if (n.onTrue === firstId) n.onTrue = reservedId;
            if (n.onFalse === firstId) n.onFalse = reservedId;
          }
        }
      }
      passageStartIds.set(p.name, reservedId);
    }

    passageFirstIds.set(p.name, passageStartIds.get(p.name)!);
    allNodes.push(...nodes);
  }

  // Phase 3: second-pass link resolution for choice nodes
  for (const node of allNodes) {
    if (node.type === 'choice') {
      for (const choice of node.choices) {
        if (choice.nextNodeId === null) continue;
        const resolved = passageStartIds.get(choice.nextNodeId);
        if (resolved) choice.nextNodeId = resolved;
      }
    }
  }

  // Phase 4: determine start node
  const startPassage = passages.find(p => p.tags.includes('startup')) ?? passages[0];
  const startNodeId = passageFirstIds.get(startPassage.name) ?? allNodes[0].id;

  const treeId = makeId('tree');
  const treeName = startPassage.name;

  return {
    id: treeId,
    name: treeName,
    nodes: allNodes,
    startNodeId,
    variables: {},
  };
}
