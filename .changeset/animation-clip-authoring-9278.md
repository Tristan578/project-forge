---
"web": minor
---

Keyframe animation clips now run in the engine. The seven clip-authoring commands the Animation Clip inspector, Timeline and AI handlers have always dispatched (`create_animation_clip`, `add_clip_keyframe`, `remove_clip_keyframe`, `update_clip_keyframe`, `set_clip_property`, `preview_clip`, `remove_animation_clip`) were engine placeholders — they wrote editor state and animated nothing. They are now applied in the engine with undo/redo, the timeline's play/pause/seek drives the viewport, clips marked autoplay start on Play, and exported games play them too. Ships to the editor and to games exported after the next engine build.
