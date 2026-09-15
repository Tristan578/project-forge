---
"web": minor
---

Two local players can now each author an independent, rebindable input action map. The Input Bindings panel gains a Player 1 / Player 2 selector so a creator can add, rebind and remove actions for each player separately, and the same operation is available through the in-app AI commands (`set_input_binding`, `remove_input_binding`, `set_input_preset` all accept an optional player slot). At runtime, `forge.input.isPressed(action, player)` (and `justPressed` / `justReleased` / `getAxis`) resolve either player's state, so two players sharing one keyboard can be driven from distinct keys. Single-player scenes, scripts and saved projects are unaffected — an omitted player is always the primary player (slot 0), and a scene with no second player serializes exactly as before.
