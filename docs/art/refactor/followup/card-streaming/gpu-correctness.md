# Full-domain streaming GPU correctness

Both frozen baseline (`f87c3b7`) and candidate passed the same browser fixture on
Chromium WebGL2 / SwiftShader. This is a correctness test, not a frame-rate or
GPU-performance measurement.

The fixture creates an independent full-domain `DataArrayTexture`, uploads its
complete encoded RGBA source and lets WebGL generate its native sRGB mip chain.
It then compares the production uploader's result by attaching the actual array
layer and mip to a test-only read framebuffer and calling `readPixels`. It reads
raw encoded RGBA storage, including nonzero RGB at alpha zero; no shader color
decode/re-encode, alpha masking or image tolerance is used.

Across 256, 320, 512, 640 and 704 pixel domains, fresh construction, recreation
and context restoration, there were **2,144 layer/mip comparisons**, plus **488
layer/mip compaction comparisons**, covering **429,211,732 RGBA components**.
Every comparison had zero changed channels. The two result files record each
oracle and candidate layer/mip SHA-256, dimensions, source-file hashes, fixture
hash and browser details. The fixture hash is identical between runs.

Covered operations:

- A completely zero first source, followed by gradients and thin opaque lines.
- Colored transparent pixels and a change of one RGB component with alpha
  remaining zero. On the 704 case this submitted one 1 × 1 rectangle (4 bytes)
  and regenerated the original complete native mip chain correctly.
- Shifted markings and complete clearing of old pixels to zero.
- Exactly repeated RGBA submitted to a different destination layer. The
  candidate made zero scratch `texSubImage2D` calls and zero mip generations;
  the destination array still received its complete, correct mip chain. The
  baseline performed the original complete upload and mip generation.
- Lossless GPU compaction into array depths 3, 7 and 14, as well as depth 4.
- The 640 and current 704 action-domain NPOT tails through their 1 × 1 mip.
- Restoration of the caller's current render target.
- Explicit uploader/page disposal and recreation, and context loss/restoration
  followed by fresh 704-domain resources, matching the world-layer invalidation
  contract. This does not assert that a stale, deliberately retained uploader
  automatically detects context restoration.

Both runs had no GL, console or network errors; all uploader scratch resources
were released by disposal. The candidate uploader SHA-256 tested was
`8ec3b0c5ad3ee2c91e2203e6a45b0925cadb650889393063050cd9f5b574ed39`.

Reproduce serially, without other browser benchmarks running:

```sh
node --import tsx scripts/card-streaming-gpu-proof.mjs \
  --source /tmp/sketch-card-streaming-baseline \
  --out docs/art/refactor/followup/card-streaming/gpu-proof-baseline.json

node --import tsx scripts/card-streaming-gpu-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out docs/art/refactor/followup/card-streaming/gpu-proof-after.json \
  --require-skip
```

The fixture uses public Three APIs for production transfers. Its test-only GL
instrumentation captures allocation handles from `texStorage3D` for exact
readback and counts real upload and mip-generation calls. It does not access
`renderer.properties`. Synchronous readback and instrumentation deliberately
make its elapsed time unsuitable for performance claims; use the separate
fixed-scene benchmark for resource and frame-time comparisons.

## Production original-mip tail contract

The later `gpu-proof-tail-production.json` reruns all N0 cases and additionally
calls the actual production uploader's `{sourceWidth,sourceHeight,baseMip}`
options for 256, 640 and 704 domains at N1 and N2. It compares destination mip
`L` directly with the independent full-domain oracle's original mip `N + L`.
The smaller array never regenerates its own mip chain, so the oracle does not
silently introduce a second filtering pass.

All six source/drop combinations and a fresh 704 N2 reconstruction after
context restoration passed. These extra tail cases alone provide **2,280
layer/mip comparisons**, **529 compaction layer/mip comparisons** and
**90,409,768 RGBA component comparisons**, all with zero changed channels.
They retain the original complete source raster for partial upload comparison,
transparent RGB updates, full clearing and identical-source suppression.

Each tail case also executes two recovery checks. Test-only interruptions are
thrown after a real public GPU copy has finished: first after the scratch's
partial base upload, and then after the first array mip copy. Retrying the same
RGBA must submit one full original-domain scratch upload, regenerate its
original native mip chain, increment the fallback counter and restore all
destination mip bytes. All **14 recovery checks** passed, including restoration
of the caller's render target. This deliberately injected exception is not a
claim of a natural driver failure or timing test.

The production uploader SHA-256 tested was
`3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295`.
The production-tail run had no GL, console or network errors. Baseline source
does not implement these new options; omit `--require-tail` when checking it.

```sh
node --import tsx scripts/card-streaming-gpu-proof.mjs \
  --source /workspace/sketch-rts-viewport \
  --out docs/art/refactor/followup/card-streaming/gpu-proof-tail-production.json \
  --require-skip --require-tail
```

This verifies stored mip bytes and transfer recovery. It does not by itself
verify that the per-frame residency gate chooses the right drop, that picking
keeps the full-source mask, or that camera/DPR changes promote resources before
drawing. Those require the separate full-presentation comparison and transition
probe.
