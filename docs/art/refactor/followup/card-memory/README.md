# Streamed cards without persistent CPU RGBA pages

Production implementation and correctness verification are complete. Formal
large-scene performance/memory comparison is pending; this document does not
claim measured process-memory savings or gameplay FPS improvements.

## Single production lifecycle

`PaintedCardBatches.finish(renderer)` now streams unique cache misses after all
warm references have been protected. Each miss is painted once, read once, and
converted to the exact existing alpha>=102 picking bitset. Its Canvas RGBA rows
are flipped **in place**, using one reusable row buffer. The ordinary GPU scratch
texture generates all original sRGB/alpha mips; public copies fill the array
layer. The readback is released immediately afterward. There is no second full
flipped image, whole-frame RGBA queue, retained paint closure, or CPU-only render
fallback. Test mocks explicitly implement the same public transfer contract.

Array textures use `image.data=null`, `source.dataReady=false` and complete mip
allocation descriptors. Every occupied layer still has its original source size,
filtering, anisotropy, alpha and complete mip domain, including NPOT320/640.
No original geometry, shadow sampling, content, simulation or combat rule changes.
Empty cards retain the existing 16px allocation. Non-pickable remains skip masks.

Severe-fragmentation compaction first allocates destinations without publishing
new cache identities. All source layers have already been uploaded. Every mip
is copied array-to-array with explicit source/destination layer and level. Only
after all copies are submitted are mappings committed and sources disposed.
GPU command ordering preserves those submitted reads. A thrown copy discards
uncommitted destinations and retains the original maps/masks. Copying moves
masks by reference, never by rerasterization. Pending requests and pixel counters
are cleared on painting/upload failure; reset/loss/dispose also clear resources.
Owned canvases are shrunk to 1×1 before release.

Context loss retains stage one's public cleanup of scene-owned GPU listeners,
then discards **both** card caches. The next normal frame freshly paints its
visible cards from snapshot/model/equipment state. There are no cached painters
or old CPU pixels used for recovery. Hidden/offscreen cards rebuild on demand.
Selection/facing/animation/simulation state remains independent of the cache.

## Correctness evidence

[SUMMARY.json](SUMMARY.json) records relevant source/test/fixture hashes.
[Focused log](focused-final.log): 45/45 tests pass, including packed alpha/UV
boundaries and mirrors, full source transfer, null pages, bounded streaming,
transaction failure rollback, paint/upload failure cleanup, and resource reuse.
[Global TypeScript check](tsc-final.log): exit 0.

[Production mip proof](production-mips.json): all four source sizes,
512/640/320/256, all 16 layers, every integer plus fractional LOD, dirty counts
1/4/16, and a fresh phase9 rebuild after context loss have zero RGBA/coverage
difference. Candidate CPU page data is null throughout. Its external oracle and
reference intentionally retain input data solely for comparison, not as part of
the production cache. No timing averages are claimed from this functional run.

Ten `strict-*.json` scenes provide twenty directional/point-shadow comparisons:
all maximum channel differences and changed-pixel counts are **zero**. The eight
existing near/minified/mixed-domain/filter scenes remain. Additional
[actual unit artwork](strict-real.json) uses production `paintFigure`, and
[real cache compaction](strict-compaction.json) warms 64 poses across four pages,
keeps three warm poses, paints one new pose, then GPU-compacts all four into one
page. All four mip chains remain identical after the move. The source gate is
preserved as a one-shot Canvas RGBA oracle before upload, followed by strict GPU
image comparison; it is now explicitly included in the proof pass condition.
No persistent CPU page is inspected or recreated for that gate.

[Actual WorldLayer context proof](world-context.json) uses a native ship, two
crew and their selection markers. Restored pixels match exactly; the real
`WorldLayer.pick` returns the same crew ID. The cache empties on loss and the
rasterization count rises from 2 to 4 on restoration, proving fresh visible
repainting. Reset, redraw and final disposal have zero GL errors and empty
public-delete diagnostics. Browser/console/shader errors are empty. Manual
review of [recovery](world-context.png) and [compaction](strict-compaction.png)
confirms matching ships, crew, silhouettes and black difference panels.

This recovery proof covers **two living cards**, not a bound on large-army
recovery stalls. Recorded first/restored completed-frame wall times include a
full-frame synchronous pixel readback and shader/resource reconstruction; they
are functional diagnostics, not a benchmark. The remains policy uses the same
implementation in a separate cache; the dedicated deck-remains proof separately
exercises that visible path in final regression.

## Statistics and honest comparison boundaries

`WorldLayer.cardStats()` describes the **living card cache**, not all scene
memory. `remainsStats()` describes the separate remains cache. Each reports:

- `arrayCpuBytes=0`; `maskBytes`, `pendingMaskBytes`, `pendingRgbaBytes` and
  `rowScratchBytes` track owned CPU buffers. `cpuBytes` includes these and the
  optional 1 KiB empty-layer buffer, but excludes mip scratch for compatibility
  with the existing benchmark consumer. `ownedCpuBytes=cpuBytes+scratchCpuBytes`.
- `canvasBackingBytes` is a separate width×height×4 estimate. Browser native
  canvas storage, driver copies, JS object overhead, GC delay and process RSS
  are not covered by these typed-array counters.
- `gpuBytes` deliberately preserves the stage-one `ceil(basePixels*4*4/3)`
  estimate. `allocatedMipBytes` is the exact sum of allocated mip dimensions.
  GPU source domains/storage have not been reduced. `ownedGpuBytes` includes
  initialized pages plus scratch; driver-deferred deletion is outside that
  ownership estimate.
- `retiredGpuBytes` and peak gauges include transient source/destination
  coexistence during compaction. The existing policy allocates at most half
  as many destination pages as source pages, bounding this same-domain page
  transient to 1.5× its pre-compaction allocation.
- Peak pending RGBA is one largest raster layer, independent of the number of
  misses. The scratch pool remains at most five dimensions per policy cache.
  `peakOwnedCpuBytes`, `peakOwnedGpuBytes` and `peakRetiredGpuBytes` are sampled
  at allocation/transfer transitions, not only at frame end.
- `rasterWorkWallMs` and `gpuTransferSubmissionWallMs` separate raster preparation
  and public GPU transfer calls. Both are wall times; the latter can contain
  previous GPU work/backpressure. Neither is a claim of pure-JavaScript cost.

Formal before/after runs must keep their overall completed-GPU timers and
scene/input hashes unchanged. Cold reconstruction and transient peaks matter;
steady-state page removal alone is insufficient evidence of memory improvement.

## Reproduce after reserving the GPU window

```sh
npx vitest run src/client/world3d/card-pick-mask.test.ts src/client/world3d/card-mip-uploader.test.ts src/client/world3d/painted-card-batches.test.ts src/client/world3d/world-layer.test.ts
npx tsc --noEmit
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --fixture scripts/card-mip-gpu-fixture.js --query 'repeats=0' --out work/memory-mips.json
node --import tsx scripts/painted-card-gpu-proof.mjs --query 'art=real&compact=mixed' --out work/memory-compaction.json
node --import tsx scripts/card-context-proof.mjs --out work/memory-context.json
```
