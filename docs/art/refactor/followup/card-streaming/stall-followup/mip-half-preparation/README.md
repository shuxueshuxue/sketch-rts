# Half-level mip residency candidate: prepared, not rendered

This preparation is tied to source `8345a0dcfeb96b6777ac3940ec64cba13816c851`.
No production source was changed by this task, no browser was started, and no
new pixel-equivalence or performance result is claimed. The [static manifest](static-check.json)
records `node --check`, exact provider bytes, and the older prototype reclassification.

The external provider `/tmp/card-mip-half-margin-candidate.ts` is the complete
current `card-mip-residency.ts` with exactly one expression change:

```diff
- Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-1)
+ Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-.5)
```

SHA-256: `c607b1ac8c87f075b02444cc7e83c84fd728de3b4d7fc6e43da5c0cd5b408022`.
The archived [candidate](candidate-half-gate.ts), [production gate](production-gate.ts)
and [full-reference gate](full-reference-gate.ts) retain the entire module.
Full reference changes only the final computed `base` to zero, preserving the
footprint calculation. It does not replace a `World3DLayer` instance method.

## Capture and comparison

The independent camera driver reuses the exact original bank-camera entry,
held-scene fixture, 31 input records, captures and picking probes. Both modes
keep the original bank helper configured as one bank / `mips=native`. The
complete pre-resolved gate selects actual residency. No shader, UV, geometry,
animation, facts, clock or per-frame wrapper is changed.

The source must have HEAD at 8345 and unchanged tracked `src` and `public`.
Preserve ongoing changes in the shared worktree before restoring it for a
capture, or supply another clean checkout of that commit with the same installed
dependencies. Evidence directories are exclusive: reruns require a new path.

```bash
node --import tsx scripts/art-card-mip-half-camera-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --candidate-source /tmp/card-mip-half-margin-candidate.ts \
  --mode reference \
  --out docs/art/refactor/followup/card-streaming/stall-followup/mip-half-camera/reference/proof.json

node --import tsx scripts/art-card-mip-half-camera-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --candidate-source /tmp/card-mip-half-margin-candidate.ts \
  --mode candidate \
  --out docs/art/refactor/followup/card-streaming/stall-followup/mip-half-camera/candidate/proof.json

node --import tsx scripts/art-card-mip-half-camera-proof.mjs \
  --compare docs/art/refactor/followup/card-streaming/stall-followup/mip-half-camera/reference/proof.json \
  --with docs/art/refactor/followup/card-streaming/stall-followup/mip-half-camera/candidate/proof.json \
  --out docs/art/refactor/followup/card-streaming/stall-followup/mip-half-camera/comparison.json
```

Comparison uses every native PNG RGBA byte, untouched WebGL drawing-buffer
hash, full composite hash, physical dimensions, facts, clocks and picking.
It checks first-frame zoom promotion and camera return without extra warmup.
Rendered shadow contributions are included in the actor/composite images;
this driver does not independently read every packed-depth shadow-map texel.
Resource counters may differ. Zero differences must be measured rather than
assumed.

`--mode production` additionally captures the current one-level gate with the
same balanced provider setup. Compare production versus candidate to isolate
the half-level gate change; reference versus candidate compares full-chain and
half-level residency.

## Provider and dependency evidence

The Vite `enforce:pre` resolver redirects only `World3DLayer`'s gate import. It
serves the selected complete gate from run-start bytes. Relative dependencies
of the external module resolve through the original gate location, including
`../../shared/ship-geometry`. All public `three` requests resolve through the
same current `World3DLayer` importer.

Each capture archives all tracked `src` bytes, the three gate providers, loader,
driver, parent driver and nine original runtime helpers with SHA-256. The
loader imports all three complete providers before initialization in every mode,
checks their actual exported function fingerprints and a CPU geometry probe,
and records its own policy. There is no measured-frame observation.

Raw evidence includes resolve records, served-module hashes, the full Vite
module graph, unique current-context public Three identity, third-party module
hashes observed by the loader, and end-of-run source/provider/helper checks.
Three cache IDs may legitimately differ between independent browser/server
lifetimes; uniqueness is checked within each context. `node --check` does not
validate these runtime claims. The static manifest explicitly records that
runtime resolution and rendering have not yet been tested.

## Subsequent formal measurement

After pixel validation, the viewport adapter retains the original mixed
fixture's 18 real preparation draws, 60 CPU warmups, 60 measured CPU frames,
12 complete real frames, pose-stream jump and fresh/empty/returned captures.
It also supports the existing canonical 360 CPU / 18 real schedule. Run arms
sequentially without other browser, trace, test or archive jobs.

Example arm, suitable for an original/candidate/candidate/original sequence
with separate output directories:

```bash
node --import tsx scripts/art-card-mip-half-viewport-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --candidate-source /tmp/card-mip-half-margin-candidate.ts \
  --mode production --scene mixed --hidden 0 \
  --cpu-frames 60 --real-frames 12 --repeats 2 --paced --skip-simulation \
  --out docs/art/refactor/followup/card-streaming/stall-followup/mip-half-viewport/production-A/raw.json
```

Report complete CPU and real-frame distributions, stalls, actual Canvas
misses, upload bytes/calls and owned resource peaks/endpoints. Do not add this
experiment's percentages to previous independent optimizations.

The existing 135-row `card-bank-gpu-proof.mjs` matrix uses fixed `config.drops`
and never calls `cardBaseMip`. It cannot establish half-margin correctness by
being rerun unchanged. A new adaptive matrix would require an explicit gate
fixture and actual per-pass decisions; its perspective point-shadow pass must
retain mip zero. No such matrix adapter is claimed here.

## Eligibility and portability limits

Living cards include actual color physical pixels and the updated 2048px
directional shadow camera; remains use the color pass. Unknown/perspective/
singular projections, exact NPOT rebasing, the cap of four and the 1% numerical
allowance retain their current implementation.

The [Khronos anisotropic extension](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_texture_filter_anisotropic.txt)
permits implementation-dependent filtering. The
[OpenGL ES 3.0 specification, §3.8.10.5](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)
does not fix a mip-generation filter. The half-level bound therefore remains
a candidate requiring actual color/shadow testing. SwiftShader results do not
establish hardware equivalence or hardware frame rates.

The existing cache reuses finer resident chains when they already satisfy a
request. A tighter gate does not demote those warm resources immediately;
memory changes primarily concern new or rebuilt cards. Fresh, warm and returned
states must be reported separately.

The older 96-row prototype reclassified offline gives 8 / 12 / 22 eligible
rows at margins 1 / 0.5 / 0 with the additional 1% allowance, all matching its
original color and shadow images. That historical observation is only a reason
to test this candidate; it does not validate current 8345 rendering.
