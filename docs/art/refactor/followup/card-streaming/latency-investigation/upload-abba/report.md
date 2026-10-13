# Splitting partial CPU uploads: no demonstrated frame improvement

The 64 KiB partial-upload candidate preserves the recorded scene, byte counts and GPU layout, but it does **not** demonstrate a useful full-frame speed improvement. Pooled CPU mean increases **0.301 ms (0.72%)**, real-render completion-wall mean increases **3.554 ms (0.82%)**, and the candidate makes approximately **6.34 times as many partial public-copy calls**. Some quantiles improve and others worsen. The current candidate should not be integrated as a performance fix on this evidence.

The formal harness has no per-call timer or profiler. It cannot establish that the largest single copy became shorter, that the prior `WaitForToken` stall disappeared, or that waiting simply moved to another call. No such claim follows from splitting the input data or from the few improved tails.

## Source isolation and corrected dependency validation

Both sides use core source `aec09d620801dd07852042732831e5b2de1c4193`, one native-mip bank, current mask, current peak accounting and the current original raster-cache implementation. Original is the complete frozen `5b356c7795068bb2a532ad1d486b3c22936cf735` uploader, byte-identical to current production. Candidate is the complete external module with SHA `8151202f0add0044a30147645515200e69fde494f439cb801888e62e75f75783`. It splits a warm changed CPU-to-scratch rectangle into public copies of at most 64 KiB, enables original mip generation only for the final part, and restores the flag in `finally`. Initial/recovery full uploads and GPU mip/compaction copies are outside that chunk ceiling.

The exact current `PaintedCardBatches` uploader import selects the complete module, including its texture factory and byte-count exports. Both external modules are prepared before sampling without constructing uploaders or invoking texture factories. Their unchanged region helper is served from run-start bytes with SHA `25d852a8b6424c81648e93b68db98de1076cee90659d3f2b01cc5b07878c8439`. Original, current and the present candidate-adjacent helper all match. Art, geometry, simulation inputs, cache/mask/peak source, shaders, timers and completion method remain common.

The first offline analyzer had an invalid additional assertion: it required the Three optimizer path to match across independent runs. Each run legitimately creates its own `/tmp/sketch-upload-formal-…/.vite/deps/three.js?v=…` URL. That first failure is preserved at [analyze.mjs](analyze.mjs) and [analysis.json](analysis.json), with identical explicit copies [analyze-invalid-cross-run-cache-path.mjs](analyze-invalid-cross-run-cache-path.mjs) and [analysis-invalid-cross-run-cache-path.json](analysis-invalid-cross-run-cache-path.json).

The corrected [analyze-verified.mjs](analyze-verified.mjs) produces [analysis-verified.json](analysis-verified.json). It verifies that **within each run both external providers have exactly the same full resolved ID, including query**, and checks the archived resolver contract using the current production package context. Independent optimizer roots/queries are not source hashes. The original raw inputs, pictures, source/provider/helper checks and zero-RGBA tolerance are unchanged. The initial script/output remain intact, rather than being rewritten to hide the failed assertion.

The dependency evidence demonstrates a common current-source package resolution path for the two external providers. It does not archive the optimized Three bundle bytes or measure the ordinary WorldLayer's final browser-module/object identity. It therefore does not establish an independently measured singleton across the entire module graph.

## Strict verification

The corrected analyzer exits 0 with no violations and verifies:

- Four complete runs, two independently recreated lifetimes per run, original mixed/hidden-0 schedule, 60 paced CPU and 12 real samples per lifetime, matching device/settings, zero browser/network/GL errors and disposal.
- **480 CPU clocks**, actual visible-fact hashes, the original sample grid and preserved first cold real jump to `n=480`.
- Common initial/final 295-entry client-source SHA maps, provider/corpus/archive SHA values, helper/fixture/harness bytes, exact importer restriction, balanced module setup, frozen uploader/helper sources and run-start serving of source snapshots.
- **24 PNGs decoded at zero RGBA tolerance**, including every alpha/RGB component; corresponding raw PNG SHA values also match.
- **8 facts** and asset-coverage records, and **24 before/empty/returned snapshots**.
- Exact equality of GPU upload bytes, semantic ROI-update counts, native mip-copy/materialization/compaction counters, pages/mips/capacity, geometry/chunks/order, masks, GPU memory/peaks and visible render/content facts.
- Every non-timing cache and CPU ownership field, with full difference reporting rather than an assumption that unchanged cache source must make identical adaptive decisions.

The only changed non-timing card field in this run is the newly introduced `partialUploadCopyCalls`. Source-identical adaptive cache counters and CPU ownership happen to match in all phases. Their measured duration fields still differ and remain reported.

The recorded environment is Chromium/ANGLE SwiftShader, 1280 × 720, DPR 1, zoom 0.75. The PNGs cover the three captured views; this unprofiled performance harness does not individually read every texture mip or add actual picking queries. Portable call-contract tests are distinct from native WebGL correctness, and neither should be mislabeled as GPU readback proof. No production integration occurred.

## Pooled timing distributions

Order is `original-A`, `candidate-B`, `candidate-B2`, `original-A2`. All raw samples from four lifetimes per policy are pooled before percentiles; no lifetime quantiles are averaged. Quantiles use sorted index `floor(count × q)`, capped at the last sample. Durations are milliseconds. Cold first-real frames remain in headline values.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 240 | 41.765 | 42.067 | 119.1 | 113.7 | 449.9 | 464.9 | 83 / 30 | 84 / 28 |
| World3D CPU | 240 | 41.413 | 41.705 | 118.8 | 113.4 | 449.4 | 464.6 | 81 / 30 | 84 / 28 |
| Canvas/coordinator residual | 240 | 0.352 | 0.362 | 0.5 | 0.6 | 2.7 | 2.8 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 80 | 71.685 | 71.427 | 405.2 | 415.5 | 472.5 | 473.3 | 47 / 6 | 48 / 4 |
| Repeated CPU tick | 160 | 26.806 | 27.386 | 116.3 | 113.7 | 177.3 | 171.4 | 36 / 24 | 36 / 24 |
| Repeat phase 1 | 80 | 21.970 | 22.913 | 109.0 | 112.1 | 119.7 | 171.4 | 16 / 11 | 16 / 10 |
| Repeat phase 2 | 80 | 31.641 | 31.860 | 138.9 | 143.7 | 197.0 | 187.5 | 20 / 13 | 20 / 14 |
| Real completion wall | 48 | 434.708 | 438.262 | 1349.9 | 1351.1 | 1462.2 | 1425.1 | 48 / 48 | 48 / 48 |
| Real submission | 48 | 53.485 | 53.413 | 259.9 | 262.9 | 291.3 | 270.8 | 12 / 12 | 12 / 12 |
| Real frame-start interval | 44 | 464.243 | 470.518 | 1362.4 | 1358.0 | 1468.1 | 1438.5 | 44 / 44 | 44 / 44 |
| First cold real | 4 | 1377.950 | 1360.825 | 1462.2 | 1425.1 | 1462.2 | 1425.1 | 4 / 4 | 4 / 4 |
| Subsequent real | 44 | 348.959 | 354.393 | 1089.7 | 1108.3 | 1107.8 | 1191.2 | 44 / 44 | 44 / 44 |
| Fence wait wall | 48 | 381.202 | 384.833 | 1073.8 | 1088.2 | 1207.6 | 1154.2 | 48 / 48 | 48 / 48 |
| Fence-poll call wall | 48 | 0.356 | 0.440 | 1.0 | 1.5 | 1.4 | 1.8 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 48 | 380.696 | 384.250 | 1072.0 | 1086.6 | 1206.7 | 1152.2 | 48 / 48 | 48 / 48 |
| Empty-view completion wall | 4 | 65.150 | 58.050 | 77.3 | 60.8 | 77.3 | 60.8 | 4 / 0 | 4 / 0 |
| Empty-view submission | 4 | 6.650 | 6.750 | 8.0 | 7.6 | 8.0 | 7.6 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 4 | 1403.900 | 1404.350 | 1427.3 | 1430.5 | 1427.3 | 1430.5 | 4 / 4 | 4 / 4 |
| Returned-view submission | 4 | 261.425 | 242.600 | 300.2 | 246.5 | 300.2 | 246.5 | 4 / 4 | 4 / 4 |

CPU p50 worsens from 7.1 to 9.3 ms; CPU p99 and maximum also worsen. The first-cold mean improves, but subsequent-real mean/p95/p99 worsen. Choosing only the p95 CPU or cold headline would conceal these regressions.

Full CPU includes World3D and the Canvas/coordinator row is residual. Fence wait includes yielding/polling. These nested measurements cannot be added as separate costs. Complete wall measures completion/scheduling as well as presentation, not hardware GPU nanoseconds or directly measured FPS. The roughly equal mean submission and slightly larger mean wait do not establish causal wait transfer without a per-call trace.

## Every lifetime

| Run | Lifetime | CPU mean | CPU p95 | CPU p99 / max | CPU >50 | CPU >100 | Real mean | Real p95 / p99 / max | First cold real | Subsequent real mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| original-A | 0 | 42.060 | 119.1 | 449.9 | 22 | 8 | 446.358 | 1421.6 | 1421.6 | 357.700 |
| original-A | 1 | 39.582 | 113.8 | 472.5 | 18 | 6 | 420.517 | 1462.2 | 1462.2 | 325.818 |
| candidate-B | 0 | 41.428 | 119.0 | 473.3 | 20 | 6 | 426.500 | 1287.8 | 1287.8 | 348.200 |
| candidate-B | 1 | 41.535 | 112.9 | 471.9 | 20 | 7 | 437.333 | 1379.3 | 1379.3 | 351.700 |
| candidate-B2 | 0 | 41.567 | 114.0 | 464.9 | 21 | 8 | 444.558 | 1351.1 | 1351.1 | 362.145 |
| candidate-B2 | 1 | 43.737 | 171.4 | 415.5 | 23 | 7 | 444.658 | 1425.1 | 1425.1 | 355.527 |
| original-A2 | 0 | 41.658 | 119.2 | 405.2 | 21 | 9 | 430.208 | 1278.1 | 1278.1 | 353.127 |
| original-A2 | 1 | 43.762 | 132.6 | 460.7 | 22 | 7 | 441.750 | 1349.9 | 1349.9 | 359.191 |

Every lifetime includes all 12 real frames above both 50 and 100 ms. With 12 samples, p95 and p99 select the lifetime maximum. All eight lifetimes are retained. This ABBA sample reduces simple order drift but does not prove stable tail distributions or portable hardware ratios.

## Copy-call growth, memory and adaptive cache

The original class has **no measured `partialUploadCopyCalls` field**. With zero full-upload fallbacks/errors recorded, its one-call-per-successful-ROI implementation permits a clearly labeled derived count of 1,724 before capture and 1,793 at return. Candidate's new counter counts attempted public partial-copy calls, incrementing before a call that could throw; successful ROI counts and byte counters update only after the whole region succeeds.

| Recorded/derived work | Original before | Candidate before | Original returned | Candidate returned |
| --- | ---: | ---: | ---: | ---: |
| Semantic successful partial ROI updates | 1,724 | 1,724 | 1,793 | 1,793 |
| Public partial-copy calls | 1,724, derived | 10,929, measured | 1,793, derived | 11,327, measured |
| Full-upload fallbacks | 0 | 0 | 0 | 0 |
| Owned CPU bytes | 7,787,776 | 7,787,776 | 7,525,632 | 7,525,632 |
| Tracked peak CPU bytes | 60,687,364 | 60,687,364 | 60,687,364 | 60,687,364 |
| Raster-cache hits / misses | 153 / 1,573 | 153 / 1,573 | 153 / 1,643 | 153 / 1,643 |
| Cache entries / encoded/scratch bytes | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Cache backoffs / bypass requests | 1 / 3,778 | 1 / 3,778 | 1 / 3,708 | 1 / 3,708 |

These values match across corresponding lifetimes. Scratch-upload bytes remain **652,717,160** before capture, including **649,686,120** partial bytes. Array mip-copy/materialization/compaction work, native layout, ongoing GPU bytes/peaks, all draw buffers/calls/order and masks are unchanged. Empty-view owned CPU bytes also match at 3,657,984. Extra public calls do not save upload bytes or residency in this experiment.

The 64 KiB ceiling and unique final mip-generation step are static properties of the candidate code and separately tested call contract. The formal counters do not measure each actual chunk size or each GL mip-generation invocation. They must not be described as direct GPU proof of those properties or as maximum-latency measurements.

The unchanged adaptive cache uses measured work and credited paint/readback cost to choose backoff, so a different uploader could legitimately change cache decisions indirectly. That possibility is handled through full differences, not hidden by excluding cache counters. Here all non-timing cache fields match, while measured costs vary:

| Per-lifetime cumulative before-capture mean | Original | Candidate | Candidate minus original |
| --- | ---: | ---: | ---: |
| Cache measured work | 902.425 ms | 897.750 ms | −4.675 ms |
| Estimated avoided paint/readback | 522.575 ms | 514.800 ms | −7.775 ms |
| Paint stage | 467.800 ms | 443.375 ms | −24.425 ms |
| Readback stage | 4455.025 ms | 4445.550 ms | −9.475 ms |
| Cache stage | 909.675 ms | 902.600 ms | −7.075 ms |
| Mask stage | 610.525 ms | 603.500 ms | −7.025 ms |
| Row flip | 139.275 ms | 144.950 ms | +5.675 ms |
| Slot work | 22.475 ms | 22.075 ms | −0.400 ms |
| GPU-transfer submission wall | 1295.650 ms | 1300.975 ms | +5.325 ms |

Cumulative counters include preparation, warmups, CPU/real sampling and capture work; they are not the timed CPU subset alone. Cache stage overlaps cache measured work. Estimated avoided painting credits older measured entry cost and is not a measured total-frame counterfactual. These costs do not prove that a particular graphics wait moved or disappeared.

The current chunking policy adds calls without a consistent frame benefit and leaves the principal tails present. Keep it as rejected performance evidence rather than adopting it on a local quantile improvement. A later uploader policy requires its own complete-module correctness and formal comparison; no later result is incorporated here.

Reproduce the corrected offline verification from the repository root, outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/upload-abba/analyze-verified.mjs
```

Inputs remain at [original-A/raw.json](original-A/raw.json), [candidate-B/raw.json](candidate-B/raw.json), [candidate-B2/raw.json](candidate-B2/raw.json) and [original-A2/raw.json](original-A2/raw.json). [analysis-verified.json](analysis-verified.json) contains every lifetime, pooled distribution, actual resource/counter difference and measured regression, with input/script SHA values. The initial failed dependency-path assertion remains separately linked above.
