# Reproducible art baseline

Baseline source is detached commit `9819046` in `/tmp/sketch-art-baseline`. Refactor evidence belongs under `after/`; never overwrite `before/` with modified source. The three art scripts must be copied unchanged into both trees. Both use the same installed `node_modules` and `/usr/bin/chromium`.

```sh
node --import tsx scripts/art-catalog-review.ts docs/art/refactor/after/catalog
node --import tsx scripts/art-canvas-benchmark.ts --out docs/art/refactor/after
node --import tsx scripts/art-browser-benchmark.mjs --all-units --out docs/art/refactor/after/webgl-all-units.json --screenshot docs/art/refactor/after/webgl-all-units.png
node --import tsx scripts/art-browser-benchmark.mjs --out docs/art/refactor/after/webgl-full.json --screenshot docs/art/refactor/after/webgl-full.png
node --import tsx scripts/art-browser-benchmark.mjs --dynamic --out docs/art/refactor/after/webgl-dynamic.json --screenshot docs/art/refactor/after/webgl-dynamic.png
node scripts/art-compare.mjs docs/art/refactor/before docs/art/refactor/after docs/art/refactor/comparison.json
```

Run benchmark processes sequentially. Shared-host load still introduces noise: individual differences, especially small ones, are not device-wide performance claims. Preserve raw per-frame samples, all run means, Chromium version and hashes rather than choosing the best run.

## Canvas

A real 26-unit cavalry battle runs 600 frames at deterministic 30 FPS timestamps, 20 simulation ticks per second, 1280×720 with fixed camera `(1410,1688)`, zoom 1. Four complete sequential matches use the real `stepGame`, `snapshotGame`, facing/motion/animation trackers and `drawWorld`. Run 0 is process/cache warmup, runs 1–3 are measured. Each records simulation, snapshot, render, total CPU frame time, process memory, and deterministic simulation hashes every 60 frames. PNG export is outside timing. GC is not forced, and process heap/RSS is not allocation rate. Five screenshots include opening, contact, battle and remains. The sampler does not simulate browser scheduling or presentation cadence.

## WebGL

Reuses the repository's real 280-unit/24-ship browser fixture, model loading, selection/gangway/deck, disposal and 72 interaction validations. `--all-units` replaces the 160 shore troops with every land-unit catalog kind cyclically; other load and geometry remain fixed. It does not artificially remove visible geometry.

For each of six layer lifetimes, 12 draws warm GPU resources, followed by 60 real draws at fixed 60 FPS animation timestamps. Each sample records CPU draw submission and total time including `gl.finish()`; completion runs on Chromium ANGLE **SwiftShader software GPU**. This is not hardware GPU time or display FPS. No simulation executes during these snapshot draws. Existing 120 static plus 120 changed-snapshot CPU draws are still separately measured with `renderer.render` disabled. Resource/model counts, draw calls, triangles, heap after requested GC and complete disposal assertions are preserved. Refactored card-cache stats are sampled when exported.

## Catalog review

All 57 unit cards, all 57 remains, 14 building cards, 17 item definitions, corresponding unit/building portrait paths, and five modes × six frames × 57 units are rendered from the actual Canvas painters. Catalog key lists are stored in `inventory.json`. Native naval world geometry is reviewed in the WebGL scene; the catalog contains its separate Canvas icon representation. Contact sheets test silhouettes, frame progression and cropping; they do **not** alone prove animation timing, target contact, equipment switching or full-match behavior.

## Limits

No physical GPU is available in this environment. `gl.finish` intentionally removes pipelining to measure completion; it cannot establish refresh-rate stutter or user-visible FPS. Full wall-clock presentation/jank and hardware GPU memory require a device run. Browser JS heap, renderer object counts, and explicit cache byte estimates are distinct metrics, not a substitute for one another. Record remaining visual defects honestly after reviewing generated screenshots.

## Dynamic 1000-unit replay

```sh
node --import tsx scripts/art-browser-benchmark.mjs --dynamic --out docs/art/refactor/after/webgl-dynamic.json --screenshot docs/art/refactor/after/webgl-dynamic.png
```

`art-dynamic-fixture.js` creates 1,000 actual units, two 500-unit armies cycling through all land catalog kinds. Units start at 75% HP and receive normal attack-move orders. Real `setAutocast` commands disable healing initially and re-enable it before tick 20, ensuring actual healing casts overlap the sampling window; no cooldowns or animation events are fabricated. Sixty real simulation ticks are generated once, serialized and SHA-256 hashed; each of three render lifetimes advances fresh animation, facing and motion trackers at 50ms timestamps through four warmup ticks (16–19) and twelve measured ticks (20–31). Simulation precomputation timings are recorded separately and excluded from render timings. Each frame records conservative visible-center counts and observed animation-mode counts, so unsupported/inactive actions cannot silently be called covered. The fixed camera is `(700,500)`, zoom 0.75, 1280×720. Completion samples include tracker update and render; selection construction and facing lookup setup are excluded consistently in both revisions. This is a 3-second combat interval, not a long-game memory leak test.

Dynamic frames yield to `requestAnimationFrame` before drawing, and record its callback timestamp intervals separately. These intervals include browser scheduling and shader/upload stalls on the software GPU; they are useful headless frame-pacing evidence, not hardware display FPS. The original synchronous 60-frame loop timed out at 90s and 180s in this stress case; failed diagnostics are in `work/art-refactor/`, excluded from formal before/after results.

The shortened stress run records **36 measured samples** across three fresh layers, all 1,000 starting units at unchanged quality. Report raw values, p50/p95/max and stall counts; this is too small a sample for a stable p99 claim. The reduction affects sampling duration only. Per-cycle CDP timeout is 300s.

Dynamic JS heap includes the intentionally retained sixty simulation snapshots and three disposed layer references. Its absolute size is a fixture footprint, not the memory requirement of a live match. The same retention applies to both revisions. New card statistics estimate texture storage and rasterization/copy work; they do not claim measured driver GPU bytes or upload-call counts.

## Final-version and diagnostic entry points

The original commands above preserve the rules-1 protocol. For rules 2, use a fresh output directory and `--final-art` on the Canvas and browser benchmark scripts to include the production combat/projectile trackers. Do not overwrite archived evidence. See [final cost and coverage](final-performance/RESULTS.md).

`final-performance/diagnostic-gc/reproduce.mjs` and `final-performance/diagnostic-yield/reproduce.mjs` are separately labeled lifecycle experiments. They do not modify production source and must not replace formal no-GC synchronous results. The latter yields outside all timed sections, so reported drawing time is not wall-clock frame pacing. Native readback microbenchmarks and their exact backend/environment are preserved under `final-performance/diagnostic-native-canvas/`.
