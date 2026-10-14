# Half-margin formal driver v2: explicit dependency preparation

This directory records a **static** harness repair. No browser or dependency
optimizer was started by this task. Runtime success remains to be established
by a new complete formal run. Production source and the external half-margin
gate are unchanged.

## Preserved startup failure

The original `mip-half-abba` sequence contains two complete arms and a failed
third arm. [The failure analysis](startup-failure-analysis.json) records the
original file SHA values and exact dependency records without modifying them.

In [candidate-B2/raw.json](../mip-half-abba/candidate-B2/raw.json), twelve
production imports resolved to:

```text
/tmp/sketch-mip-half-viewport-DqoIVi/.vite/deps/three.js?v=cd81ece1
```

The subsequent balanced loader import resolved to:

```text
/tmp/sketch-mip-half-viewport-DqoIVi/.vite/deps/three.js?v=4e647148
```

[The original log](../mip-half-abba/candidate-B2.log) records initial optimization
of `three`, subsequent discovery of `three/addons/loaders/GLTFLoader.js`, and
an optimized-dependency reload. The strict full-ID guard rejected this startup
before any third-arm cycles ran. Version queries remain part of module identity.

This demonstrates unstable canonical URLs during startup. The failed capture
has no final module graph or completed bundle snapshots, so it does not by
itself prove two independently executed Three class registries or a production
game defect. It fails the formal identity precondition. The two complete arms
remain useful preserved evidence, but do not constitute a complete ABBA result
or establish a candidate timing improvement.

This behavior follows [Vite 6's documented late-dependency discovery](https://v6.vite.dev/guide/dep-pre-bundling):
dependencies encountered after startup can trigger another prebundle and reload.

## New versions

The executed v1 files remain intact. The new
[provider](../../../../../../../scripts/art-card-mip-half-provider-v2.mjs) and
[viewport driver](../../../../../../../scripts/art-card-mip-half-viewport-proof-v2.mjs)
use the same setup in reference, production and candidate modes:

```js
optimizeDeps: {
  include: ['three', 'three/addons/loaders/GLTFLoader.js'],
  noDiscovery: true
}
```

The fresh temporary Vite root links `node_modules` to the same installed
dependency directory as the frozen source. This lets explicitly included
packages resolve from that temporary root, without changing the installation.

In the installed Vite 6 source, `noDiscovery` selects
`createExplicitDepsOptimizer`. Its `init()` awaits optimization of included
entries, and `DevEnvironment.listen()` awaits that initialization. The driver
awaits `server.listen()` and then checks both completed entries **before
launching Chromium**. The installed source path, symbol lines and SHA are saved
in the analysis JSON; this conclusion is from source inspection, not an
executed optimizer test.

Startup evidence archives optimized entry/chunk bytes, SHA, metadata hashes
and complete IDs including `?v=`. The original runtime full-ID uniqueness guard
is retained. Final validation checks that optimizer metadata and bundle bytes
remain identical, and that every canonical Three import matches the completed
startup entry's full ID. Query removal is used only to locate a file on disk;
it is not used for the identity assertion.

The three standalone tools passed `node --check` before freezing. The provider,
draw paths, poses, frame facts, clocks and original measurement schedule retain
their definitions. The optional camera-v2 tool is only a prepared alternative;
the existing 31-camera correctness evidence is preserved, and no new camera
result is claimed here.

## New complete ABBA

Use the untouched source checkout `/tmp/sketch-stall-baseline-8345` and separate
fresh directories for production-A, candidate-B, candidate-B2, production-A2.
Run sequentially without tracing or concurrent heavy work.

```bash
node --import tsx scripts/art-card-mip-half-viewport-proof-v2.mjs \
  --source /tmp/sketch-stall-baseline-8345 \
  --candidate-source /tmp/card-mip-half-margin-candidate.ts \
  --mode production --scene mixed --hidden 0 \
  --cpu-frames 60 --real-frames 12 --repeats 2 --paced --skip-simulation \
  --out docs/art/refactor/followup/card-streaming/stall-followup/mip-half-abba-v2/production-A/raw.json
```

Change only `--mode` and the arm's new output directory for the remaining arms.
Require completed startup/runtime/final identity checks, strict pixel/fact/clock
comparison and all four arms before reporting aggregate timings. Preserve any
failure as a failure. Partial resource savings do not establish whole-frame
benefit or resolve the remaining long-tail stalls.
