---
"web": minor
---

Wire the game win condition end-to-end. The engine now resolves `ReachGoal` (a CharacterController touching the goal target) and `CollectAll` (full collectible set) natively, sets the win state once, and queues a `game_win` event that the bridge drains to JS. A new `GAME_EVENT` handler flips the `gameWon` store flag, which paints a "You Win!" overlay in Play/Paused. Adds the `forge.game.win()/setScore()/getScore()/onWin()` script API (loop-guarded against the worker re-broadcast) so scripts can declare and observe a win. Requires a WASM rebuild to take effect in production.
