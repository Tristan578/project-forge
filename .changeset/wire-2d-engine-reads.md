---
"web": minor
---

Three 2D engine reads that were armed but unreachable now have producers:
`get_joint_2d`, `list_joints_2d` and `get_camera_2d`. The engine has answered
`QueryRequest::Joint2dState`, `ListJoints2d` and `Camera2dState` all along and
no TypeScript handler dispatched them, so nothing could ask for them from chat
or over MCP. Like the `get_*` handlers beside them they read the store, which
the engine keeps current, so the answer is synchronous.

`get_camera_2d` reports the **absence** of a camera rather than an empty
object: "no camera" and "a camera with no settings" are different answers.
