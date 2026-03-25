import { describe, it, expect } from 'vitest';
import { parseInkJson } from '../inkImporter';
import type { TextNode, ChoiceNode, ConditionNode, ActionNode } from '@/stores/dialogueStore';

// ---------------------------------------------------------------------------
// Helpers — build minimal valid Ink JSON objects
// ---------------------------------------------------------------------------

function makeInk(rootItems: unknown[]): unknown {
  return { inkVersion: 21, root: rootItems, listDefs: {} };
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('parseInkJson - invalid input', () => {
  it('throws on null input', () => {
    expect(() => parseInkJson(null)).toThrow('Invalid Ink JSON');
  });

  it('throws on array input', () => {
    expect(() => parseInkJson([])).toThrow('Invalid Ink JSON');
  });

  it('throws on primitive input', () => {
    expect(() => parseInkJson('hello')).toThrow('Invalid Ink JSON');
  });

  it('throws on missing root', () => {
    expect(() => parseInkJson({ inkVersion: 21, listDefs: {} })).toThrow(
      'Invalid Ink JSON: missing root container',
    );
  });

  it('throws on bad inkVersion type', () => {
    expect(() => parseInkJson({ inkVersion: 'bad', root: [] })).toThrow(
      'Invalid Ink JSON: inkVersion must be a number',
    );
  });
});

// ---------------------------------------------------------------------------
// Basic text parsing
// ---------------------------------------------------------------------------

describe('parseInkJson - text parsing', () => {
  it('parses a single text line into a TextNode', () => {
    const input = makeInk(['^Hello, world!', '\n', 'end']);
    const tree = parseInkJson(input);

    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    expect(textNode).not.toBeNull();
    expect(textNode!.text).toBe('Hello, world!');
  });

  it('sets speaker to Narrator by default', () => {
    const input = makeInk(['^Some text', '\n', 'end']);
    const tree = parseInkJson(input);
    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode;
    expect(textNode.speaker).toBe('Narrator');
  });

  it('creates a valid startNodeId pointing to the first node', () => {
    const input = makeInk(['^First line', '\n', 'end']);
    const tree = parseInkJson(input);

    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId);
    expect(startNode).not.toBeNull();
    expect(startNode!.type).toBe('text');
  });

  it('links consecutive text lines via next pointer', () => {
    const input = makeInk(['^Line A', '\n', '^Line B', '\n', 'end']);
    const tree = parseInkJson(input);

    const nodeA = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Line A') as TextNode | undefined;
    const nodeB = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Line B') as TextNode | undefined;

    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA!.next).toBe(nodeB!.id);
  });

  it('handles "done" keyword as end signal', () => {
    const input = makeInk(['^Text', '\n', 'done']);
    const tree = parseInkJson(input);
    const hasEnd = tree.nodes.some((n) => n.type === 'end');
    expect(hasEnd).toBe(true);
  });

  it('accumulates multiple caret strings in one line into a single TextNode', () => {
    // Ink sometimes emits inline glue + multiple ^ segments before a newline
    const input = makeInk(['^Hello', '^, world!', '\n', 'end']);
    const tree = parseInkJson(input);
    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    expect(textNode).not.toBeNull();
    expect(textNode!.text).toContain('Hello');
    expect(textNode!.text).toContain('world!');
  });

  it('skips null content items without error', () => {
    const input = makeInk([null, '^Text', null, '\n', 'end']);
    const tree = parseInkJson(input);
    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    expect(textNode).not.toBeNull();
    expect(textNode!.text).toBe('Text');
  });

  it('skips numeric content items without error', () => {
    const input = makeInk([42, '^Text', 7, '\n', 'end']);
    const tree = parseInkJson(input);
    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    expect(textNode).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Choice parsing
// ---------------------------------------------------------------------------

describe('parseInkJson - choice parsing', () => {
  it('parses a single choice into a ChoiceNode with one choice', () => {
    const input = makeInk([
      '^What would you like?',
      '\n',
      { '*': 'Option A', '->': 'END', flg: 0 },
      'end',
    ]);
    const tree = parseInkJson(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    expect(choiceNode!.choices.length).toBe(1);
    expect(choiceNode!.choices[0].text).toBe('Option A');
  });

  it('merges consecutive choice objects into a single ChoiceNode', () => {
    const input = makeInk([
      '^Pick one:',
      '\n',
      { '*': 'Choice 1', '->': 'END', flg: 0 },
      { '*': 'Choice 2', '->': 'END', flg: 0 },
      { '*': 'Choice 3', '->': 'END', flg: 0 },
      'end',
    ]);
    const tree = parseInkJson(input);

    const choiceNodes = tree.nodes.filter((n) => n.type === 'choice') as ChoiceNode[];
    expect(choiceNodes.length).toBe(1);
    expect(choiceNodes[0].choices.length).toBe(3);
  });

  it('assigns unique IDs to each DialogueChoice', () => {
    const input = makeInk([
      { '*': 'A', '->': 'END', flg: 0 },
      { '*': 'B', '->': 'END', flg: 0 },
    ]);
    const tree = parseInkJson(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode;
    const ids = choiceNode.choices.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses "(choice)" as fallback text when choice has no text', () => {
    const input = makeInk([{ '*': '', '->': 'END', flg: 0 }, 'end']);
    const tree = parseInkJson(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    expect(choiceNode!.choices[0].text).toBe('(choice)');
  });

  it('skips fallback choices (flg & 0x02)', () => {
    // flg = 2 means IS_FALLBACK — should be ignored
    const input = makeInk([{ '*': 'auto-continue', flg: 2 }, 'end']);
    const tree = parseInkJson(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice');
    expect(choiceNode).toBeUndefined();
  });

  it('links TextNode to ChoiceNode via next pointer', () => {
    const input = makeInk([
      '^Prompt',
      '\n',
      { '*': 'Go left', '->': 'END', flg: 0 },
      'end',
    ]);
    const tree = parseInkJson(input);

    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(textNode).not.toBeNull();
    expect(choiceNode).not.toBeNull();
    expect(textNode!.next).toBe(choiceNode!.id);
  });
});

// ---------------------------------------------------------------------------
// Nested content (sub-containers)
// ---------------------------------------------------------------------------

describe('parseInkJson - nested content', () => {
  it('processes nested arrays as sub-containers', () => {
    const input = makeInk([
      ['^Inner text', '\n', 'end'],
    ]);
    const tree = parseInkJson(input);
    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    expect(textNode).not.toBeNull();
    expect(textNode!.text).toBe('Inner text');
  });

  it('handles multiply-nested containers', () => {
    const input = makeInk([
      [['^Deep text', '\n'], 'end'],
    ]);
    const tree = parseInkJson(input);
    const textNode = tree.nodes.find((n) => n.type === 'text') as TextNode | undefined;
    expect(textNode).not.toBeNull();
    expect(textNode!.text).toBe('Deep text');
  });

  it('handles conditional branches (b property)', () => {
    const input = makeInk([
      {
        b: [
          ['^True branch', '\n', 'end'],
          ['^False branch', '\n', 'end'],
        ],
      },
    ]);
    const tree = parseInkJson(input);
    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.onTrue).not.toBeNull();
    expect(condNode!.onFalse).not.toBeNull();
  });

  it('sets startNodeId to the ConditionNode when a conditional starts the story', () => {
    const input = makeInk([
      {
        b: [
          ['^True branch', '\n', 'end'],
          ['^False branch', '\n', 'end'],
        ],
      },
    ]);
    const tree = parseInkJson(input);
    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId);
    expect(startNode).not.toBeNull();
    expect(startNode!.type).toBe('condition');
  });

  it('handles conditional with only true branch', () => {
    const input = makeInk([
      { b: [['^Only if true', '\n', 'end']] },
    ]);
    const tree = parseInkJson(input);
    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.onTrue).not.toBeNull();
    expect(condNode!.onFalse).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Divert handling
// ---------------------------------------------------------------------------

describe('parseInkJson - divert handling', () => {
  it('maps -> END divert to EndNode', () => {
    const input = makeInk(['^Text', '\n', { '->': 'END' }]);
    const tree = parseInkJson(input);
    const endNode = tree.nodes.find((n) => n.type === 'end');
    expect(endNode).not.toBeNull();
  });

  it('maps -> DONE divert to EndNode', () => {
    const input = makeInk(['^Text', '\n', { '->': 'DONE' }]);
    const tree = parseInkJson(input);
    const endNode = tree.nodes.find((n) => n.type === 'end');
    expect(endNode).not.toBeNull();
  });

  it('maps -> knot divert to EndNode stub', () => {
    const input = makeInk(['^Text', '\n', { '->': 'some_knot' }]);
    const tree = parseInkJson(input);
    const endNode = tree.nodes.find((n) => n.type === 'end');
    expect(endNode).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Variable assignment
// ---------------------------------------------------------------------------

describe('parseInkJson - variable assignment', () => {
  it('maps VAR= to ActionNode with set_state', () => {
    const input = makeInk([{ 'VAR=': 'gold' }, 'end']);
    const tree = parseInkJson(input);
    const actionNode = tree.nodes.find((n) => n.type === 'action') as ActionNode | undefined;
    expect(actionNode).not.toBeNull();
    expect(actionNode!.actions[0].type).toBe('set_state');
    expect((actionNode!.actions[0] as { type: 'set_state'; key: string }).key).toBe('gold');
  });

  it('maps temp= to ActionNode with set_state', () => {
    const input = makeInk([{ temp: 'tempVar' }, 'end']);
    const tree = parseInkJson(input);
    const actionNode = tree.nodes.find((n) => n.type === 'action') as ActionNode | undefined;
    expect(actionNode).not.toBeNull();
    expect((actionNode!.actions[0] as { type: 'set_state'; key: string }).key).toBe('tempVar');
  });
});

// ---------------------------------------------------------------------------
// Tree structure invariants
// ---------------------------------------------------------------------------

describe('parseInkJson - tree structure', () => {
  it('always returns a tree with at least one node', () => {
    const input = makeInk([]);
    const tree = parseInkJson(input);
    expect(tree.nodes.length).toBeGreaterThan(0);
  });

  it('always ends with an EndNode', () => {
    const input = makeInk(['^Text without explicit end', '\n']);
    const tree = parseInkJson(input);
    const lastNode = tree.nodes[tree.nodes.length - 1];
    expect(lastNode.type).toBe('end');
  });

  it('returns a treeId string', () => {
    const input = makeInk(['end']);
    const tree = parseInkJson(input);
    expect(typeof tree.id).toBe('string');
    expect(tree.id.length).toBeGreaterThan(0);
  });

  it('uses custom name from #n property', () => {
    const input = { inkVersion: 21, root: ['end'], listDefs: {}, '#n': 'MyStory' };
    const tree = parseInkJson(input);
    expect(tree.name).toBe('MyStory');
  });

  it('falls back to "Ink Story" when no name is present', () => {
    const input = makeInk(['end']);
    const tree = parseInkJson(input);
    expect(tree.name).toBe('Ink Story');
  });

  it('all node IDs in the tree are unique', () => {
    const input = makeInk([
      '^Line 1', '\n',
      '^Line 2', '\n',
      { '*': 'Choice A', '->': 'END', flg: 0 },
      { '*': 'Choice B', '->': 'END', flg: 0 },
      'end',
    ]);
    const tree = parseInkJson(input);
    const ids = tree.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('startNodeId matches the first node', () => {
    const input = makeInk(['^Hello', '\n', 'end']);
    const tree = parseInkJson(input);
    expect(tree.startNodeId).toBe(tree.nodes[0].id);
  });
});

// ---------------------------------------------------------------------------
// Real-world minimal Ink JSON sample
// ---------------------------------------------------------------------------

describe('parseInkJson - realistic sample', () => {
  const realisticInk = {
    inkVersion: 21,
    root: [
      '^The old hermit looks at you.',
      '\n',
      '^"What brings you here?" he asks.',
      '\n',
      { '*': 'I seek wisdom.', '->' : 'END', flg: 0 },
      { '*': 'I am just passing through.', '->' : 'END', flg: 0 },
      'end',
    ],
    listDefs: {},
  };

  it('produces a valid DialogueTree from realistic Ink JSON', () => {
    const tree = parseInkJson(realisticInk);
    expect(tree.nodes.length).toBeGreaterThan(0);
    expect(tree.startNodeId).not.toBeNull();
  });

  it('contains text nodes with the dialogue lines', () => {
    const tree = parseInkJson(realisticInk);
    const textNodes = tree.nodes.filter((n) => n.type === 'text') as TextNode[];
    const texts = textNodes.map((n) => n.text);
    expect(texts.some((t) => t.includes('hermit'))).toBe(true);
    expect(texts.some((t) => t.includes('brings you here'))).toBe(true);
  });

  it('contains a choice node with the two choices', () => {
    const tree = parseInkJson(realisticInk);
    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    expect(choiceNode!.choices.length).toBe(2);
    const choiceTexts = choiceNode!.choices.map((c) => c.text);
    expect(choiceTexts).toContain('I seek wisdom.');
    expect(choiceTexts).toContain('I am just passing through.');
  });
});
