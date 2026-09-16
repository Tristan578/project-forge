---
"web": patch
---

Use independent native View and Like controls in community cards, removing nested interactive semantics while retaining card-wide pointer activation and like state announcements. Interactive star ratings are native single-choice radio groups with named choices, one selected value, arrow-key selection, and 44px targets; read-only averages announce once. Keep the game-details dialog and Close control mounted during loading and failure so focus, Tab trapping, and Escape dismissal work with stable callbacks.
