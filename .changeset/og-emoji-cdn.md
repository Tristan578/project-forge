---
"web": patch
---

Render the OG image badge as inline SVG instead of an emoji glyph. Satori resolves any codepoint its emoji classifier matches through a third-party CDN rather than the bundled font, which put that CDN on the critical path of `next build` for the three prerendered OG routes — a connect timeout failed the export outright. The play card additionally strips emoji from the game title, description and creator name it renders, so a user-supplied emoji no longer breaks that share card at request time. The classifier keys on `Emoji`, not `Extended_Pictographic`, so flags, keycaps and skin-tone modifiers are stripped too, and truncation now counts codepoints so the cut cannot split a surrogate pair.
