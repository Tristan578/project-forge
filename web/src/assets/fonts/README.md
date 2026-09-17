# Play-card font assets

> **Last updated:** 2026-09-16

The Node.js play OG image route reads these local files through Next's output
file tracing. Font requests do not include user text or leave the application.

| Asset | Source | License |
| --- | --- | --- |
| NotoSans-Regular.ttf | [Noto Fonts regular](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf) | SIL OFL 1.1, OFL-1.1.txt |
| NotoSans-Bold.ttf | [Noto Fonts bold](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf) | SIL OFL 1.1, OFL-1.1.txt |
| SpawnForgeArabic-Regular.ttf | Derivative of [Noto Sans Arabic 2.009](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSansArabic/NotoSansArabic-Regular.ttf) | SIL OFL 1.1, OFL-1.1.txt |
| NotoSansCJKjp-Regular.otf | [Noto CJK Japanese regular](https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf) | SIL OFL 1.1, NotoCJK-OFL-1.1.txt |

The original copyright and license records remain in the font metadata. The
Latin title uses the separately registered Noto Sans Bold face at weight 700,
matching the local 700 Latin baseline before the multilingual custom-font work;
Satori does not synthesize a bold face from the regular asset.

The unmodified Arabic source and its license are stored in web/scripts/fonts, outside
the traced runtime font directory. Its SHA-256 is pinned by the preparation
script. The renamed derivative retains encoded initial, medial, and final Arabic
forms. Advanced ligatures resolving to unencoded glyphs are excluded because
Next's bundled Satori fallback resolver cannot handle them. This font adaptation
retains per-word shaping. The card lays pure Arabic paragraphs out as wrapping
right-to-left flex rows, preserving logical word and line order. Mixed Arabic
and Latin paragraphs still require a full bidirectional layout renderer.

With fontTools 4.61.1 installed, run these commands from the repository root:

~~~sh
python web/scripts/prepare-og-arabic-font.py
python web/scripts/generate-og-font-coverage.py
python web/scripts/prepare-og-arabic-font.py --check
python web/scripts/generate-og-font-coverage.py --check
~~~

Preparation preserves the upstream timestamp for deterministic output. The exact
Unicode cmap union and font SHA-256 fingerprints are generated in
web/src/lib/og/play-card-glyphs.ts. Vitest independently parses the actual Unicode
cmaps, checks the fingerprints, and requires the Arabic joining features, so CI
does not need Python. Supported supplementary ideographs are iterated as code
points. Uncovered text takes the generic card before Next can request an external
fallback font; supported card titles, descriptions, and creator names are retained.
If a traced custom asset cannot be read, the route omits Satori's custom-font
option and renders only neutral ASCII through Next's bundled local fallback;
it never passes user text to a remote fallback resolver.
