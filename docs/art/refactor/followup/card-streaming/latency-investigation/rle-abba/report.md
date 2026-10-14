# Retaining proven RLE entries during backoff: rejected candidate

**Do not integrate this candidate as a performance fix.** Its lossless recovery behavior works in the recorded scene, but the formal comparison does not demonstrate a useful overall improvement. Mean CPU time decreases by only **0.322 ms (0.77%)**, CPU p95 increases, mean real-render completion wall increases **13.244 ms (3.13%)**, and the paused cache retains another **5.11–5.23 MB**. The parent engineering lane has rejected production integration. The original candidate, tools, raw data and screenshots remain available as evidence; this report does not replace them with a later policy or select favorable lifetimes.

## The isolated policy

Both sides run core source `aec09d620801dd07852042732831e5b2de1c4193`, one native-mip bank, the current mask packer and current peak accounting. Original uses the complete frozen `5b356c7795068bb2a532ad1d486b3c22936cf735` `CardRasterCache` class, which is byte-identical to the current production cache. The external candidate retains previously reused entries whose maximum measured decode time does not exceed their recorded paint/readback cost when encoding enters backoff. It continues to count backoff lookup requests on the original schedule, releases encoder scratch, and can drop a retained entry after an unprofitable decode.

This is an external complete-class experiment, not production integration and not a `get`-only override. The Vite resolver redirects only the exact current `PaintedCardBatches` `./card-raster-cache` import. Its load hook serves bytes captured at run start for both external modules. Both modules are imported without constructing their classes before the cycles, balancing module preparation. Art, geometry, shaders, GPU transfers, mask packing, peak accounting, simulation inputs and fixture clocks are common.

The baseline/current/corpus cache SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`. The archived candidate SHA is `e3a413b9d586a1a9405c1def67825320de929d99b337d50dc0975ed14005a100`. The default budget remains 50,331,648 bytes, and the metadata cap remains 1,024 entries. The records exercise 38/39 retained entries, rather than a capacity-pressure case at the 1,024-entry bound.

## Strict offline checks

The [analyzer](analyze.mjs) exits successfully with no violations and preserves the original input hashes. Its [analysis.json](analysis.json) contains the input SHA values and all individual checks:

- Four complete runs, two independently recreated lifetimes each, original mixed scene/hidden-0 schedule, 60 paced CPU samples and 12 real frames per lifetime, zero browser/network/GL errors and valid disposal.
- **480 CPU clocks**, all on `n=114..173`, `tick=floor(n/3)`, matching original facts, settings and common fixture bytes. The real schedule retains its original jump to `n=480` and the cold first real frame.
- All 295 client-source SHA entries identical across runs; initial/final source maps match. Baseline and candidate sources remain frozen. Archived harness/parent harness, fixtures, helpers, loader and all five source snapshots match their recorded SHA values.
- Actual complete-class provider path/SHA, exact importer restriction, balanced module preparation, and `servedFromRunStartSnapshot=true` for both loaded modules.
- **24 decoded PNGs with zero RGBA difference**, including all alpha/RGB components. Corresponding raw PNG SHA values are also identical.
- **8 actual visible-fact records** and captured snapshot hashes, plus unchanged asset coverage.
- All **24 before/empty/returned snapshots** compared. Actual pages, source/native mip bases, geometry/chunk counts and capacities, chunk render orders/bank assignments, GPU allocation/peaks, render calls and visible-content facts remain equal. Every other non-timing card field is compared and its changes are recorded, including newly introduced cache counters.

Cache state and CPU ownership are allowed to change and are reported rather than required to equal the original. Only explicit duration fields are excluded from the non-timing card comparison; cumulative cache/stage/upload durations remain in the derived records. Cache budget, entry bounds and byte-accounting consistency are checked in every phase.

The comparison uses Chromium/ANGLE SwiftShader at 1280 × 720, DPR 1, zoom 0.75. Its image equality covers the three captured views. This performance harness adds no picking queries, so actual transparent-pixel picking and mask semantics require the separate correctness proofs. Public-resource bytes and every served HTTP module response are not independently archived by this harness.

## All pooled timings

The chronological sequence is `original-A`, `candidate-B`, `candidate-B2`, `original-A2`. All samples from four lifetimes per policy are pooled before calculating quantiles; lifetime percentiles are not averaged. A quantile selects the sorted sample at `floor(count × q)`, capped at the final sample. Durations below are milliseconds. Cold first frames remain in the headline rows.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 240 | 41.686 | 41.364 | 113.0 | 116.8 | 469.0 | 465.9 | 77 / 30 | 77 / 26 |
| World3D CPU | 240 | 41.370 | 41.028 | 112.7 | 116.3 | 468.6 | 465.6 | 77 / 30 | 76 / 26 |
| Canvas/coordinator residual | 240 | 0.316 | 0.336 | 0.5 | 0.6 | 0.9 | 1.9 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 80 | 72.401 | 70.906 | 460.1 | 449.6 | 471.5 | 476.7 | 41 / 4 | 41 / 5 |
| Repeated CPU tick | 160 | 26.328 | 26.592 | 113.0 | 116.8 | 142.8 | 161.6 | 36 / 26 | 36 / 21 |
| Repeat phase 1 | 80 | 22.471 | 21.811 | 113.0 | 110.2 | 136.6 | 116.8 | 16 / 11 | 16 / 9 |
| Repeat phase 2 | 80 | 30.185 | 31.374 | 137.5 | 142.5 | 147.0 | 163.1 | 20 / 15 | 20 / 12 |
| Real completion wall | 48 | 422.971 | 436.215 | 1274.0 | 1349.7 | 1366.0 | 1359.7 | 48 / 48 | 48 / 48 |
| Real submission | 48 | 51.412 | 46.940 | 254.1 | 222.3 | 290.5 | 242.0 | 12 / 12 | 12 / 12 |
| Real frame-start interval | 44 | 453.214 | 465.600 | 1276.4 | 1349.9 | 1381.8 | 1362.4 | 44 / 44 | 44 / 44 |
| First cold real | 4 | 1304.175 | 1349.100 | 1366.0 | 1359.7 | 1366.0 | 1359.7 | 4 / 4 | 4 / 4 |
| Subsequent real | 44 | 342.861 | 353.225 | 1037.6 | 1052.4 | 1089.3 | 1095.9 | 44 / 44 | 44 / 44 |
| Fence wait wall | 48 | 371.544 | 389.258 | 1019.7 | 1107.6 | 1075.4 | 1141.3 | 48 / 48 | 48 / 48 |
| Fence-poll call wall | 48 | 0.310 | 0.342 | 0.9 | 1.3 | 1.4 | 1.5 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 48 | 371.104 | 388.783 | 1018.9 | 1106.6 | 1074.2 | 1140.5 | 48 / 48 | 48 / 48 |
| Empty-view completion wall | 4 | 64.900 | 64.700 | 76.7 | 74.4 | 76.7 | 74.4 | 4 / 0 | 4 / 0 |
| Empty-view submission | 4 | 6.200 | 8.250 | 7.2 | 13.3 | 7.2 | 13.3 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 4 | 1349.750 | 1396.000 | 1379.6 | 1502.8 | 1379.6 | 1502.8 | 4 / 4 | 4 / 4 |
| Returned-view submission | 4 | 243.250 | 236.150 | 245.1 | 263.4 | 245.1 | 263.4 | 4 / 4 | 4 / 4 |

CPU p50 worsens from 7.0 to 7.3 ms; the maximum worsens from 471.5 to 476.7 ms. Although there are four fewer CPU samples above 100 ms, there is no decrease in the count above 50 ms. Both repeated-tick mean and repeated phase-2 tail worsen. Excluding cold real frames would not reverse the mean completion-wall regression: the subsequent-real mean still increases by 10.364 ms.

These timing components overlap. Full CPU contains World3D; the Canvas/coordinator row is a residual. Fence wait contains yield and poll work. Real completion wall includes graphics completion and scheduling and must not be called a GPU timer or directly converted into a measured FPS result.

## Every lifetime

| Run | Lifetime | CPU mean | CPU p95 | CPU p99 / max | CPU >50 | CPU >100 | Real mean | Real p95 / p99 / max | Cold first real | Subsequent real mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| original-A | 0 | 39.758 | 132.0 | 460.1 | 17 | 6 | 433.375 | 1366.0 | 1366.0 | 348.591 |
| original-A | 1 | 40.917 | 107.8 | 469.0 | 20 | 7 | 414.592 | 1268.1 | 1268.1 | 337.000 |
| candidate-B | 0 | 40.072 | 110.2 | 476.7 | 17 | 6 | 437.225 | 1331.8 | 1331.8 | 355.900 |
| candidate-B | 1 | 42.963 | 161.6 | 465.9 | 20 | 7 | 448.275 | 1359.7 | 1359.7 | 365.418 |
| candidate-B2 | 0 | 42.480 | 128.5 | 469.1 | 20 | 7 | 426.825 | 1349.7 | 1349.7 | 342.927 |
| candidate-B2 | 1 | 39.940 | 113.3 | 449.6 | 20 | 6 | 432.533 | 1355.2 | 1355.2 | 348.655 |
| original-A2 | 0 | 43.903 | 136.6 | 470.2 | 21 | 9 | 423.992 | 1274.0 | 1274.0 | 346.718 |
| original-A2 | 1 | 42.165 | 115.4 | 471.5 | 19 | 8 | 419.925 | 1308.6 | 1308.6 | 339.136 |

With 12 real frames, p95 and p99 both select each lifetime's maximum. Every lifetime retains all 12 frames above 50 and 100 ms. The original runs themselves vary by several milliseconds in CPU mean; the candidate's pooled 0.322 ms reduction is smaller than that between-lifetime variation. ABBA reduces simple order drift, but this sample set does not establish a stable sub-millisecond improvement or tail probability on other hardware.

## Work saved and memory retained

At the before capture, every candidate lifetime has 178 hits and 1,548 misses, compared with 153 and 1,573 in original. It avoids **25 actual cache misses (1.59%)**. At return it avoids 35 cumulative misses: original 1,643 versus candidate 1,608. The candidate preserves this recovery while encoding is paused, but the before totals cover preparation, warmups, CPU samples, real frames and capture work; they cannot be attributed solely to the 60 timed CPU samples.

The batch `rasterizations` counter remains 1,726 before capture. It counts GPU-card materialization, including CPU-cache recoveries; it is not the count of Canvas painter executions. Cache misses provide the relevant distinction here.

| Non-timing field that changes | Original before | Candidate before |
| --- | ---: | ---: |
| Cache bytes | 0 | 5,113,212 or 5,229,952 |
| Cache owned bytes | 0 | 5,113,212 or 5,229,952 |
| Cache retained entries | 0 | 38 or 39 |
| Cache hits | 153 | 178 |
| Cache misses | 1,573 | 1,548 |
| Backoff-hit counter | Not recorded by original class | 25 |
| Backoff-drop counter | Not recorded by original class | 385 or 384 |
| Entries retained at backoff | Not recorded by original class | 38 or 39 |
| Bytes retained at backoff | Not recorded by original class | 5,113,212 or 5,229,952 |
| Total owned CPU bytes | 7,787,776 | 12,900,988 or 13,017,728 |

These are the complete set of changed non-timing card fields across the matched snapshots. New counters are shown as unreported on original, rather than invented zeros. Candidate cycle 0 retains 39 entries/5,229,952 bytes and drops 384; cycle 1 retains 38 entries/5,113,212 bytes and drops 385 in both B runs. Retention depends on measured entry cost and must not be claimed universally deterministic.

Cache scratch is zero on both sides at the endpoint. The additional retained bytes also persist through the empty view and return. For example, candidate-B lifetime 0 owns 8,887,936 CPU bytes while empty versus original's 3,657,984, and 12,755,584 when returned versus 7,525,632. Peak CPU accounting remains **60,687,364 bytes**; the experiment increases ongoing residency without reducing that recorded high-water mark.

Other non-timing fields remain equal, including backoffs 1, bypass requests 3,778, evictions 832, the 48 MiB budget, GPU page layout, source/native mip bases, draw geometry/order, masks, GPU ownership/peaks and all upload/copy counters. The representative before state retains 14 pages, capacity/live layers 105, active layers 97, 70 visible/71 pooled chunks, 41,444 draw-buffer bytes, 191,718,124 owned GPU bytes and 194,710,892 peak GPU bytes. Scratch uploads remain 652,717,160 bytes, with 1,724 partial uploads and zero full-upload fallbacks. Render state remains 142 calls, 404 triangles, 72 geometries and 18 textures. This candidate reduces CPU source work; it does not remove the existing upload workload.

## Cumulative cost, with attribution limits

The following are per-lifetime means of cumulative before-capture counters. They include work outside the timed CPU samples and are separate from the formal timing distributions above.

| Cumulative before-capture measurement | Original mean | Candidate mean | Candidate minus original |
| --- | ---: | ---: | ---: |
| Cache's measured work | 876.150 ms | 908.725 ms | +32.575 ms |
| Estimated avoided paint/readback | 512.475 ms | 604.300 ms | +91.825 ms |
| Paint stage | 436.650 ms | 432.650 ms | −4.000 ms |
| Readback stage | 4401.675 ms | 4290.525 ms | −111.150 ms |
| Cache stage | 882.100 ms | 915.450 ms | +33.350 ms |
| Mask stage | 599.975 ms | 614.925 ms | +14.950 ms |
| Row flip | 143.775 ms | 146.950 ms | +3.175 ms |
| Slot work | 18.525 ms | 21.225 ms | +2.700 ms |
| GPU-transfer submission wall | 1279.100 ms | 1304.300 ms | +25.200 ms |

The avoided-paint field credits each recovered entry's earlier measured paint/readback cost. It is an estimate and does not measure the current frame's counterfactual or total benefit. The cache stage includes cache work; those rows are nested and must not be added. The capture has no per-sample profiler or graphics trace that could attribute the real-wall increase to a specific cache operation or GPU wait. Fewer misses and some lower cumulative readback cost establish that recovery occurs; they do not prove that the policy improves full presentation.

This candidate leaves the initial codec trial and its approximately 0.9-second cumulative cache cost in place and rescues only a small subset afterward. The measured benefit does not justify the extra residency and completion-wall regression. A different admission policy needs its own complete-class semantics, strict pictures/picking and same-source formal comparison. No future policy result is incorporated here, and the first candidate's evidence remains untouched.

Reproduce offline validation and the complete lifetime/pooled/difference records from the repository root, outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/rle-abba/analyze.mjs
```

Inputs remain at [original-A/raw.json](original-A/raw.json), [candidate-B/raw.json](candidate-B/raw.json), [candidate-B2/raw.json](candidate-B2/raw.json) and [original-A2/raw.json](original-A2/raw.json). [analysis.json](analysis.json) includes all raw-derived timing distributions, regressions, ownership/cache changes, cumulative stage costs and source/provider/image checks.
