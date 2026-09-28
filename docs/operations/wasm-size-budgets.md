# WASM size budgets

The engine ships as four WebAssembly binaries. Every one of them is a download
somebody waits on, so every one of them has a size budget enforced in CI.

## The four artifacts

| Package | Feature set | Who downloads it |
|---|---|---|
| `pkg-webgl2` | editor, WebGL2 | an authenticated creator opening the editor without WebGPU |
| `pkg-webgpu` | editor, WebGPU | an authenticated creator opening the editor with WebGPU |
| `pkg-webgl2-runtime` | `runtime`, WebGL2 | **every visitor** to a published game, without WebGPU |
| `pkg-webgpu-runtime` | `runtime`, WebGPU | **every visitor** to a published game, with WebGPU |

The runtime pair is the pair that carries real traffic: it is uploaded to R2 and
served from `engine.spawnforge.ai` to anonymous visitors who have no reason to
tolerate a slow first paint. Until #9459 the size gate budgeted only the editor
pair, which put the ceiling on the side of the split that matters least.

## Current budgets

Enforced by the `Check WASM binary sizes` step in
`.github/workflows/quality-gates.yml`, which runs inside the `WASM Build` job of
the `CI` workflow whenever a PR touches `engine/`.

| Package | Measured (post `wasm-opt -Oz`) | Threshold | Fails above (+10%) |
|---|---:|---:|---:|
| `pkg-webgl2` | 27,023,317 B (25.8 MiB) | 26 MiB | 28.6 MiB |
| `pkg-webgpu` | 27,825,976 B (26.5 MiB) | 27 MiB | 29.7 MiB |
| `pkg-webgl2-runtime` | 26,077,179 B (24.9 MiB) | 25 MiB | 27.5 MiB |
| `pkg-webgpu-runtime` | 26,878,831 B (25.6 MiB) | 26 MiB | 28.6 MiB |

Measured on Bevy 0.19.1 by the `WASM Build` job of PR #10268 at `d85796cd`.
Why these are higher than before is recorded under [Budget history](#budget-history).

Each threshold is the measured size rounded **up** to the next whole MiB. The
step fails when a binary exceeds its threshold by more than 10%, and it checks
all four before exiting so a single run reports every regression rather than
only the first.

Sizes are also written to the job summary as a table, so a trend is visible
without opening the log.

### Why 10% and not tighter

The two measurement runs below were taken ~30 minutes apart on the same commit
of `main`. They differ by under 6 KB — about 0.03%. Build-to-build variance is
therefore nowhere near the tolerance: the 10% band is slack for a genuine,
intentional feature landing, not padding for noise. A binary that grows past its
limit has grown for a real reason and deserves the review.

## Re-measuring

Thresholds are measured, not guessed. To refresh them:

1. Find a **merged** PR that touched `engine/`, so its `WASM Build` job actually
   ran (the job is skipped otherwise):

   ```bash
   gh pr view <pr> --json statusCheckRollup \
     --jq '[.statusCheckRollup[] | select(.name == "Quality Gates / WASM Build") | .detailsUrl][0]'
   ```

   The job id is the trailing path segment of that URL. Note that
   `gh run list --workflow=quality-gates.yml` returns nothing — these jobs are
   reusable-workflow jobs of the `CI` workflow, not runs of their own.

2. Pull the log and read the sizes:

   ```bash
   gh api repos/Tristan578/project-forge/actions/jobs/<jobId>/logs
   ```

   The `Check WASM binary sizes` step prints exact byte counts for every
   package. The earlier `wasm-opt` step prints `$PKG: X MB -> Y MB` at 0.1 MiB
   resolution, which is the fallback if the size step itself is what changed.

3. Repeat on a second run of the same commit and confirm the two agree. If they
   diverge by more than a few KB, something is non-deterministic in the build
   and that is the bug to chase — do not raise a threshold to accommodate it.

4. Round each measurement up to the next whole MiB and update **both** the
   `check_pkg` calls and the comment table in `quality-gates.yml`, plus the
   table above.

## Raising a budget

Raising a number here is a product decision, not a build fix. In the PR that
raises it, say what shipped, what it cost, and why the download is worth it. A
threshold bumped to make a red gate go green is the failure mode this gate
exists to catch.

Reach for the alternatives first: feature-gate the dependency (see the `webgpu`
and `runtime` features in `engine/Cargo.toml`), keep heavy data out of the
binary, or check whether the growth landed in the runtime pair when it only
needed to be in the editor pair.

## Budget history

Every raise is recorded here with what shipped, what it cost, and why the
download is worth it, as [Raising a budget](#raising-a-budget) requires.

### 2026-09-26: Bevy 0.18.1 -> 0.19.1 (#8887, PR #10268)

**Owner-approved 2026-09-26.** The owner's decision was to take the migration
because it is the current engine, and to have the gate measure against the new
sizes rather than be bypassed.

| Package | 0.18.1 (CI) | 0.19.1 (CI, `d85796cd`) | Growth | Threshold |
|---|---:|---:|---:|---|
| `pkg-webgl2` | 23,480,588 B | 27,023,317 B | +15.1% | 23 -> 26 MiB |
| `pkg-webgpu` | 23,903,062 B | 27,825,976 B | +16.4% | 23 -> 27 MiB |
| `pkg-webgl2-runtime` | ~21.0 MiB | 26,077,179 B | ~+18% | 22 -> 25 MiB |
| `pkg-webgpu-runtime` | ~21.4 MiB | 26,878,831 B | ~+20% | 22 -> 26 MiB |

- **What shipped.** Bevy 0.19.1 on wgpu 29, with its co-bumped ecosystem crates
  (bevy_rapier 0.35, bevy_hanabi 0.19, bevy_panorbit_camera 0.35). 0.19.1 is
  the floor because 0.19.0 corrupts transparent meshes on the WebGL2 path.
- **What it cost.** 3.5 to 3.9 MB per binary, on all four, including the
  runtime pair every published-game visitor downloads.
- **Where it went.** Not into new dependencies: the graph gained 7 small crates
  and lost `bevy_scene`, with the same bevy features active. Before
  optimisation the growth is inside `bevy_ecs` (8.17 MB -> 11.74 MB), mostly
  per-type code Bevy generates for every resource and component, such as about
  642 KB of new `World::insert_resource_if_not_exists` instances (resources are
  components in 0.19) and about 714 KB more `EntityWorldMut` code. No feature
  flag we control removes it, and it lands in the runtime pair because the
  runtime has the same ECS.
- **Alternatives considered.** Feature-gating does not apply: the growth is in
  the ECS core every build needs. Staying on 0.18.1 keeps the engine a release
  behind and leaves 0.19's fixes out of reach. A dedicated size-reduction pass is
  still worth doing on its own merits; it is not a precondition for this raise.
- **Headroom.** Each threshold is the measured size rounded up to the next whole
  MiB, so every package keeps 10.6% to 11.9% to its fail line, the same policy
  as before.
- **Second-run check.** Step 3 of [Re-measuring](#re-measuring) asks for two
  runs of one commit to agree. Local builds with binaryen 108 (the package CI
  installs) came out within 0.2% of the CI numbers above. The CI numbers on the
  PR's final head, and a re-run of that job, are recorded in the PR.

