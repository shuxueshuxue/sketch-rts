# Raster optimization: a62c95b

**Timing qualification (follow-up):** the historical WebGL `gl.finish()` samples below record submission plus driver backpressure; they do not independently establish complete GPU execution. Sync-object diagnostics on frozen 9de move seconds into the completion tail. Original values are retained. See [completion and stage evidence](../followup/performance/UPLOAD-EXPERIMENTS.md). No revised formal speedup is claimed.

Measured 2026-10-11 with the unchanged first-round scripts and exclusive host-load window. Source: `a62c95beea64b9f6e387fa61312ae35a02504330`. Raw output is in [after-a62c95b](after-a62c95b/); direct comparison against the first refactor is [comparison-refactor-to-a62c95b.json](comparison-refactor-to-a62c95b.json), and the same-rule original comparison is [comparison-original-to-a62c95b.json](comparison-original-to-a62c95b.json). The first-round results remain intact.

The CPU scratch readback and lossless source-texel cropping substantially reduce this environment's dynamic cost and eliminate the previous fixed-snapshot long-frame pattern. **The 1000-unit dynamic target remains unmet: drawing still takes approximately 4.68 seconds per frame on SwiftShader.** This report does not cover the separate rules-2, direction or combat-ink worktree.

## Conditions and validation

Same Linux host, Node v24.19.0, Chrome/151.0.7922.173, forced ANGLE SwiftShader, 1280×720 DPR1, cameras, samples and selection as [the original method](../MEASUREMENT.md). All Canvas checkpoint hashes and the complete 60-tick browser replay hash match both earlier revisions. Compared with 78ee99a, every dynamic visible-count array and all action-mode totals match across all three cycles. Rendering code changed but simulation and animation inputs did not.

Both comparator runs passed. Dynamic resource/interaction validation passes 36 cases; each static scenario passes 72. Every model installs once; recorded browser/shader/network errors are empty and disposal assertions pass. These are sequential measurements made at different times on the same host, not randomized interleaved full-render ABBA trials. The separate cold-pose microbenchmark does use ABBA.

## Rendering results

Times are milliseconds; browser figures include CPU updates/submission and `gl.finish` completion. Columns show mean / p50 / p95 / max. Cold and warm Canvas runs remain separate.

| Scenario | 78ee99a | a62c95b | Mean change |
| --- | --- | --- | --- |
| Canvas warmed render, 1800 samples | 0.733 / 0.736 / 0.998 / 6.035 | 0.738 / 0.747 / 0.978 / 6.370 | +0.8% |
| Naval fixed snapshot, 360 | 3.794 / 3.200 / 6.500 / 41.100 | 3.449 / 3.200 / 5.400 / 12.100 | −9.1% |
| All land kinds fixed snapshot, 360 | 44.437 / 3.500 / 7.000 / 2490.300 | 3.650 / 3.300 / 5.700 / 13.300 | −91.8% |
| Dynamic 1000, 36 | 12741.058 / 12689.200 / 14214.800 / 14414.100 | 4679.897 / 4761.900 / 5212.100 / 5300.800 | −63.3% |

Relative to original 9819046, naval mean changes −2.7%, all-land-kind mean −21.8%, and dynamic mean −67.0%. Original-to-current dynamic animation-mode distributions differ; that comparison is the entire new presentation system, not isolated batching. The 78ee99a-to-a62c95b dynamic mode distribution is identical.

All-land-kind sample index 46 no longer produces a seconds-long spike in any cycle. Both new static groups have zero samples over 16.67 or 33.33 ms. Dynamic still exceeds both thresholds in all 36 samples, with requestAnimationFrame interval mean 4655.4 ms and max 5299.9 ms. Submission mean is 4679.869 ms versus fenced 4679.897 ms: synchronous work remains inside the draw path. The 36-sample dataset cannot support stable p99 inference.

Canvas first/cold 600-frame run mean is 2.570 → 2.620 ms; warmed whole-frame mean is 0.81978 → 0.81967 ms. Warm sim mean is 0.06090 → 0.05862 ms and snapshot mean 0.02571 → 0.02202 ms; this is timing variance, not a simulation optimization. No Canvas render-speed improvement is demonstrated.

Existing CPU-only changed-snapshot samples are also retained: all-land-kind cycle means fall from 515–562 ms to 28.7–32.2 ms, and naval from 108–126 ms to 4.05–5.08 ms. These exclude `renderer.render`, include actual pose/cache work, and must not be advertised as browser FPS.

## Card storage and cold poses

Final measured-frame statistics, identical across cycles:

| Scene | Page texels 78ee → a62 | CPU bytes 78ee → a62 | Rasterizations 78ee → a62 | Calls 78ee → a62 |
| --- | --- | --- | --- | --- |
| Naval | 9437184 → 4718592 | 37748736 → 18874368 | 131 → 131 | 59 → 59 |
| All land kinds | 16777216 → 10223616 | 67108864 → 40894464 | 243 → 243 | 73 → 75 |
| Dynamic | 180355072 → 113246208 | 721420288 → 452984832 | 5021 → 4720 | 98 → 108 |

Dynamic page allocation falls 37.2%; estimated GPU texture storage including mipmaps falls 961893718 → 603979776 bytes. Rectangular size buckets use 48 pages and retain 768 cards (previously 43 pages / 688 cards); more page objects do not imply more bytes. Triangles remain 6556. Copied layers remain zero. The 113246208 texel working set still exceeds the 12×1024×1024 soft budget ninefold. Only end-of-window cumulative counters exist; this does not measure per-frame misses or eviction sequences.

The controlled 50-pose ABBA profile, [raster-profile.json](raster-profile.json), separates paint/readback/copy costs. `willReadFrequently:false` total means are 34.690 and 18.106 ms; `true` means 2.028 and 1.952 ms. Most difference is synchronous readback. Keep both false arms: substantial variability prevents choosing only the slower one. The microbenchmark is not a full-frame result.

Canvas scratch requests and retained cache stats are exactly unchanged from 78ee99a: 269 requests / 28383880 requested RGBA bytes; 267 retained entries / 27073160 bytes, 62037 hits, 267 misses, zero evictions. End Canvas process RSS is 636690432 → 635678720 bytes without forced GC, still much larger than original 408330240. Dynamic final JS heap after GC is 42402148 → 42613664 bytes. Neither establishes total-process or driver-memory improvement; explicit card bytes describe only texture storage.

## Visual limitations

Root reviewed the first-refactor and optimized dynamic screenshots side by side: no obvious missing silhouettes, weapon details, formations or visible contents were observed. This is manual inspection, not pixel equivalence.

CPU-versus-GPU scratch antialiasing differs (profile mean channel difference 0.158, maximum 255; composited mean 0.162, maximum 98.99). Within the same CPU raster source, crop reconstruction is RGBA-exact in all four tested cases. Nevertheless [cropped-gpu-proof.json](cropped-gpu-proof.json) still has `passed:false`: directional/point filtered-render maxima 113/95 exceed the strict ≤1 gate, means 0.006739/0.004905, GL error zero. Preserve these separate findings; do not claim the backend switch or final filtered image is pixel-identical.

Remaining: dynamic rendering is still seconds per frame; its texture working set is still large; strict filtered-pixel parity remains unresolved; hardware GPU performance and memory have not been measured. Subsequent rules/direction/combat additions require their own cost record with production trackers connected and cannot be folded into these same-rule speedup percentages.
