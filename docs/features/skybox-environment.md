# Skybox and Environment

Procedural skybox presets and image-based lighting (IBL) that set the mood of your entire scene with one dropdown — plus AI-powered custom skybox generation.

## Overview

The Skybox system replaces the solid background color with a procedurally generated sky texture rendered as a cubemap. The same cubemap drives image-based lighting (IBL), so every material in the scene reflects and receives ambient light from the sky automatically. This gives a significant visual upgrade over flat ambient light alone.

## Using Skybox and Environment Settings in the Editor

All environment controls live in the **Scene Settings** panel:

1. Open **Scene Settings** from the right panel or the panel menu.
2. Scroll to the **Environment** section.
3. Click the **Skybox** dropdown and choose a preset (or "None" to disable).
4. Adjust **Clear Color** — the background color visible when no skybox is active.
5. Use **Fog** settings to add atmospheric depth.
6. Click **Generate Skybox** (purple button) to create a custom skybox using AI.

## Skybox Presets

| Preset | Description |
|---|---|
| None | Solid background using the Clear Color value |
| Studio | Neutral grey studio lighting — great for showcasing materials |
| Sunset | Warm orange and pink horizon with soft directional light |
| Overcast | Flat white sky with diffused, shadow-free illumination |
| Night | Dark blue sky with stars — low ambient, moonlight feel |
| Bright Day | Vivid blue sky with high ambient light — outdoor daytime scenes |

## Environment Properties

### Ambient Light
Controls the base fill light that affects all surfaces evenly.

| Property | Description |
|---|---|
| Color | The color tint of the ambient fill light |
| Brightness | Intensity (0-2000). Higher values flatten shadows |

### Environment
| Property | Description |
|---|---|
| Clear Color | Background color when no skybox is active |
| Skybox | Active skybox preset |
| Fog Color | The color of distance fog |
| Fog Near | Distance at which fog begins |
| Fog Far | Distance at which fog is fully opaque |

### Quality Preset
The quick-access **Quality Preset** dropdown (Low / Medium / High / Ultra) adjusts MSAA, shadow quality, bloom, sharpening, and particle density as a group.

## AI Skybox Generation

Click the **Generate Skybox** button in the Environment section to open the AI skybox generator. Enter a text description of the sky you want (for example, "stormy volcanic sky with orange glow and lightning") and the system generates a custom cubemap using your description. Generated skyboxes also serve as IBL sources just like the built-in presets.

Requires a token balance. Token cost is shown in the dialog before you submit.

## Tips

- **Studio** and **Overcast** are the best choices when designing materials, because their neutral lighting shows base color and roughness accurately without sky-colored tints.
- Enable fog at short distances for horror or mystery scenes — set Fog Near to 10 and Fog Far to 30 with a very dark fog color.
- The skybox affects IBL strength: Bright Day produces the most visible reflections on metallic surfaces, while Night produces very subtle reflections.
