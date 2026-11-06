---
"web": patch
---

2D games published before scenes recorded whether they are 2D or 3D can play in 2D on their `/play` page again (#10368). Such a game states no type, so the player loaded it in the default 3D mode, where no 2D camera exists, and it showed a blank canvas.

Two changes do this. First, when a game states no type, the player now looks at what it contains: if every entity is clearly 2D content (a sprite, a tilemap, a 2D skeleton or enabled 2D physics), with lights allowed alongside and nothing 3D-only (terrain, CSG, a glTF model, an imported asset), it switches to 2D before play. Anything mixed or unclear plays in 3D, as before. This applies to `/play` only and adds a Sentry breadcrumb each time it happens. Second, a one-off operator script, `web/scripts/backfill-publication-project-type.ts`, writes the type into stored publication snapshots from the source project's own saved type. That covers games the AI pipeline generated in a 2D project, which nothing in the scene marks as 2D. It runs as a dry run unless given `--apply`, never replaces a value, and skips a game whose project and contents disagree. The play API now also adds that stored type to an older, unchangeable R2 copy of the game that states none. The editor and saved scenes still never guess the type, and republishing a game writes the type into it.
