# Second optimization measurement

Keep the first frozen report, its `before/` and `after/` directories, and `comparison.json` unchanged. The first refactor revision is `78ee99a`; the original pre-refactor revision is `9819046`. The next measured source must be committed and frozen before execution. No unit-consolidation, new combat, direction or blood changes from the separate rules worktree belong in this comparison.

## Primary comparison

Use the same `art-canvas-benchmark.ts`, `art-browser-benchmark.mjs`, `art-dynamic-fixture.js` and `art-compare.mjs` as the first measurement. Save all new output beneath `optimization/after-<commit>/`.

Run sequentially during an agreed exclusive performance window:

1. Canvas: four actual 600-frame cavalry matches; retain cold run and warmed runs separately, all simulation hashes, allocation counters and RSS.
2. WebGL dynamic: three lifetimes, four warmup snapshots and twelve measured snapshots each, 1000 starting units, identical camera/selection/resolution, simulation hash and animation-mode counts.
3. WebGL all-land-kinds: six lifetimes, twelve warmup draws and sixty measured draws; retain the original frame-46 cold-pose event and all outliers.
4. WebGL naval: identical six-cycle method.
5. Run `art-compare.mjs` against the existing `after/` (78ee99a), writing `optimization/comparison-refactor-to-<commit>.json`; separately compare existing `before/` (9819046), writing `optimization/comparison-original-to-<commit>.json`.

The existing before measurements were taken earlier on the same host/browser, not interleaved with this revision. Preserve that temporal limitation and all per-cycle distributions. In addition to the comparator's existing guards, confirm that mode counts, visible counts and 60-tick hash are identical between 78ee99a and the optimization revision, since this revision should only change raster storage/readback.

Report full fenced rendering, CPU submission, Canvas sim/snapshot/frame cost, cold-run behavior, raw long frames, rAF intervals, rasterization count, page/card/texel counts and estimated texture bytes. Existing tools only capture end-of-window card counters; they cannot establish per-frame cache hit/eviction counts. Do not infer those from the timing curve. Do not claim stable dynamic p99 from 36 samples.

## Existing controlled cold-pose evidence

`raster-profile.json` measures the same 512px authored poses with pooled scratch canvases, eight warmup paints per arm and ABBA order. Each arm has 50 measured paints. The two `willReadFrequently:false` runs average 34.690 and 18.106 ms total (34.192 / 17.662 ms synchronous readback); the two `true` runs average 2.028 and 1.952 ms total (1.754 / 1.714 ms readback). These are per-pose microbenchmarks, not frame-rate results. The two false arms differ materially, so retain both rather than selecting one as representative.

The raster-profile report's `passed:true` means the script completed without runtime errors, **not pixel parity**. CPU-vs-GPU scratch raster output has mean channel difference 0.158 / max 255, alpha max 150, and composited mean 0.162 / max 98.99. The backend switch is not pixel-identical.

`cropped-gpu-proof.json` isolates cropping/reconstruction using the same CPU scratch source: all four source RGBA reconstructions have zero changed channels. However the rendered directional-depth and point-distance comparisons still fail the strict maximum-channel-difference ≤ 1 gate: maxima 113 / 95, means 0.006739 / 0.004905, changed pixels 1467 / 1453 of 262144, GL error zero. Keep the failed gate visible. Exact source preservation does not establish exact filtered/mipmapped GPU output.

## Status

Prepared only. Do not start measurement until the parent confirms the source commit and exclusive performance window. Do not replace this note with a performance-success claim before the full run and visual checks complete.
