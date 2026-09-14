---
"web": patch
---

Wire the Adaptive Music inspector's intensity slider to the audio engine. Moving the slider now forwards the value to `audioManager.setMusicIntensity` on the same path the `set_music_intensity` chat tool uses — clamped to 0–1 and with non-finite input refused — so manual edits actually change the adaptive-music mix instead of only updating store state.
