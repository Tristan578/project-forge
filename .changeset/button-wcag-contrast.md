---
"web": patch
---

Fix primary Button (`variant="default"`) failing WCAG 2.1 AA text contrast across themes (#8742). The resting CTA now renders `--sf-on-accent` on `--sf-accent-hover` and steps to a new `--sf-accent-active` token on hover — white-on-accent themes darken, dark-on-accent themes brighten, so the label clears the 4.5:1 floor in both states for all 7 themes. The `leaf` theme's white on-accent (which failed even at hover) is swapped to a dark on-accent like its bright-accent siblings. Adds a per-theme regression test asserting `--sf-on-accent` contrast against the button's resting and hover backgrounds so this can't regress silently, and removes the interim AA override on the waitlist CTA.
