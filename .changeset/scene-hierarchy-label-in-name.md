---
"web": patch
---

Scene hierarchy rows now expose exactly their own name as visible text. A parent row used to contain its children's rows, so assistive technology and axe-core read an expanded parent's text as its name plus every child's name, which fails WCAG 2.5.3 (Label in Name). The child group is now a sibling of its parent row and is owned through `aria-owns`, so the accessibility tree keeps the same tree > item > group > item shape. With that fixed, `@axe-core/playwright` moves to 4.14.0, whose accessibility audit runs that check by default (#10465).
