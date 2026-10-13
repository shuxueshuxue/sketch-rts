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
