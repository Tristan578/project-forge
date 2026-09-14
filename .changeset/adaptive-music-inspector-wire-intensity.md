---
"web": patch
---

Wire the Adaptive Music inspector's intensity slider to the audio engine. Configure Stems now registers the `default` adaptive track (`audioManager.setAdaptiveMusic`) that the slider drives, and moving the slider forwards the value to `audioManager.setMusicIntensity` on the same path the `set_music_intensity` chat tool uses — clamped to 0–1 and with non-finite input refused — so manual edits actually change the adaptive-music mix instead of only updating store state. Moving the slider before any track is registered now shows a toast telling the user to configure stems first, instead of silently doing nothing.
