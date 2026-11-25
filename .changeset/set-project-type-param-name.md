---
"web": patch
---

Fixed `set_project_type` being unusable over MCP. The command manifest spelled its one parameter `project_type`, but the engine reads `projectType`, so every MCP call was answered with "Missing projectType" and the project never switched between 2D and 3D. The parameter is now `projectType` in all three manifest copies, matching the engine and every other 2D command. A new test compares each sprites/2D command's manifest parameter names against the keys its engine handler reads, so a mismatch like this fails at PR time.
