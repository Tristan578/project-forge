---
'@spawnforge/ui': patch
---

Use --sf-border-strong on interactive primitives (Avatar, Badge, Button outline, Input, Checkbox, Switch, Textarea, Select) and SettingsPanel checkbox for better border contrast across all themes. Add CI contrast audit (WCAG 1.4.11) to prevent silent regression. Fix light theme --sf-warning contrast (#ca8a04 -> #b8790a, 3.64:1).
