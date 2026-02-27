# Dialogue System

A branching conversation editor for creating NPC dialogue, interactive story moments, and in-game narrative — with a built-in runtime overlay and full script API.

## Overview

The Dialogue System lets you build conversation trees with text, player choices, conditions, and scripted actions. During play mode, an overlay appears automatically when a dialogue starts, displaying the speaker name, the line of text with a typewriter effect, and choice buttons when the player must decide. Trees are stored in the project and can be triggered by placing a **Dialogue Trigger** game component on any entity.

## Using the Dialogue Editor

1. Open the **Dialogue Editor** panel (accessible from the left sidebar or panel menu).
2. Click the **+** button next to the tree dropdown to create a new dialogue tree.
3. Rename the tree by editing the **Tree Name** field at the top.
4. Click **Add Node** at the bottom of the node list to add your first node.
5. Select a node type from the popup menu.
6. Click the chevron on any node to expand it and edit its properties.
7. Click **Set as Start Node** on the node that should play first.
8. Connect nodes together using the **Next Node** dropdowns on each node.

To trigger a tree from an entity, add a **Dialogue Trigger** game component to that entity and select the tree from the component's dropdown.

## Node Types

### Text Node
Displays a line of dialogue from a named speaker.

| Field | Description |
|---|---|
| Speaker | Name displayed above the dialogue box (e.g. "Guard", "Merchant") |
| Text | The line of dialogue |
| Next Node | Which node plays after this line |

### Choice Node
Presents the player with up to N choices. Each choice can lead to a different node.

| Field | Description |
|---|---|
| Prompt Text | Optional heading shown above the choices |
| Choices | List of choice labels; each has a **Next Node** dropdown |

Click **+ Add Choice** to add options. Click the trash icon on a choice to remove it.

### Condition Node
Branches to different nodes based on whether a dialogue variable evaluates as true or false.

| Field | Description |
|---|---|
| Variable | Name of the dialogue variable to test |
| If True | Node to go to when the condition is true |
| If False | Node to go to when the condition is false |

### Action Node
Runs one or more side-effects (set variables, trigger events) before moving to the next node. The number of configured actions is shown in the node summary.

| Field | Description |
|---|---|
| Next Node | Node to play after actions execute |

### End Node
Terminates the dialogue. No fields — any node whose **Next Node** points here (or is set to **(End)**) will stop the conversation.

## Script API

```typescript
// Start a dialogue tree by its ID
forge.dialogue.start("tree_id_here");

// Check if any dialogue is currently running
const active = forge.dialogue.isActive();

// Advance past the current text node (for auto-advance cutscenes)
forge.dialogue.advance();

// Skip the typewriter animation for the current line
forge.dialogue.skip();

// End dialogue immediately
forge.dialogue.end();

// Read/write variables used by Condition nodes
forge.dialogue.setVariable("my_tree_id", "hasKey", true);
const hasKey = forge.dialogue.getVariable("my_tree_id", "hasKey");

// Listen for events
forge.dialogue.onStart((treeId) => {
  forge.log("Dialogue started: " + treeId);
});

forge.dialogue.onEnd(() => {
  forge.log("Dialogue ended");
});

forge.dialogue.onChoice((choiceId, choiceText) => {
  forge.log("Player chose: " + choiceText);
});
```

## Tips

- One dialogue tree can be reused across multiple **Dialogue Trigger** components — useful for shared NPC lines.
- Use **Condition** nodes gated on a variable to create dialogue that changes after the player has done something (for example, set `"met_before"` to `true` after the first conversation).
- To create a branching cutscene that auto-advances without player input, chain **Text** nodes and call `forge.dialogue.advance()` from a timed script.
