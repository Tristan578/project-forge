# Play-card font assets

These local assets are used only by the Node.js play OG image route. They are
loaded from traced files, rather than embedded in an Edge bundle.

| Asset | Origin | License |
| --- | --- | --- |
| `NotoSans-Regular.ttf` | [Noto Fonts](https://github.com/notofonts/noto-fonts) | SIL OFL 1.1 |
| `NotoSansArabic-Satori.ttf` | [Google Fonts Noto Sans Arabic](https://github.com/google/fonts/tree/main/ofl/notosansarabic), static subset with unsupported layout tables removed for Satori | SIL OFL 1.1 |
| `NotoSansCJKjp-Regular.otf` | [Noto CJK](https://github.com/notofonts/noto-cjk) | SIL OFL 1.1 |

The complete license text is in `OFL-1.1.txt`.

The exact cmap union and SHA-256 fingerprints are generated in src/lib/og/play-card-glyphs.ts. With fontTools 4.61.1 installed, run python web/scripts/generate-og-font-coverage.py from the repository root after an asset change; --check verifies freshness. The normal Vitest suite independently parses the actual Unicode cmaps and checks all fingerprints and generated points, so CI does not need Python. Supported supplementary ideographs are iterated as code points. Uncovered text takes the generic card before Next can request a fallback font.
