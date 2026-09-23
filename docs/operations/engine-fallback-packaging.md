# Engine fallback packaging

Every staging and production web deployment includes four same-origin engine
packages: WebGL2 and WebGPU, each with editor and stripped runtime variants.
They provide the fallback when the primary engine CDN cannot be reached.

The CD WASM job runs for web changes as well as engine changes. It restores the
exact four-variant cache keyed by engine sources, the transform-gizmo dependency,
wasm-bindgen version, and CD recipe. A hit skips Rust setup and compilation.

The first CD run after an engine merge cannot hit that cache, because the
engine tree is new to main. On that miss the job looks for the merged pull
request's CI run instead. Quality Gates uploads that run's four packages as
`wasm-binaries-cd-reuse`, captured before `wasm-opt` because CD ships
unoptimised bytes. It also records a `ci-reuse` key covering the engine inputs,
both workflow recipes and the wasm-bindgen installer.
`scripts/resolve-ci-wasm-artifact.sh` adopts the packages only when that key
equals the one recomputed on main and every package validates. A fork, a
failed or skipped WASM build, an expired artifact, a lookup error or a key
mismatch each produce a `::notice::` naming the reason, and the job builds.

Any other miss builds and verifies all four packages before saving or
publishing them. The separate WebGL2 cache warmer runs only when this job does
not, preventing duplicate builds on a cold key.

Staging and production require the current run's wasm-binaries artifact.
scripts/populate-engine-fallback.mjs validates every exact JS glue and WASM
dependency before replacing web/public/engine-pkg-* directories. Manifest
generation follows packaging. Missing or corrupt packages fail deployment;
artifact errors and upload validation cannot be skipped.

The Vercel dry upload must contain all twelve non-empty dependencies: JS, WASM,
and wasm-manifest.json for every variant. Production smoke checks then verify
those same-origin URLs, MIME types, and manifest fields against the deployed
build. During rolling releases the existing canary cookie pins those checks to
the new deployment.

Local validation:

~~~bash
bash scripts/__tests__/engine-wasm-cache-key.test.sh
bash scripts/__tests__/resolve-ci-wasm-artifact.test.sh
bash scripts/__tests__/assert-vercel-engine-manifest.test.sh
bash scripts/__tests__/generate-wasm-manifests.test.sh
~~~

A CD recipe change invalidates the four-variant cache once. Later web-only
releases reuse verified engine bytes instead of rebuilding unchanged sources.
