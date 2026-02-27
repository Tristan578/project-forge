# AI Asset Generation

Five generation dialogs that create 3D models, textures, sound effects, voice lines, and music directly inside the editor using text descriptions.

## Overview

AI Asset Generation lets you describe what you want in plain language and receive a game-ready asset a few seconds later. Generated assets are added to your **Asset Panel** automatically and can be placed in the scene like any other asset. Each generation type uses tokens from your account balance; the cost is shown in the dialog before you submit.

## Accessing the Generation Dialogs

All generation dialogs are available from the **Asset Panel**:

1. Open the **Asset Panel** from the left sidebar.
2. Click the generation button for the asset type you want (3D Model, Texture, Sound, Voice, or Music), or right-click in the panel to see all options.
3. Fill in the prompt and options, then click **Generate**.
4. A progress indicator appears while the job runs. When complete, the asset appears in your Asset Panel.

You can also trigger generation from the **AI Chat** panel by describing the asset you need.

## Generation Types

### 3D Model
Generates a textured 3D mesh from a text description. Powered by Meshy.

| Option | Description |
|---|---|
| Prompt | Description of the 3D object you want (3-500 characters) |
| Art Style | Realistic, Cartoon, Low-poly, or PBR |
| Quality | Standard (100 tokens) or High (200 tokens) |
| Negative Prompt | Things to exclude from the generation |

Example prompts: "a weathered stone castle tower", "cute cartoon mushroom character", "sci-fi drone with glowing engines"

### Texture
Generates a tileable texture from a description. Powered by Meshy.

| Option | Description |
|---|---|
| Prompt | Description of the surface material (3-500 characters) |

Example prompts: "rusty metal plate with rivets", "mossy cobblestone path", "smooth marble with dark veins"

### Sound Effect
Generates a short sound effect. Powered by ElevenLabs.

| Option | Description |
|---|---|
| Prompt | Description of the sound you want |
| Duration | Length in seconds (1-22) |
| Attach to Entity | Automatically attach the sound to the currently selected entity |

Token cost: 20 tokens.

Example prompts: "coin pickup chime", "heavy footsteps on gravel", "electric sparking crackle"

### Voice Line
Generates spoken dialogue in a chosen voice style. Powered by ElevenLabs.

| Option | Description |
|---|---|
| Text | The line to speak (3-500 characters) |
| Voice Style | Neutral, Friendly, Sinister, Excited, or Calm |
| Attach to Entity | Automatically attach the audio to the currently selected entity |

Token cost: 40 tokens.

### Music Track
Generates a background music loop from a description. Powered by Suno.

| Option | Description |
|---|---|
| Prompt | Description of the music mood and genre |
| Duration | Length in seconds (15-120) |
| Instrumental | Generate without vocals (recommended for game music) |
| Attach to Entity | Automatically attach the track to the currently selected entity |

Token cost: 80 tokens.

Example prompts: "epic orchestral battle theme with drums and strings", "ambient forest sounds with gentle piano", "chiptune platformer jingle"

### AI Skybox
Generate a custom skybox cubemap. Access this from the **Generate Skybox** button in the Environment section of Scene Settings.

| Option | Description |
|---|---|
| Prompt | Description of the sky and environment |

## Tips

- Keep 3D model prompts specific about the shape and style — "a round wooden barrel with metal bands" works better than "a barrel".
- Generated textures tile automatically, making them immediately usable on large terrain or architectural surfaces.
- For game music, always enable **Instrumental** — lyrics rarely fit game loops and can become repetitive.
