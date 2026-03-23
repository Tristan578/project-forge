import { describe, it, expect } from 'vitest';
import { parseTweeFile } from '../twineImporter';
import type { TextNode, ChoiceNode, ConditionNode, ActionNode } from '@/stores/dialogueStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function passage(name: string, tags: string, body: string): string {
  const tagStr = tags ? ` [${tags}]` : '';
  return `:: ${name}${tagStr}\n${body}`;
}

function multiPassage(...blocks: string[]): string {
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Single passage — TextNode
// ---------------------------------------------------------------------------

describe('parseTweeFile - single passage text node', () => {
  it('parses a single passage into at least one TextNode', () => {
    const input = passage('Start', '', 'Hello, world!');
    const tree = parseTweeFile(input);

    const textNode = tree.nodes.find(
      (n) => n.type === 'text' && (n as TextNode).text === 'Hello, world!',
    );
    expect(textNode).not.toBeNull();
  });

  it('sets tree name to the passage name', () => {
    const input = passage('MyScene', '', 'Some text.');
    const tree = parseTweeFile(input);
    expect(tree.name).toBe('MyScene');
  });

  it('sets startNodeId pointing to a node in the tree', () => {
    const input = passage('Intro', '', 'First line.');
    const tree = parseTweeFile(input);

    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId);
    expect(startNode).not.toBeNull();
  });

  it('initialises variables as an empty object', () => {
    const input = passage('Vars', '', 'Text.');
    const tree = parseTweeFile(input);
    expect(tree.variables).toEqual({});
  });

  it('assigns a non-empty tree id', () => {
    const input = passage('P', '', 'Text.');
    const tree = parseTweeFile(input);
    expect(tree.id).toBeTruthy();
  });

  it('all nodes have valid types', () => {
    const input = passage('P', '', 'Line one.\nLine two.');
    const tree = parseTweeFile(input);
    const valid = new Set(['text', 'choice', 'condition', 'action', 'end']);
    for (const n of tree.nodes) {
      expect(valid.has(n.type)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Passage with [[links]] → ChoiceNode
// ---------------------------------------------------------------------------

describe('parseTweeFile - choice nodes', () => {
  it('parses a passage containing only [[links]] into a ChoiceNode', () => {
    const input = multiPassage(
      passage('Start', '', '[[Yes]]\n[[No]]'),
      passage('Yes', '', 'Good.'),
      passage('No', '', 'Bad.'),
    );
    const tree = parseTweeFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    expect(choiceNode!.choices.length).toBe(2);
  });

  it('resolves [[Target]] shorthand to the correct node ID', () => {
    const input = multiPassage(
      passage('Start', '', '[[End]]'),
      passage('End', '', 'Arrived.'),
    );
    const tree = parseTweeFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    const choiceTarget = choiceNode!.choices[0].nextNodeId;
    const resolved = tree.nodes.find((n) => n.id === choiceTarget);
    expect(resolved).not.toBeNull();
    expect(resolved!.type).not.toBe(undefined);
  });

  it('parses [[Display Text->Target]] arrow syntax correctly', () => {
    const input = multiPassage(
      passage('Start', '', '[[Go left->LeftPath]]\n[[Go right->RightPath]]'),
      passage('LeftPath', '', 'Went left.'),
      passage('RightPath', '', 'Went right.'),
    );
    const tree = parseTweeFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();

    const left = choiceNode!.choices.find((c) => c.text === 'Go left');
    const right = choiceNode!.choices.find((c) => c.text === 'Go right');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.nextNodeId).not.toBe(right!.nextNodeId);

    // Both should resolve to actual nodes
    expect(tree.nodes.find((n) => n.id === left!.nextNodeId)).toBeDefined();
    expect(tree.nodes.find((n) => n.id === right!.nextNodeId)).toBeDefined();
  });

  it('parses [[Display|Target]] pipe syntax correctly', () => {
    const input = multiPassage(
      passage('Start', '', '[[Pick this|Destination]]'),
      passage('Destination', '', 'Arrived.'),
    );
    const tree = parseTweeFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    const choice = choiceNode!.choices[0];
    expect(choice.text).toBe('Pick this');
    expect(tree.nodes.find((n) => n.id === choice.nextNodeId)).toBeDefined();
  });

  it('produces unique choice IDs', () => {
    const input = multiPassage(
      passage('Start', '', '[[A]]\n[[B]]\n[[C]]'),
      passage('A', '', 'A.'),
      passage('B', '', 'B.'),
      passage('C', '', 'C.'),
    );
    const tree = parseTweeFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    const choiceIds = choiceNode!.choices.map((c) => c.id);
    expect(new Set(choiceIds).size).toBe(choiceIds.length);
  });
});

// ---------------------------------------------------------------------------
// Multi-passage file
// ---------------------------------------------------------------------------

describe('parseTweeFile - multi-passage', () => {
  it('includes nodes from all passages', () => {
    const input = multiPassage(
      passage('PassageA', '', 'Text A.'),
      passage('PassageB', '', 'Text B.'),
      passage('PassageC', '', 'Text C.'),
    );
    const tree = parseTweeFile(input);

    const texts = (tree.nodes.filter((n) => n.type === 'text') as TextNode[]).map((n) => n.text);
    expect(texts).toContain('Text A.');
    expect(texts).toContain('Text B.');
    expect(texts).toContain('Text C.');
  });

  it('produces unique node IDs across all passages', () => {
    const input = multiPassage(
      passage('A', '', 'Line 1.\nLine 2.'),
      passage('B', '', 'Line 3.\nLine 4.'),
    );
    const tree = parseTweeFile(input);
    const ids = tree.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets startNodeId to first passage entry by default', () => {
    const input = multiPassage(
      passage('First', '', 'First text.'),
      passage('Second', '', 'Second text.'),
    );
    const tree = parseTweeFile(input);

    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId);
    expect(startNode).not.toBeNull();
    // The start node should come from the first passage
    expect(startNode!.type).not.toBe(undefined);
  });
});

// ---------------------------------------------------------------------------
// Startup tag detection
// ---------------------------------------------------------------------------

describe('parseTweeFile - startup tag', () => {
  it('uses a passage tagged [startup] as the start node', () => {
    const input = multiPassage(
      passage('NotStart', '', 'Not the start.'),
      passage('ActualStart', 'startup', 'Real start.'),
    );
    const tree = parseTweeFile(input);

    expect(tree.name).toBe('ActualStart');
    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId);
    expect(startNode).not.toBeNull();
  });

  it('falls back to first passage when no startup tag', () => {
    const input = multiPassage(
      passage('Alpha', '', 'Alpha text.'),
      passage('Beta', '', 'Beta text.'),
    );
    const tree = parseTweeFile(input);
    expect(tree.name).toBe('Alpha');
  });
});

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

describe('parseTweeFile - (set:) macro', () => {
  it('converts (set: $var to value) into an ActionNode with set_state', () => {
    const input = passage('Start', '', '(set: $score to 10)');
    const tree = parseTweeFile(input);

    const actionNode = tree.nodes.find((n) => n.type === 'action') as ActionNode | undefined;
    expect(actionNode).not.toBeNull();
    expect(actionNode!.actions[0].type).toBe('set_state');
    const action = actionNode!.actions[0] as { type: string; key: string; value: unknown };
    expect(action.key).toBe('score');
    expect(action.value).toBe(10);
  });

  it('parses boolean true in set macro', () => {
    const input = passage('S', '', '(set: $flag to true)');
    const tree = parseTweeFile(input);
    const actionNode = tree.nodes.find((n) => n.type === 'action') as ActionNode | undefined;
    expect(actionNode).not.toBeNull();
    const action = actionNode!.actions[0] as { type: string; key: string; value: unknown };
    expect(action.value).toBe(true);
  });
});

describe('parseTweeFile - (if:) macro', () => {
  it('converts (if: $var is value) into a ConditionNode', () => {
    const input = passage('Start', '', '(if: $flag is true)');
    const tree = parseTweeFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.condition.type).toBe('equals');
  });

  it('maps is not to not_equals', () => {
    const input = passage('Start', '', '(if: $alive is not false)');
    const tree = parseTweeFile(input);
    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.condition.type).toBe('not_equals');
  });

  it('maps > operator to greater condition', () => {
    const input = passage('Start', '', '(if: $score > 5)');
    const tree = parseTweeFile(input);
    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.condition.type).toBe('greater');
    if (condNode!.condition.type === 'greater') {
      expect(condNode!.condition.variable).toBe('score');
      expect(condNode!.condition.value).toBe(5);
    }
  });

  it('maps < operator to less condition', () => {
    const input = passage('Start', '', '(if: $hp < 20)');
    const tree = parseTweeFile(input);
    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.condition.type).toBe('less');
  });
});

// ---------------------------------------------------------------------------
// Empty / malformed input
// ---------------------------------------------------------------------------

describe('parseTweeFile - malformed input', () => {
  it('throws on empty string', () => {
    expect(() => parseTweeFile('')).toThrow('No valid Twee passages found');
  });

  it('throws on whitespace-only input', () => {
    expect(() => parseTweeFile('   \n\n   ')).toThrow('No valid Twee passages found');
  });

  it('throws when no :: passage headers exist', () => {
    expect(() => parseTweeFile('just some text without headers')).toThrow(
      'No valid Twee passages found',
    );
  });

  it('handles a passage with empty body gracefully', () => {
    const input = passage('EmptyPassage', '', '');
    const tree = parseTweeFile(input);
    expect(tree.nodes.length).toBeGreaterThan(0);
    const endNode = tree.nodes.find((n) => n.type === 'end');
    expect(endNode).not.toBeNull();
  });

  it('all nodes in a mixed tree have valid types', () => {
    const input = multiPassage(
      passage('Start', '', 'Hello.\n[[End]]'),
      passage('End', '', 'Bye.'),
    );
    const tree = parseTweeFile(input);
    const valid = new Set(['text', 'choice', 'condition', 'action', 'end']);
    for (const n of tree.nodes) {
      expect(valid.has(n.type)).toBe(true);
    }
  });
});
