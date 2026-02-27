# Cloud Publishing

Publish your game to a shareable URL so anyone can play it in their browser — no downloads or installs required.

## Overview

Cloud Publishing compiles your current scene and assets, uploads them to our hosting infrastructure, and gives you a public URL you can share with anyone. Published games run entirely in the browser using WebAssembly, just like the editor preview. Your game continues to run even if you are not logged in.

## Publishing a Game

1. Click the **Publish** button in the top toolbar (the globe icon), or open it from the **File** menu.
2. The **Publish Game** dialog opens.
3. Fill in the **Title** — this is the name displayed on the game's public page.
4. Set the **URL Slug** — the short identifier that appears in the URL (e.g. `my-awesome-game` becomes `yourdomain.com/play/my-awesome-game`). The slug must be 3-50 characters, lowercase letters, numbers, and hyphens only.
5. As you type, a green checkmark confirms the slug is available, or a red warning shows if it is already taken.
6. Optionally add a **Description** to tell players what the game is about.
7. Click **Publish**. A progress indicator appears while the game uploads.
8. When complete, the dialog shows your shareable URL. Click it to copy or open it.

## Slug Requirements

- 3 to 50 characters
- Lowercase letters (a-z), numbers (0-9), and hyphens (-) only
- No spaces or special characters
- Must be unique across all published games

## After Publishing

- The published URL is permanent until you delete the project.
- Re-publishing the same project with the same slug updates the existing game at that URL.
- Viewers do not need an account to play your game.
- Your published game count and storage usage are shown on your account dashboard.

## Tier Limits

The number of games you can publish depends on your subscription tier. Check your account settings to see your current limit and usage.

## Tips

- Choose your slug carefully — it is part of the permanent URL. Changing it after sharing links will break those existing links.
- Test your game thoroughly in the editor's play mode before publishing. The published version uses the same WebAssembly engine, so behavior matches exactly.
- A short, descriptive slug is easier to remember and share. Prefer `forest-adventure` over `game-1-final-v3`.
