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
| `pkg-webgl2` | 23,480,588 B (22.4 MiB) | 23 MiB | 25.3 MiB |
| `pkg-webgpu` | 23,903,062 B (22.8 MiB) | 23 MiB | 25.3 MiB |
| `pkg-webgl2-runtime` | 21.0 MiB | 22 MiB | 24.2 MiB |
| `pkg-webgpu-runtime` | 21.4 MiB | 22 MiB | 24.2 MiB |

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
