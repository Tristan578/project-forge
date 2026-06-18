---
"web": patch
---

Close two content-safety bypasses in the input-sanitization layer:

- **Chat route (#8635):** the per-message prompt-injection screen, 4000-char cap,
  and sanitizer ran only on string `content`. Multimodal messages whose `content`
  is an array of parts (`[{ type: 'text', text }]`) hit a `continue` and skipped
  every guard. The validation loop now normalizes array content, screening and
  sanitizing each `{type:'text'}` block in place while leaving image/tool parts
  untouched.

- **Generation handler (#8650):** `createGenerationHandler` ran the content-safety
  filter on exactly one `promptField`. A new `secondaryPromptFields` option screens
  all user-supplied free-text on a route. The 3D model route now registers
  `negativePrompt` + `artStyle` as secondary fields and bounds both to 500 chars in
  its validator, so neither reaches Meshy unscreened or unbounded.
