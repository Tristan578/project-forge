# Visual Scripting

A node-based graph editor for creating game logic by connecting typed ports — compiles directly to TypeScript with the same capabilities as hand-written scripts.

## Overview

Visual Scripting lets you build game behavior by dragging nodes onto a canvas and drawing wires between them instead of writing code. Each node represents an operation, an event, or a value. The graph compiles to TypeScript automatically, and the output runs in the same sandbox as regular scripts — with full access to the `forge.*` API. You can switch between the graph view and the compiled code at any time.

## Using the Visual Script Editor

1. Select an entity in the **Scene Hierarchy**.
2. In the **Inspector Panel**, go to the **Script** section.
3. Click the **Graph** tab at the top of the script editor to switch to visual scripting mode.
4. Click **+ Add Node** in the node palette on the left, or drag nodes from the palette onto the canvas.
5. Draw a wire from an output port to a compatible input port to connect nodes.
6. Click **Compile** (top right) to generate the TypeScript from the current graph.
7. Switch to the **Code** tab to see the compiled output.
8. Press **Play** to run the script.

## Node Categories

### Events (8 nodes)
Event nodes have no inputs — they fire when a game event occurs and kick off the execution flow.

| Node | Description |
|---|---|
| On Start | Fires once when the game begins |
| On Update | Fires every frame, outputs Delta Time |
| On Collision Enter | Fires when this entity starts touching another |
| On Collision Exit | Fires when this entity stops touching another |
| On Trigger Enter | Fires when another entity enters this trigger volume |
| On Trigger Exit | Fires when another entity exits this trigger volume |
| On Key Press | Fires when a specific key is pressed |
| On Timer | Fires at a regular interval |

### Flow Control (6 nodes)
| Node | Description |
|---|---|
| Branch | If/else — routes execution to True or False outputs |
| For Loop | Iterates over a range of integers |
| While Loop | Repeats while a condition is true |
| Sequence | Executes multiple outputs one after another |
| Delay | Waits N seconds before continuing |
| Do Once | Passes execution through only the first time |

### Math (20 nodes)
Arithmetic, comparison, and trigonometry operations including Add, Subtract, Multiply, Divide, Clamp, Lerp, Min, Max, Abs, Floor, Ceil, Round, Power, Sqrt, Mod, Sin, Cos, Tan, Random, and Map Range.

### Transform (7 nodes)
Get and set position, rotation, and scale. Includes Get Transform, Set Position, Set Rotation, Set Scale, Translate, Rotate, and Look At.

### Physics (6 nodes)
Apply Force, Apply Impulse, Set Velocity, Get Velocity, Distance To, and Is Grounded.

### Input (6 nodes)
Is Pressed, Just Pressed, Just Released, Get Axis, Is Touch Device, and Vibrate.

### Audio (6 nodes)
Play Audio, Stop Audio, Set Volume, Set Pitch, Fade In, and Fade Out.

### State (4 nodes)
Get State, Set State, Increment State, and Has State — for reading and writing shared variables between scripts.

### Entity (6 nodes)
Spawn Entity, Destroy Entity, Find By Name, Get Entity Name, Set Visible, and Set Color.

### UI (4 nodes)
Show Text, Update Text, Remove Text, and Show Screen.

## Port Types and Colors

Ports are typed — you can only connect compatible types together. White lines are execution flows; colored lines carry data values.

| Color | Type | Description |
|---|---|---|
| White | Exec | Execution flow — determines what runs and in what order |
| Green | Float | Decimal number |
| Blue | Int | Integer number |
| Red | Bool | True/false value |
| Yellow | String | Text |
| Purple | Vec3 | Three-component vector (X, Y, Z) |
| Orange | Entity | An entity reference (ID) |
| Gray | Any | Accepts any data type |

## Tips

- Every graph must start with at least one **Event** node — without one, nothing will execute.
- The **Sequence** node is the visual equivalent of calling multiple functions in a row. Use it to apply multiple effects after a single event fires.
- Graphs compile to readable TypeScript, so if you outgrow what the node graph can express, switch to the **Code** tab and continue editing in plain code — the two modes stay in sync.
