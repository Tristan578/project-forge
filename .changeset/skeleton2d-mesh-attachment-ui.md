---
"web": minor
---

Add a mesh-attachment editor to the 2D SkeletonInspector. Creators can now define a skeleton2d mesh attachment — its vertices and the per-vertex bone weights that skin it — directly from the inspector under the selected skin, without dropping to chat or an MCP command. Apply adds new client-side validation that the `add_skeleton2d_mesh_attachment` command and chat path do not enforce (that path only checks that the vertex and weight counts match): an influence must name a real bone and every vertex must carry a positive total weight, both rejected with a clear message (never silently normalized) so the prior attachment is left unchanged. The store now models `weights` on mesh attachments and carries them through the engine round-trip, so authored skinning survives save/reopen instead of flattening every vertex to its bind position.
