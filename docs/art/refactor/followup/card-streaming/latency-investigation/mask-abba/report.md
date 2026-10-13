# Mask packing: same-source ABBA

The production mask packer preserves the recorded pictures and resource behavior. Across four lifetimes per policy, mean CPU presentation time decreases from **44.305 to 43.226 ms (2.44%)**, and CPU p95 decreases from **143.1 to 123.8 ms**. This does not resolve the long tails: CPU p99 is essentially unchanged, samples above 100 ms increase from 31 to 32, and mean real-render completion wall increases from **435.006 to 445.204 ms (2.34%)**. The real-render p99 also increases. These results support a bounded CPU optimization, not a claim that battlefield rendering or its principal stalls are fixed.

## Isolation and validation

All four runs use source `aec09d620801dd07852042732831e5b2de1c4193`, one native-mip bank, and current production peak accounting. The chronological schedule is `original-A`, `production-B`, `production-B2`, `original-A2`. Each run has two independently recreated lifetimes, with 60 paced CPU samples and 12 real-render samples per lifetime. The mixed scene, hidden population 0, 1280 × 720 physical viewport, DPR 1, zoom 0.75, Chromium/SwiftShader environment, source artist code and fixture are common.

The original side selects the frozen `5b356c7795068bb2a532ad1d486b3c22936cf735` mask module through a Vite resolver restricted to the exact current `PaintedCardBatches` import of `./card-pick-mask`. Production follows ordinary resolution. Both mask modules are imported without invocation before sampling, and their public `cardMaskHit` function source is identical. Neither policy replaces the renderer, allocation, uploader, shaders, draw order, cache or peak methods. This compares two mask-packing policies on the current tree; it does not compare the whole historical renderer with the current game.

The [offline analyzer](analyze.mjs) verifies:

- Complete runs, zero browser/network/GL failures, disposal, original 60/12 schedule, and all **480 CPU sample ticks** on the `n=114..173`, `tick=floor(n/3)` grid.
- Common initial and final client-source SHA maps, source commit/diff, archived harness, parent harness, fixture, fact fixture, bank helper and viewport metadata. The 295 client-source entries remain identical across runs.
- Actual provider path and SHA, original-only redirect, baseline corpus SHA, untouched current batch SHA, and balanced module preparation. Baseline provider SHA is `c591b3b25b060342296b1ff3983494f3172d52707ea4a439e7531341f927a4ee`; production is `f968412c60a057452285291aa3001a702b22e3ba76ba6ab6606c353051de30fd`.
- **24 decoded PNGs at zero RGBA tolerance**, including alpha and RGB components, and their recorded PNG hashes. The corresponding PNG files also have identical raw SHA values across all runs.
- **8 visible-fact records**, their actual computed hashes, captured snapshot hashes and asset coverage.
- **24 before/empty/returned snapshots**, comparing every recorded non-timing field: card/page capacity, live and active layers, native mip bases, chunk capacities/render orders/bank-page assignments, memory, cache counts, peaks, raster/upload/copy/fallback counts, render calls, combat and viewport index facts.

The resource comparison excludes only explicit timing fields: phase `submissionMs`/`completeWallMs`, card `rasterStages`, `rasterWorkWallMs`, `gpuTransferSubmissionWallMs`, and raster-cache `workMs`/`avoidedPaintMs`. These excluded durations remain in the raw data and derived lifetime records; empty/returned wall and submission distributions are also included in the analysis. Poll/yield counts depend on completion timing and are reported as measurements rather than required to match.

All checks pass. Original raw input hashes are recorded and rechecked after analysis. The analysis does not modify the raw files or screenshots.

## Pooled distributions

Samples are concatenated across all four lifetimes per policy before computing percentiles. Quantiles are the sorted sample at index `floor(count × q)`, capped at the final sample; no lifetime quantiles are averaged. Durations are in milliseconds. Cold first-real samples remain in headline results.

| Measurement | Samples per policy | Original mean | Production mean | Original p95 | Production p95 | Original p99 | Production p99 | Original >50 / >100 | Production >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 240 | 44.305 | 43.226 | 143.1 | 123.8 | 496.7 | 496.9 | 83 / 31 | 79 / 32 |
| World3D CPU | 240 | 43.924 | 42.897 | 138.9 | 123.5 | 496.3 | 496.5 | 83 / 31 | 79 / 31 |
| Canvas/coordinator residual | 240 | 0.381 | 0.329 | 0.6 | 0.5 | 3.2 | 1.4 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 80 | 74.860 | 73.875 | 460.6 | 452.0 | 520.0 | 505.9 | 47 / 4 | 43 / 4 |
| Repeated CPU tick | 160 | 29.027 | 27.901 | 143.1 | 123.8 | 186.4 | 155.0 | 36 / 27 | 36 / 28 |
| Repeat phase 1 | 80 | 22.765 | 22.997 | 111.7 | 114.5 | 146.4 | 150.0 | 16 / 11 | 16 / 13 |
| Repeat phase 2 | 80 | 35.290 | 32.805 | 150.4 | 143.7 | 211.7 | 165.5 | 20 / 16 | 20 / 15 |
| Real completion wall | 48 | 435.006 | 445.204 | 1391.7 | 1353.1 | 1409.6 | 1443.5 | 48 / 48 | 48 / 48 |
| Real submission | 48 | 51.904 | 52.506 | 271.3 | 259.8 | 288.0 | 272.8 | 12 / 12 | 12 / 12 |
| Real frame-start interval | 44 | 464.270 | 473.289 | 1391.9 | 1357.5 | 1421.4 | 1447.0 | 44 / 44 | 44 / 44 |
| First cold real | 4 | 1387.100 | 1381.700 | 1409.6 | 1443.5 | 1409.6 | 1443.5 | 4 / 4 | 4 / 4 |
| Subsequent real | 44 | 348.452 | 360.068 | 1048.1 | 1119.2 | 1060.0 | 1170.9 | 44 / 44 | 44 / 44 |
| Fence wait wall | 48 | 383.094 | 392.685 | 1103.7 | 1093.3 | 1138.3 | 1190.9 | 48 / 48 | 48 / 48 |
| Fence-poll call wall | 48 | 0.358 | 0.350 | 0.9 | 1.4 | 1.1 | 1.9 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 48 | 382.573 | 392.154 | 1102.2 | 1092.2 | 1136.9 | 1189.4 | 48 / 48 | 48 / 48 |
| Empty-view completion wall | 4 | 62.000 | 66.975 | 70.8 | 72.9 | 70.8 | 72.9 | 4 / 0 | 4 / 0 |
| Returned-view completion wall | 4 | 1376.425 | 1391.300 | 1421.7 | 1549.3 | 1421.7 | 1549.3 | 4 / 4 | 4 / 4 |

Full CPU and World3D CPU are nested; the Canvas/coordinator row is a residual. They must not be added as three independent costs. Fence wait contains yielding and polling; those rows also must not be added. Real completion wall includes graphics completion and scheduler effects, and is neither pure GPU time nor a directly measured FPS value.

## Every lifetime

| Run | Lifetime | CPU mean | CPU p95 | CPU p99 / max | CPU >50 | CPU >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| original-A | 0 | 45.283 | 146.1 | 520.0 | 22 | 9 |
| original-A | 1 | 43.070 | 143.1 | 460.6 | 20 | 6 |
| production-B | 0 | 41.650 | 120.8 | 505.9 | 17 | 8 |
| production-B | 1 | 41.148 | 114.9 | 452.0 | 20 | 7 |
| production-B2 | 0 | 44.377 | 150.0 | 496.9 | 20 | 8 |
| production-B2 | 1 | 45.728 | 143.0 | 501.7 | 22 | 9 |
| original-A2 | 0 | 45.808 | 150.4 | 511.3 | 21 | 8 |
| original-A2 | 1 | 43.058 | 117.2 | 496.7 | 20 | 8 |

With only 12 real samples per lifetime, p95 and p99 both select that lifetime's maximum. All 12 real frames in every lifetime exceed both 50 and 100 ms.

| Run | Lifetime | Real mean | Real p95 / p99 / max | First cold real |
| --- | ---: | ---: | ---: | ---: |
| original-A | 0 | 447.075 | 1391.7 | 1391.7 |
| original-A | 1 | 418.183 | 1346.1 | 1346.1 |
| production-B | 0 | 446.075 | 1443.5 | 1443.5 |
| production-B | 1 | 441.933 | 1320.6 | 1320.6 |
| production-B2 | 0 | 431.242 | 1353.1 | 1353.1 |
| production-B2 | 1 | 461.567 | 1409.6 | 1409.6 |
| original-A2 | 0 | 436.692 | 1409.6 | 1409.6 |
| original-A2 | 1 | 438.075 | 1401.0 | 1401.0 |

The two production runs differ substantially: the earlier B lifetimes have lower CPU means than B2. Production repeat phase 1 has a worse mean and p95, while phase 2 improves. Reporting only the best B lifetime would exaggerate the result. The 44 subsequent real samples also regress, so excluding the four cold first frames would not produce a real-render improvement.

## Resources and work remain equal

All eight before snapshots match their corresponding original lifetime's recorded resource/counter state; empty and returned snapshots also match. The complete comparisons and actual page/chunk records are in [analysis.json](analysis.json). The table shows the first lifetime's before snapshot.

| Representative before-capture field | Both policies |
| --- | ---: |
| Texture pages / total capacity / live layers / active layers | 14 / 105 / 105 / 97 |
| Actual source base-mip 0 / 1 layers | 95 / 10 |
| Visible draw chunks / pooled chunks | 70 / 71 |
| Draw-buffer bytes | 41,444 |
| Owned GPU bytes / peak / peak retired | 191,718,124 / 194,710,892 / 10,572,976 |
| Owned CPU bytes / peak / peak pending RGBA | 7,787,776 / 60,687,364 / 1,982,464 |
| Rasterizations / cache hits / cache misses | 1,726 / 153 / 1,573 |
| Cache backoffs / bypass requests / evictions / retained entries | 1 / 3,778 / 832 / 0 |
| Total scratch-upload bytes / partial bytes | 652,717,160 / 649,686,120 |
| Partial uploads / full-upload fallback | 1,724 / 0 |
| Array page initializations / compaction layers / compaction mip copies | 29 / 7 / 67 |
| Render calls / triangles / geometries / textures | 142 / 404 / 72 / 18 |

The JavaScript heap samples remain in each lifetime record. Post-GC `usedSize` ranges from 12,112,616–12,600,692 bytes for original and 12,119,048–12,607,308 for production; backing storage differs by approximately 4–12 bytes between recorded policies. These runtime heap measurements are not an allocation profiler and do not establish a memory improvement. Tracked owned/peak resource accounting matches exactly.

## Interpretation and remaining work

The [36-bin mask microbenchmark](../mask-micro/report.zh.md) isolates mask-loop behavior, while this ABBA measures full presentation with its other work intact. Its microbenchmark ratio must not be presented as the game's frame-time ratio. This formal run shows a smaller CPU change and preserves both regressions and large remaining stalls.

The independent [latency trace](../trace-analysis/report.md) identifies deferred main-thread Skia work in the long Canvas calls and a separate CPU-to-scratch graphics-channel wait. This mask optimization does not eliminate either path. Cache reuse/backoff and upload backpressure remain actionable investigations. Further cache candidates need their own same-source correctness and formal measurements; this report incorporates no unmeasured candidate benefit.

The ABBA order reduces simple order drift, but four lifetimes and 48 real frames per policy do not establish stable tail probabilities or behavior on other hardware. PNG/fact equality covers the captured scene. This performance harness does not add actual picking queries: transparent-pixel, threshold, flip and UV correctness require the separate mask semantics and camera/picking proofs. Source metadata covers client source and the mask provider, but the run does not independently archive every served public-resource byte or HTTP module response.

Reproduce the offline validation and distributions from the repository root, outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/mask-abba/analyze.mjs
```

The four original inputs are retained at [original-A/raw.json](original-A/raw.json), [production-B/raw.json](production-B/raw.json), [production-B2/raw.json](production-B2/raw.json) and [original-A2/raw.json](original-A2/raw.json). The derived [analysis.json](analysis.json) includes every lifetime, every pooled field, all individual image/source/provider/resource checks, input SHA values and every measured regression.
