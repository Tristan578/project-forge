import { describe, it, expect } from 'vitest';
import { parseYarnFile } from '../yarnImporter';
import type { TextNode, ChoiceNode, ConditionNode, ActionNode, EndNode } from '@/stores/dialogueStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeYarn(nodes: string): string {
  return nodes.trim();
}

function nodeBlock(title: string, body: string): string {
  return `title: ${title}\n---\n${body}\n===`;
}

// ---------------------------------------------------------------------------
// Basic text node parsing
// ---------------------------------------------------------------------------

describe('parseYarnFile - text nodes', () => {
  it('parses a single text line into a TextNode', () => {
    const input = makeYarn(nodeBlock('Start', 'Hello, world!'));
    const tree = parseYarnFile(input);

    expect(tree.name).toBe('Start');
    expect(tree.nodes.length).toBeGreaterThan(0);

    const textNode = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Hello, world!');
    expect(textNode).not.toBeNull();
  });

  it('creates a tree with correct startNodeId pointing to the first node', () => {
    const input = makeYarn(nodeBlock('Intro', 'First line.\nSecond line.'));
    const tree = parseYarnFile(input);

    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId);
    expect(startNode).not.toBeNull();
    expect(startNode!.type).toBe('text');
    expect((startNode as TextNode).text).toBe('First line.');
  });

  it('links consecutive text nodes via next pointer', () => {
    const input = makeYarn(nodeBlock('Chain', 'Line A.\nLine B.'));
    const tree = parseYarnFile(input);

    const nodeA = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Line A.') as TextNode | undefined;
    const nodeB = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Line B.') as TextNode | undefined;

    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    expect(nodeA!.next).toBe(nodeB!.id);
  });

  it('sets tree name to the first node title', () => {
    const input = makeYarn(nodeBlock('MyScene', 'Some text.'));
    const tree = parseYarnFile(input);
    expect(tree.name).toBe('MyScene');
  });

  it('initialises variables as empty object', () => {
    const input = makeYarn(nodeBlock('Vars', 'Text.'));
    const tree = parseYarnFile(input);
    expect(tree.variables).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Choice parsing with target links
// ---------------------------------------------------------------------------

describe('parseYarnFile - choices', () => {
  it('parses -> options into a ChoiceNode', () => {
    const body = `What would you like?
-> Yes [[NodeYes]]
-> No [[NodeNo]]`;
    const input = makeYarn([nodeBlock('Start', body), nodeBlock('NodeYes', 'Good choice.'), nodeBlock('NodeNo', 'Too bad.')].join('\n\n'));
    const tree = parseYarnFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    expect(choiceNode!.choices.length).toBe(2);
    expect(choiceNode!.choices[0].text).toBe('Yes');
    expect(choiceNode!.choices[1].text).toBe('No');
  });

  it('resolves [[TargetNode]] references to correct node IDs', () => {
    const body = `-> Go left [[LeftPath]]\n-> Go right [[RightPath]]`;
    const input = makeYarn([
      nodeBlock('Start', body),
      nodeBlock('LeftPath', 'You went left.'),
      nodeBlock('RightPath', 'You went right.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();

    const leftChoice = choiceNode!.choices.find((c) => c.text === 'Go left');
    const rightChoice = choiceNode!.choices.find((c) => c.text === 'Go right');

    expect(leftChoice!.nextNodeId).toBeDefined();
    expect(rightChoice!.nextNodeId).toBeDefined();
    expect(leftChoice!.nextNodeId).not.toBe(rightChoice!.nextNodeId);

    // The resolved IDs must exist in the tree
    const leftNode = tree.nodes.find((n) => n.id === leftChoice!.nextNodeId);
    const rightNode = tree.nodes.find((n) => n.id === rightChoice!.nextNodeId);
    expect(leftNode).not.toBeNull();
    expect(rightNode).not.toBeNull();
  });

  it('handles options without target links (nextNodeId stays null)', () => {
    const input = makeYarn(nodeBlock('Start', '-> Option without link'));
    const tree = parseYarnFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();
    expect(choiceNode!.choices[0].nextNodeId).toBeNull();
  });

  it('handles [[Display|TargetNode]] v1 jump syntax in choice target', () => {
    const body = `-> Pick this [[Pretty Label|TargetNode]]`;
    const input = makeYarn([nodeBlock('Start', body), nodeBlock('TargetNode', 'Arrived.')].join('\n\n'));
    const tree = parseYarnFile(input);

    const choiceNode = tree.nodes.find((n) => n.type === 'choice') as ChoiceNode | undefined;
    expect(choiceNode).not.toBeNull();

    // The choice itself should have the text before [[
    const choice = choiceNode!.choices[0];
    expect(choice.nextNodeId).toBeDefined();
    const resolved = tree.nodes.find((n) => n.id === choice.nextNodeId);
    expect(resolved).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Conditional branches
// ---------------------------------------------------------------------------

describe('parseYarnFile - conditionals', () => {
  it('parses <<if condition>> into a ConditionNode', () => {
    const body = `<<if $flag == true>>\nYou have the flag.\n<<endif>>`;
    const input = makeYarn(nodeBlock('Start', body));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.condition.type).toBe('equals');
  });

  it('maps == operator to equals condition', () => {
    const input = makeYarn(nodeBlock('Start', `<<if $score == 10>>\nWon!\n<<endif>>`));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(condNode.condition.type).toBe('equals');
    if (condNode.condition.type === 'equals') {
      expect(condNode.condition.variable).toBe('score');
      expect(condNode.condition.value).toBe(10);
    }
  });

  it('maps != operator to not_equals condition', () => {
    const input = makeYarn(nodeBlock('Start', `<<if $alive != false>>\nStill here.\n<<endif>>`));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(condNode.condition.type).toBe('not_equals');
  });

  it('maps > operator to greater condition', () => {
    const input = makeYarn(nodeBlock('Start', `<<if $level > 5>>\nHigh level.\n<<endif>>`));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(condNode.condition.type).toBe('greater');
    if (condNode.condition.type === 'greater') {
      expect(condNode.condition.variable).toBe('level');
      expect(condNode.condition.value).toBe(5);
    }
  });

  it('maps < operator to less condition', () => {
    const input = makeYarn(nodeBlock('Start', `<<if $hp < 20>>\nLow health.\n<<endif>>`));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(condNode.condition.type).toBe('less');
  });

  it('creates onFalse branch for <<else>>', () => {
    const body = `<<if $flag == true>>
You have the flag.
<<else>>
You do not have the flag.
<<endif>>`;
    const input = makeYarn(nodeBlock('Start', body));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode | undefined;
    expect(condNode).not.toBeNull();
    expect(condNode!.onTrue).not.toBeNull();
    expect(condNode!.onFalse).not.toBeNull();

    const trueNode = tree.nodes.find((n) => n.id === condNode!.onTrue) as TextNode;
    expect(trueNode).not.toBeNull();
    expect(trueNode.text).toBe('You have the flag.');

    const falseNode = tree.nodes.find((n) => n.id === condNode!.onFalse) as TextNode;
    expect(falseNode).not.toBeNull();
    expect(falseNode.text).toBe('You do not have the flag.');
  });

  it('creates chained ConditionNodes for <<elseif>>', () => {
    const body = `<<if $score > 90>>
Excellent!
<<elseif $score > 50>>
Not bad.
<<else>>
Try harder.
<<endif>>`;
    const input = makeYarn(nodeBlock('Start', body));
    const tree = parseYarnFile(input);

    const firstCond = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(firstCond).not.toBeNull();
    expect(firstCond.condition.type).toBe('greater');
    expect(firstCond.onTrue).not.toBeNull();
    expect(firstCond.onFalse).not.toBeNull();

    const excellentNode = tree.nodes.find((n) => n.id === firstCond.onTrue) as TextNode;
    expect(excellentNode.text).toBe('Excellent!');

    const secondCond = tree.nodes.find((n) => n.id === firstCond.onFalse) as ConditionNode;
    expect(secondCond).not.toBeNull();
    expect(secondCond.type).toBe('condition');
    expect(secondCond.onTrue).not.toBeNull();
    expect(secondCond.onFalse).not.toBeNull();

    const notBadNode = tree.nodes.find((n) => n.id === secondCond.onTrue) as TextNode;
    expect(notBadNode.text).toBe('Not bad.');

    const tryHarderNode = tree.nodes.find((n) => n.id === secondCond.onFalse) as TextNode;
    expect(tryHarderNode.text).toBe('Try harder.');
  });

  it('handles if/else with no elseif', () => {
    const body = `<<if $alive == true>>
Still here.
<<else>>
Game over.
<<endif>>`;
    const input = makeYarn(nodeBlock('Start', body));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(condNode.onTrue).not.toBeNull();
    expect(condNode.onFalse).not.toBeNull();

    const falseNode = tree.nodes.find((n) => n.id === condNode.onFalse) as TextNode;
    expect(falseNode.text).toBe('Game over.');
  });

  it('handles if without else (onFalse remains null)', () => {
    const body = `<<if $flag == true>>
Flag is set.
<<endif>>`;
    const input = makeYarn(nodeBlock('Start', body));
    const tree = parseYarnFile(input);

    const condNode = tree.nodes.find((n) => n.type === 'condition') as ConditionNode;
    expect(condNode.onTrue).not.toBeNull();
    expect(condNode.onFalse).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-node files
// ---------------------------------------------------------------------------

describe('parseYarnFile - multi-node files', () => {
  it('produces nodes from all Yarn nodes in the file', () => {
    const input = makeYarn([
      nodeBlock('NodeA', 'Text in A.'),
      nodeBlock('NodeB', 'Text in B.'),
      nodeBlock('NodeC', 'Text in C.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);
    const textNodes = tree.nodes.filter((n) => n.type === 'text') as TextNode[];
    const texts = textNodes.map((n) => n.text);

    expect(texts).toContain('Text in A.');
    expect(texts).toContain('Text in B.');
    expect(texts).toContain('Text in C.');
  });

  it('resolves <<jump>> across nodes', () => {
    const input = makeYarn([
      nodeBlock('Start', 'Hello.\n<<jump End>>'),
      nodeBlock('End', 'Goodbye.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);

    // There should be a text/jump-carrier node whose next points to the End node's entry
    const endEntry = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Goodbye.');
    expect(endEntry).not.toBeNull();

    // Find the node that has next pointing to endEntry
    const jumpCarrier = tree.nodes.find(
      (n) => n.type === 'text' && (n as TextNode).next === endEntry!.id,
    );
    expect(jumpCarrier).not.toBeNull();
  });

  it('resolves [[NodeName]] v1 inline jump syntax', () => {
    const input = makeYarn([
      nodeBlock('Start', 'Text.\n[[Destination]]'),
      nodeBlock('Destination', 'Arrived.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);

    const destEntry = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Arrived.');
    expect(destEntry).not.toBeNull();

    const jumpCarrier = tree.nodes.find(
      (n) => n.type === 'text' && (n as TextNode).next === destEntry!.id,
    );
    expect(jumpCarrier).not.toBeNull();
  });

  it('sets startNodeId to the entry node of the first Yarn node', () => {
    const input = makeYarn([
      nodeBlock('First', 'First text.'),
      nodeBlock('Second', 'Second text.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);
    const startNode = tree.nodes.find((n) => n.id === tree.startNodeId) as TextNode | undefined;
    expect(startNode).not.toBeNull();
    expect(startNode!.text).toBe('First text.');
  });

  it('handles <<stop>> as EndNode', () => {
    const input = makeYarn(nodeBlock('Start', 'Before stop.\n<<stop>>\nAfter stop — never reached.'));
    const tree = parseYarnFile(input);

    const endNode = tree.nodes.find((n) => n.type === 'end') as EndNode | undefined;
    expect(endNode).not.toBeNull();
  });

  it('creates ActionNode for unknown commands', () => {
    const input = makeYarn(nodeBlock('Start', '<<playSound click>>'));
    const tree = parseYarnFile(input);

    const actionNode = tree.nodes.find((n) => n.type === 'action') as ActionNode | undefined;
    expect(actionNode).not.toBeNull();
    expect(actionNode!.actions.length).toBeGreaterThan(0);
    expect(actionNode!.actions[0].type).toBe('trigger_event');
    expect((actionNode!.actions[0] as { type: string; eventName: string }).eventName).toContain('playsound');
  });
});

// ---------------------------------------------------------------------------
// Empty jump nodes
// ---------------------------------------------------------------------------

describe('parseYarnFile - empty jump nodes', () => {
  it('treats <<jump>> with no target as EndNode', () => {
    const input = makeYarn(nodeBlock('Start', 'Hello.\n<<jump >>'));
    const tree = parseYarnFile(input);

    const endNode = tree.nodes.find((n) => n.type === 'end') as EndNode | undefined;
    expect(endNode).not.toBeNull();
  });

  it('treats <<jump>> with empty string target as EndNode', () => {
    const input = makeYarn(nodeBlock('Start', 'Hello.\n<<jump>>'));
    const tree = parseYarnFile(input);

    const endNode = tree.nodes.find((n) => n.type === 'end') as EndNode | undefined;
    expect(endNode).not.toBeNull();
  });

  it('does not create empty TextNode carrier for jump with no target', () => {
    const input = makeYarn(nodeBlock('Start', 'Hello.\n<<jump >>'));
    const tree = parseYarnFile(input);

    const emptyCarrier = tree.nodes.find(
      (n) => n.type === 'text' && (n as TextNode).text === '' && (n as TextNode).next === null,
    );
    expect(emptyCarrier).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Empty / malformed input handling
// ---------------------------------------------------------------------------

describe('parseYarnFile - malformed input', () => {
  it('throws on completely empty string', () => {
    expect(() => parseYarnFile('')).toThrow('No valid Yarn nodes found');
  });

  it('throws on whitespace-only input', () => {
    expect(() => parseYarnFile('   \n\n   ')).toThrow('No valid Yarn nodes found');
  });

  it('throws when no valid title is present', () => {
    // A node block with a header but no "title:" key
    const noTitle = 'tags: some_tag\n---\nsome body\n===';
    expect(() => parseYarnFile(noTitle)).toThrow('No valid Yarn nodes found');
  });

  it('handles a Yarn node with empty body gracefully', () => {
    const input = makeYarn(nodeBlock('EmptyNode', ''));
    const tree = parseYarnFile(input);

    // Should produce at least an EndNode
    expect(tree.nodes.length).toBeGreaterThan(0);
    const endNode = tree.nodes.find((n) => n.type === 'end');
    expect(endNode).not.toBeNull();
  });

  it('ignores malformed node (missing title) among valid nodes', () => {
    const input = makeYarn([
      'tags: broken\n---\nno title\n===',
      nodeBlock('Good', 'Valid node.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);
    expect(tree.name).toBe('Good');
    const textNode = tree.nodes.find((n) => n.type === 'text' && (n as TextNode).text === 'Valid node.');
    expect(textNode).not.toBeNull();
  });

  it('produces unique node IDs across multiple nodes', () => {
    const input = makeYarn([
      nodeBlock('A', 'Line 1.\nLine 2.'),
      nodeBlock('B', 'Line 3.\nLine 4.'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);
    const ids = tree.nodes.map((n) => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all nodes in the tree have valid types', () => {
    const input = makeYarn([
      nodeBlock('Start', 'Hello.\n-> Yes [[End]]\n-> No [[End]]'),
      nodeBlock('End', 'Bye.\n<<stop>>'),
    ].join('\n\n'));

    const tree = parseYarnFile(input);
    const validTypes = new Set(['text', 'choice', 'condition', 'action', 'end']);
    for (const node of tree.nodes) {
      expect(validTypes.has(node.type)).toBe(true);
    }
  });
});
