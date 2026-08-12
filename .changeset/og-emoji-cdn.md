---
'web': patch
---

Render the OG image badge as inline SVG instead of an emoji glyph. Satori resolves any pictographic codepoint through a third-party CDN rather than the bundled font, which put that CDN on the critical path of `next build` for the three prerendered OG routes — a connect timeout failed the export outright. The play card additionally strips emoji from the game title, description and creator name it renders, so a user-supplied emoji can no longer break that share card at request time.
