/**
 * Yarn Spinner (.yarn) file importer.
 *
 * Parses Yarn Spinner v2 format and converts it into the SpawnForge DialogueTree
 * type. The mapping is intentionally lossy in some edge cases (e.g. inline
 * expression interpolation is kept as literal text) but covers the common
 * authoring patterns: text lines, choices, conditionals, commands, jumps and
 * stops.
 *
 * Yarn node lifecycle:
 *   <header lines>
 *   ---              <- end of header
 *   <body lines>
 *   ===              <- end of node
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
} from '@/stores/dialogueStore';

// ---------------------------------------------------------------------------
// ID generation (deterministic within a parse run, not globally unique)
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
// Internal Yarn AST (intermediate representation)
// ---------------------------------------------------------------------------

type YarnLine =
  | { kind: 'text'; text: string }
  | { kind: 'option'; text: string; target: string | null }
  | { kind: 'jump'; target: string }
  | { kind: 'stop' }
  | { kind: 'if'; condition: string }
  | { kind: 'elseif'; condition: string }
  | { kind: 'else' }
  | { kind: 'endif' }
  | { kind: 'command'; command: string; args: string };

interface YarnNode {
  title: string;
  tags: string[];
  lines: YarnLine[];
}

// ---------------------------------------------------------------------------
// Yarn file tokeniser
// ---------------------------------------------------------------------------

function tokeniseYarnFile(content: string): YarnNode[] {
  const nodes: YarnNode[] = [];
  // Normalise line endings
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;

  while (i < lines.length) {
    // Skip blank lines between nodes
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed === '===') {
      i++;
      continue;
    }

    // Collect header lines until ---
    const headerLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '---') {
      headerLines.push(lines[i]);
      i++;
    }
    i++; // skip the ---

    // Parse header
    let title = '';
    const tags: string[] = [];
    for (const hLine of headerLines) {
      const colonIdx = hLine.indexOf(':');
      if (colonIdx === -1) continue;
      const key = hLine.slice(0, colonIdx).trim().toLowerCase();
      const value = hLine.slice(colonIdx + 1).trim();
      if (key === 'title') {
        title = value;
      } else if (key === 'tags') {
        tags.push(...value.split(/\s+/).filter(Boolean));
      }
    }

    if (!title) {
      // Skip malformed nodes with no title
      while (i < lines.length && lines[i].trim() !== '===') {
        i++;
      }
      continue;
    }

    // Collect body lines until ===
    const bodyLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '===') {
      bodyLines.push(lines[i]);
      i++;
    }
    i++; // skip the ===

    nodes.push({ title, tags, lines: parseBodyLines(bodyLines) });
  }

  return nodes;
}

// Regex patterns for Yarn syntax elements
const OPTION_RE = /^->\s*(.*)/;
const OPTION_LINK_RE = /^(.*?)\[\[([^\]]+)\]\]\s*$/;
const COMMAND_RE = /^<<\s*(\w+)(?:\s+(.*?))?\s*>>$/;
const JUMP_INLINE_RE = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/;

function parseBodyLines(lines: string[]): YarnLine[] {
  const result: YarnLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    // Check for inline [[Target]] jump syntax (old Yarn v1 style)
    const jumpMatch = JUMP_INLINE_RE.exec(line);
    if (jumpMatch) {
      // [[NodeName]] or [[Display|NodeName]]
      const target = jumpMatch[2] ?? jumpMatch[1];
      result.push({ kind: 'jump', target: target.trim() });
      continue;
    }

    // Option line: -> text [[Target]] or -> text
    const optionMatch = OPTION_RE.exec(line);
    if (optionMatch) {
      const optionBody = optionMatch[1].trim();
      const linkMatch = OPTION_LINK_RE.exec(optionBody);
      if (linkMatch) {
        // linkMatch[2] may be "DisplayText|TargetNode" (v1) or just "TargetNode" (v2)
        const linkContent = linkMatch[2].trim();
        const pipeIdx = linkContent.indexOf('|');
        const target = pipeIdx !== -1 ? linkContent.slice(pipeIdx + 1).trim() : linkContent;
        result.push({ kind: 'option', text: linkMatch[1].trim(), target });
      } else {
        result.push({ kind: 'option', text: optionBody, target: null });
      }
      continue;
    }

    // Command / control flow: <<...>>
    const cmdMatch = COMMAND_RE.exec(line);
    if (cmdMatch) {
      const cmd = cmdMatch[1].toLowerCase();
      const args = (cmdMatch[2] ?? '').trim();
      switch (cmd) {
        case 'jump':
          result.push({ kind: 'jump', target: args });
          break;
        case 'stop':
          result.push({ kind: 'stop' });
          break;
        case 'if':
          result.push({ kind: 'if', condition: args });
          break;
        case 'elseif':
          result.push({ kind: 'elseif', condition: args });
          break;
        case 'else':
          result.push({ kind: 'else' });
          break;
        case 'endif':
          result.push({ kind: 'endif' });
          break;
        default:
          result.push({ kind: 'command', command: cmd, args });
      }
      continue;
    }

    // Plain text line
    result.push({ kind: 'text', text: line });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Converter: YarnNode[] => DialogueTree
// ---------------------------------------------------------------------------

/**
 * Parse a Yarn Spinner (.yarn) file and return a SpawnForge DialogueTree.
 *
 * @param content - Raw string contents of the .yarn file.
 * @returns A DialogueTree ready to insert into the dialogue store.
 * @throws {Error} if the file contains no valid Yarn nodes.
 */
export function parseYarnFile(content: string): DialogueTree {
  resetIdCounter();

  const yarnNodes = tokeniseYarnFile(content);

  if (yarnNodes.length === 0) {
    throw new Error('No valid Yarn nodes found in the provided content.');
  }

  // We convert each Yarn "node" (titled block) into a sub-graph of
  // SpawnForge DialogueNodes, then stitch them together.
  //
  // Strategy:
  //   - Each Yarn node gets a dedicated "entry" TextNode (or ChoiceNode)
  //     identified by the Yarn node title.
  //   - <<jump NodeName>> resolves to the entry node ID of "NodeName".
  //   - Options map to ChoiceNode choices pointing at target entry node IDs.

  const treeId = nextId('tree');
  const allNodes: DialogueNode[] = [];

  // Map from Yarn node title => first DialogueNode id produced for that Yarn node.
  const entryNodeByTitle = new Map<string, string>();

  // Collect pending patches: functions applied after all nodes are built
  type Patch = (entryMap: Map<string, string>) => void;
  const patches: Patch[] = [];

  for (const yarnNode of yarnNodes) {
    const entryId = convertYarnNode(yarnNode, allNodes, patches);
    entryNodeByTitle.set(yarnNode.title, entryId);
  }

  // Apply patches now that all entry IDs are known
  for (const patch of patches) {
    patch(entryNodeByTitle);
  }

  const startNodeId = entryNodeByTitle.get(yarnNodes[0].title)!;

  return {
    id: treeId,
    name: yarnNodes[0].title,
    nodes: allNodes,
    startNodeId,
    variables: {},
  };
}

// ---------------------------------------------------------------------------
// Per-Yarn-node conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single Yarn node's lines into one or more SpawnForge
 * DialogueNodes appended to `out`. Returns the id of the first node created
 * (the "entry" for this Yarn node).
 */
function convertYarnNode(
  yarnNode: YarnNode,
  out: DialogueNode[],
  patches: Array<(m: Map<string, string>) => void>,
): string {
  const lines = yarnNode.lines;

  if (lines.length === 0) {
    // Empty node => single EndNode
    const endNode: EndNode = { id: nextId('node'), type: 'end' };
    out.push(endNode);
    return endNode.id;
  }

  // Separate lines into segments: "sequential" (text/commands) or "choices"
  type Segment =
    | { kind: 'sequential'; items: YarnLine[] }
    | { kind: 'choices'; items: Array<{ kind: 'option'; text: string; target: string | null }> };

  const segments: Segment[] = [];
  let currentSeq: YarnLine[] | null = null;

  for (const line of lines) {
    if (line.kind === 'option') {
      if (currentSeq) {
        segments.push({ kind: 'sequential', items: currentSeq });
        currentSeq = null;
      }
      const last = segments[segments.length - 1];
      if (last && last.kind === 'choices') {
        last.items.push(line);
      } else {
        segments.push({ kind: 'choices', items: [line] });
      }
    } else {
      if (!currentSeq) currentSeq = [];
      currentSeq.push(line);
    }
  }
  if (currentSeq) {
    segments.push({ kind: 'sequential', items: currentSeq });
  }

  // Build a chain of SpawnForge nodes for this Yarn node
  const nodeChain: DialogueNode[] = [];

  for (const segment of segments) {
    if (segment.kind === 'sequential') {
      convertSequentialSegment(segment.items, nodeChain, patches);
    } else {
      convertChoiceSegment(segment.items, nodeChain, patches);
    }
  }

  if (nodeChain.length === 0) {
    const endNode: EndNode = { id: nextId('node'), type: 'end' };
    out.push(endNode);
    return endNode.id;
  }

  // Link the chain: each node points to the next
  linkChain(nodeChain);

  // Append all nodes to output
  for (const n of nodeChain) {
    out.push(n);
  }

  return nodeChain[0].id;
}

// ---------------------------------------------------------------------------
// Sequential segment (text lines, commands, jumps, stops)
// ---------------------------------------------------------------------------

function convertSequentialSegment(
  items: YarnLine[],
  chain: DialogueNode[],
  patches: Array<(m: Map<string, string>) => void>,
): void {
  let i = 0;
  while (i < items.length) {
    const item = items[i];

    switch (item.kind) {
      case 'text': {
        const node: TextNode = {
          id: nextId('node'),
          type: 'text',
          speaker: '',
          text: item.text,
          next: null,
        };
        chain.push(node);
        i++;
        break;
      }

      case 'command': {
        // Merge consecutive commands into a single ActionNode
        const last = chain[chain.length - 1];
        if (last && last.type === 'action') {
          last.actions.push({
            type: 'trigger_event',
            eventName: item.args ? `${item.command} ${item.args}` : item.command,
          });
        } else {
          const node: ActionNode = {
            id: nextId('node'),
            type: 'action',
            actions: [
              {
                type: 'trigger_event',
                eventName: item.args ? `${item.command} ${item.args}` : item.command,
              },
            ],
            next: null,
          };
          chain.push(node);
        }
        i++;
        break;
      }

      case 'jump': {
        const target = item.target;

        // Empty jump target => treat as EndNode
        if (!target) {
          const endNode: EndNode = { id: nextId('node'), type: 'end' };
          chain.push(endNode);
          return;
        }

        // A jump ends the current segment; add a transparent carrier node.
        const jumpCarrier: TextNode = {
          id: nextId('node'),
          type: 'text',
          speaker: '',
          text: '',
          next: null,
        };
        chain.push(jumpCarrier);

        patches.push((entryMap) => {
          const resolved = entryMap.get(target);
          if (resolved) jumpCarrier.next = resolved;
        });
        return; // jump ends the segment
      }

      case 'stop': {
        const endNode: EndNode = { id: nextId('node'), type: 'end' };
        chain.push(endNode);
        return; // stop ends the segment
      }

      case 'if': {
        // Collect the entire if/elseif/else/endif block and convert it
        // into a chain of ConditionNodes with proper onTrue/onFalse wiring.
        i = convertIfBlock(items, i, chain, patches);
        break;
      }

      // Stray elseif/else/endif outside an if-block — skip gracefully
      case 'elseif':
      case 'else':
      case 'endif':
        i++;
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// If / elseif / else / endif block converter
// ---------------------------------------------------------------------------

/**
 * Collect lines from an <<if>> through its matching <<endif>> and produce
 * a chain of ConditionNodes with proper onTrue/onFalse branches.
 *
 * Returns the index of the first item AFTER the <<endif>>.
 */
function convertIfBlock(
  items: YarnLine[],
  startIdx: number,
  chain: DialogueNode[],
  patches: Array<(m: Map<string, string>) => void>,
): number {
  type Branch = { condition: string | null; body: YarnLine[] };
  const branches: Branch[] = [];

  let i = startIdx;
  const ifItem = items[i];
  if (ifItem.kind !== 'if') return i + 1;

  let currentBranch: Branch = { condition: ifItem.condition, body: [] };
  branches.push(currentBranch);
  i++;

  let depth = 1;
  while (i < items.length && depth > 0) {
    const line = items[i];
    if (line.kind === 'if') {
      depth++;
      currentBranch.body.push(line);
      i++;
    } else if (line.kind === 'endif') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
      currentBranch.body.push(line);
      i++;
    } else if (depth === 1 && line.kind === 'elseif') {
      currentBranch = { condition: line.condition, body: [] };
      branches.push(currentBranch);
      i++;
    } else if (depth === 1 && line.kind === 'else') {
      currentBranch = { condition: null, body: [] };
      branches.push(currentBranch);
      i++;
    } else {
      currentBranch.body.push(line);
      i++;
    }
  }

  buildConditionChain(branches, 0, chain, patches);
  return i;
}

/**
 * Recursively build ConditionNodes from a list of if/elseif/else branches.
 */
function buildConditionChain(
  branches: Array<{ condition: string | null; body: YarnLine[] }>,
  branchIdx: number,
  chain: DialogueNode[],
  patches: Array<(m: Map<string, string>) => void>,
): void {
  if (branchIdx >= branches.length) return;

  const branch = branches[branchIdx];

  // Else branch (no condition): convert body directly into the chain
  if (branch.condition === null) {
    const subChain: DialogueNode[] = [];
    convertSequentialSegment(branch.body, subChain, patches);
    for (const n of subChain) chain.push(n);
    return;
  }

  // Conditional branch: create a ConditionNode
  const cond = buildConditionFromExpr(branch.condition);
  const condNode: ConditionNode = {
    id: nextId('node'),
    type: 'condition',
    condition: cond,
    onTrue: null,
    onFalse: null,
  };
  chain.push(condNode);

  // Build onTrue sub-chain from the branch body
  const trueChain: DialogueNode[] = [];
  convertSequentialSegment(branch.body, trueChain, patches);

  if (trueChain.length > 0) {
    linkChain(trueChain);
    condNode.onTrue = trueChain[0].id;
    for (const n of trueChain) chain.push(n);
  }

  // Build onFalse from remaining branches (elseif / else)
  if (branchIdx + 1 < branches.length) {
    const falseChain: DialogueNode[] = [];
    buildConditionChain(branches, branchIdx + 1, falseChain, patches);

    if (falseChain.length > 0) {
      linkChain(falseChain);
      condNode.onFalse = falseChain[0].id;
      for (const n of falseChain) chain.push(n);
    }
  }
}

// ---------------------------------------------------------------------------
// Choice segment
// ---------------------------------------------------------------------------

function convertChoiceSegment(
  items: Array<{ kind: 'option'; text: string; target: string | null }>,
  chain: DialogueNode[],
  patches: Array<(m: Map<string, string>) => void>,
): void {
  const choices: DialogueChoice[] = items.map((item) => {
    const choiceId = nextId('choice');
    const choice: DialogueChoice = {
      id: choiceId,
      text: item.text,
      nextNodeId: null,
    };

    if (item.target) {
      const target = item.target;
      patches.push((entryMap) => {
        const resolved = entryMap.get(target);
        if (resolved) choice.nextNodeId = resolved;
      });
    }

    return choice;
  });

  const choiceNode: ChoiceNode = {
    id: nextId('node'),
    type: 'choice',
    choices,
  };
  chain.push(choiceNode);
}

// ---------------------------------------------------------------------------
// Link chain: wire up next/onTrue pointers between consecutive nodes
// ---------------------------------------------------------------------------

function linkChain(chain: DialogueNode[]): void {
  for (let i = 0; i < chain.length - 1; i++) {
    const current = chain[i];
    const nextNode = chain[i + 1];

    switch (current.type) {
      case 'text':
        if (current.next === null) current.next = nextNode.id;
        break;
      case 'action':
        if (current.next === null) current.next = nextNode.id;
        break;
      case 'condition':
        if (current.onTrue === null) current.onTrue = nextNode.id;
        break;
      // choice and end nodes do not chain automatically
    }
  }
}

// ---------------------------------------------------------------------------
// Condition expression parser (best-effort)
// ---------------------------------------------------------------------------

/**
 * Convert a Yarn <<if expression>> string into a SpawnForge Condition.
 *
 * Supports:
 *   $variable == value    -> equals
 *   $variable != value    -> not_equals
 *   $variable > value     -> greater
 *   $variable < value     -> less
 *   Anything else         -> equals with raw expression (preserve intent)
 */
function buildConditionFromExpr(expr: string): Condition {
  const clean = expr.trim();
  const unwrapped = clean.replace(/^\(+/, '').replace(/\)+$/, '').trim();

  const eqMatch = /^\$?(\w+)\s*==\s*(.+)$/.exec(unwrapped);
  if (eqMatch) {
    return { type: 'equals', variable: eqMatch[1], value: coerceValue(eqMatch[2].trim()) };
  }

  const neqMatch = /^\$?(\w+)\s*!=\s*(.+)$/.exec(unwrapped);
  if (neqMatch) {
    return { type: 'not_equals', variable: neqMatch[1], value: coerceValue(neqMatch[2].trim()) };
  }

  const gtMatch = /^\$?(\w+)\s*>\s*(.+)$/.exec(unwrapped);
  if (gtMatch) {
    const num = parseFloat(gtMatch[2]);
    if (!isNaN(num)) {
      return { type: 'greater', variable: gtMatch[1], value: num };
    }
  }

  const ltMatch = /^\$?(\w+)\s*<\s*(.+)$/.exec(unwrapped);
  if (ltMatch) {
    const num = parseFloat(ltMatch[2]);
    if (!isNaN(num)) {
      return { type: 'less', variable: ltMatch[1], value: num };
    }
  }

  // Fallback: preserve raw expression
  return { type: 'equals', variable: '__yarn_expr', value: clean };
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = parseFloat(raw);
  if (!isNaN(n) && String(n) === raw) return n;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}
