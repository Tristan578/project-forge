---
"web": minor
---

Say when a game-component value was not applied as asked. When the AI chat, an MCP client or the game generator asks for a value the engine will not hold (a platform speed of 99999, a 300-point patrol route), the tool result now lists each adjustment ("Moving Platform speed: you asked for 99999, it was capped at 1000"), the chat card shows it without expanding, generation steps report it as a warning, and the inspector marks the adjusted field with the requested value still readable. Nothing is reported when every value was used as given.
