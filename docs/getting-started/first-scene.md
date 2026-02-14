# Your First Scene

Walk through creating a simple game scene from scratch.

## The Default Scene

When you open the editor, you'll see a default scene containing:
- A **ground plane** (large flat surface)
- A **cube** (centered above the ground)
- A **directional light** (casting shadows)

## Adding Objects

### From the Sidebar
1. Click the **+** button in the left sidebar
2. Choose from: Cube, Sphere, Plane, Cylinder, Cone, Torus, Capsule
3. The object spawns at the world origin

### From the Hierarchy
Right-click in the Scene Hierarchy panel to access the context menu with spawn options.

### Using MCP Commands
```json
{ "command": "spawn_entity", "params": { "entityType": "sphere", "name": "My Ball", "position": [0, 2, 0] } }
```

## Selecting Objects

- **Click** an object in the 3D viewport to select it
- **Click** an entry in the Scene Hierarchy panel
- Selected objects show a blue highlight and transform gizmo

## Moving Objects

1. Select an object
2. Use the **Move tool** (W key or click the move icon in the sidebar)
3. Drag the colored arrows:
   - **Red (X)** — left/right
   - **Green (Y)** — up/down
   - **Blue (Z)** — forward/back
4. Or type exact values in the Inspector panel's Transform section

## Rotating and Scaling

- **Rotate tool** (E key) — drag the colored rings
- **Scale tool** (R key) — drag the colored handles
- Hold **Shift** for snapped increments

## Adding Materials

1. Select an object
2. In the Inspector panel, find the **Material** section
3. Adjust:
   - **Base Color** — the object's main color
   - **Metallic** — 0 (plastic) to 1 (metal)
   - **Roughness** — 0 (mirror-smooth) to 1 (rough)
   - **Emissive** — self-illumination color and intensity

## Adding Lights

1. Click **+** in the sidebar and choose a light type:
   - **Point Light** — emits in all directions (like a light bulb)
   - **Directional Light** — parallel rays (like the sun)
   - **Spot Light** — focused cone of light
2. Adjust intensity, color, and range in the Inspector

## Saving Your Scene

- Press **Ctrl+S** or click **Save** in the top toolbar
- Scenes save as `.forge` files (JSON format)
- Auto-save to localStorage happens periodically

## Next Steps

- [Editor Overview](./editor-overview.md) — learn all the UI panels
- [Materials](../features/materials.md) — dive into PBR material editing
- [Physics](../features/physics.md) — make objects interact physically
- [Scripting](../features/scripting.md) — add game logic with TypeScript
