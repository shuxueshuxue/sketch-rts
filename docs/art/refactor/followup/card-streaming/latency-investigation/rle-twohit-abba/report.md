# Two-hit RLE admission: speed improves, ongoing residency rises sharply

The isolated candidate improves full-presentation CPU mean by **4.017 ms (9.36%)** and real-render completion-wall mean by **15.188 ms (3.48%)**, with unchanged recorded pixels and GPU work. It also keeps approximately **50.74 MB of additional CPU buffers resident**, increasing before-capture ownership from **7,787,776 to 58,531,040 bytes (651.6%)**. Its tracked buffer peak is essentially unchanged because the original also filled the cache during its initial trial, then released it. That peak comparison must not conceal the much larger ongoing residency.

This is a useful admission experiment to continue, but it is **not a sufficient result to ship the current 48 MiB policy as a resource optimization**. The parent engineering lane has rejected this default-budget integration for now. The runtime speed benefit is real in this measured sample set; the steady memory tradeoff is substantial, CPU samples above 100 ms increase, and some repeated-frame/fence tails worsen. The candidate remains external and has not been integrated into production. No new parameter, favorable-lifetime selection or later candidate result is included here.

## Isolated implementation and strict evidence

All four runs use core source `aec09d620801dd07852042732831e5b2de1c4193`, one native-mip bank, current mask packing and current peak accounting. The complete original cache class is byte-identical to current production and frozen `5b356c7795068bb2a532ad1d486b3c22936cf735`. Candidate SHA is `933cbd9832621d43a126795986619a054996c62056c8d42c0755da9ce229b411`; original/current SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`.

The candidate stores only a key observation on the first eligible fresh-paint `put`. A second eligible `put` consumes that observation and attempts compression. A `get` alone does not advance admission. It does not include the [first candidate's retained-entry policy](../rle-abba/report.md). The exact current `PaintedCardBatches` cache import selects the entire original or candidate class at compile time; the loader serves run-start source bytes. Both external modules are prepared without constructing classes before sampling. Art, simulation inputs, geometry, shaders, mask, peak accounting, uploader and clocks remain common.

The [independent analyzer](analyze.mjs) exits 0 with no violations. It checks:

- Four complete ABBA runs, two independently recreated lifetimes per run, 60 paced CPU and 12 real samples per lifetime, matching device/settings/fixture, zero browser/network/GL failures and disposal.
- **480 CPU clocks** on the original `n=114..173`, `tick=floor(n/3)` grid, preserving the real jump to `n=480` and cold first frame.
- Common 295-entry client-source SHA maps and initial/final snapshots, archived harness/parent harness/fixtures/helpers/loader and all source snapshots, actual complete-class provider path/SHA, exact import restriction, and balanced run-start module preparation.
- **24 decoded PNGs at zero RGBA tolerance**, including all alpha/RGB components. Corresponding raw PNG SHA values also match.
- **8 actual visible-fact records**, recomputed fact and captured-snapshot hashes, and unchanged asset coverage.
- **24 before/empty/returned resource snapshots**. GPU-card materialization, upload/copy counts and bytes, page capacity/mips, geometry, chunks, render order/bank assignments, GPU ownership/peaks and render/content facts match exactly.
- Separate encoded-entry and probation-key limits of 1,024, actual 48 MiB encoded budget, byte-accounting identities, and nonnegative admission counters. All non-timing cache/CPU ownership changes, including newly introduced fields, remain in the output.

This evidence is available in [analysis.json](analysis.json). Original raw files and PNGs are preserved; the analyzer records and rechecks raw input hashes. The first RLE tools and failed-candidate evidence were not changed.

The environment is Chromium/ANGLE SwiftShader, 1280 × 720, DPR 1, zoom 0.75, mixed scene with hidden population 0. The captured views establish their picture equality. This timing harness adds no actual picking queries, so mask/cache semantics and picking require their separate correctness proofs. It does not independently archive every served public-resource byte or HTTP module response.

## Every pooled distribution

Order is `original-A`, `candidate-B`, `candidate-B2`, `original-A2`. Raw samples are concatenated across all four lifetimes per policy before quantiles are computed; no lifetime quantiles are averaged. Quantiles select sorted index `floor(count × q)`, capped at the final sample. Durations below are milliseconds, and first cold real frames remain in headline values.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 240 | 42.929 | 38.912 | 134.6 | 112.4 | 474.6 | 443.8 | 79 / 30 | 58 / 32 |
| World3D CPU | 240 | 42.574 | 38.584 | 134.4 | 112.0 | 474.2 | 443.4 | 78 / 30 | 58 / 31 |
| Canvas/coordinator residual | 240 | 0.355 | 0.328 | 0.6 | 0.5 | 1.4 | 1.0 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 80 | 74.076 | 63.898 | 469.3 | 440.9 | 513.3 | 474.8 | 43 / 5 | 22 / 5 |
| Repeated CPU tick | 160 | 27.356 | 26.419 | 134.6 | 112.2 | 150.4 | 143.2 | 36 / 25 | 36 / 27 |
| Repeat phase 1 | 80 | 23.186 | 23.321 | 109.1 | 109.6 | 163.1 | 181.5 | 16 / 12 | 16 / 14 |
| Repeat phase 2 | 80 | 31.525 | 29.517 | 142.7 | 115.8 | 150.4 | 143.2 | 20 / 13 | 20 / 13 |
| Real completion wall | 48 | 436.960 | 421.773 | 1339.4 | 1318.5 | 1366.2 | 1331.6 | 48 / 48 | 48 / 48 |
| Real submission | 48 | 53.119 | 39.154 | 270.3 | 168.4 | 274.2 | 184.1 | 12 / 12 | 12 / 12 |
| Real frame-start interval | 44 | 467.125 | 450.366 | 1349.0 | 1318.8 | 1370.3 | 1345.0 | 44 / 44 | 44 / 44 |
| First cold real | 4 | 1345.175 | 1297.175 | 1366.2 | 1331.6 | 1366.2 | 1331.6 | 4 / 4 | 4 / 4 |
| Subsequent real | 44 | 354.395 | 342.191 | 1064.6 | 1036.0 | 1132.3 | 1043.8 | 44 / 44 | 44 / 44 |
| Fence wait wall | 48 | 383.835 | 382.598 | 1069.1 | 1134.6 | 1094.8 | 1168.1 | 48 / 48 | 48 / 48 |
| Fence-poll call wall | 48 | 0.394 | 0.377 | 1.2 | 1.0 | 1.5 | 1.3 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 48 | 383.329 | 382.031 | 1067.7 | 1132.8 | 1092.8 | 1166.8 | 48 / 48 | 48 / 48 |
| Empty-view completion wall | 4 | 60.775 | 65.075 | 65.2 | 71.1 | 65.2 | 71.1 | 4 / 0 | 4 / 0 |
| Empty-view submission | 4 | 6.700 | 7.550 | 7.4 | 9.8 | 7.4 | 9.8 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 4 | 1390.425 | 1323.125 | 1416.2 | 1360.4 | 1416.2 | 1360.4 | 4 / 4 | 4 / 4 |
| Returned-view submission | 4 | 244.325 | 145.600 | 257.7 | 165.3 | 257.7 | 165.3 | 4 / 4 | 4 / 4 |

CPU p50 improves from 9.0 to 7.2 ms and maximum from 513.3 to 474.8 ms, but the number above 100 ms rises from 30 to 32. Repeated phase 1 has worse mean/p95/p99, and repeated-tick maximum rises from 163.1 to 181.5 ms. Fence-wait p95/p99 also rise despite slightly lower mean. The remaining hundreds-of-milliseconds stalls have not been resolved.

Full CPU contains World3D, and Canvas/coordinator is a residual. Fence wait contains yielding/polling. These rows cannot be summed as independent costs. Real completion wall includes graphics completion and scheduling, rather than a hardware GPU timer or directly measured FPS. Its mean improvement is mostly accompanied by lower submission time; this capture does not identify a driver-level cause for the changed wait tails.

## Every lifetime

| Run | Lifetime | CPU mean | CPU p95 | CPU p99 / max | CPU >50 | CPU >100 | Real mean | Real p95 / p99 / max | First cold real | Subsequent real mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| original-A | 0 | 44.648 | 147.5 | 513.3 | 20 | 8 | 433.725 | 1366.2 | 1366.2 | 348.955 |
| original-A | 1 | 41.773 | 110.8 | 469.3 | 21 | 7 | 456.675 | 1353.2 | 1353.2 | 375.173 |
| candidate-B | 0 | 39.303 | 126.5 | 466.3 | 13 | 9 | 410.317 | 1218.5 | 1218.5 | 336.845 |
| candidate-B | 1 | 37.838 | 112.4 | 440.9 | 14 | 8 | 424.417 | 1318.5 | 1318.5 | 343.136 |
| candidate-B2 | 0 | 38.350 | 105.9 | 443.8 | 16 | 7 | 427.908 | 1320.1 | 1320.1 | 346.800 |
| candidate-B2 | 1 | 40.157 | 129.6 | 474.8 | 15 | 8 | 424.450 | 1331.6 | 1331.6 | 341.982 |
| original-A2 | 0 | 39.803 | 117.3 | 474.6 | 17 | 7 | 424.458 | 1321.9 | 1321.9 | 342.873 |
| original-A2 | 1 | 45.492 | 148.3 | 497.8 | 21 | 8 | 432.983 | 1339.4 | 1339.4 | 350.582 |

With 12 real frames, each lifetime's p95 and p99 both select its maximum. All 12 real frames in every lifetime exceed 50 and 100 ms. No slow original or candidate lifetime has been excluded. Four lifetimes and 48 real samples per policy support the observed comparison but do not guarantee stable tail probabilities or the same ratios on other hardware.

## Ongoing CPU buffers, peak and ghost metadata

The following values are identical across the four candidate lifetimes and across their four original counterparts at the corresponding phase.

| Active resource/counter | Original before | Candidate before | Original returned | Candidate returned |
| --- | ---: | ---: | ---: | ---: |
| Compressed cache payload bytes | 0 | 50,218,976 | 0 | 50,229,740 |
| Encoder scratch bytes | 0 | 524,288 | 0 | 524,288 |
| Cache tracked owned-buffer bytes | 0 | 50,743,264 | 0 | 50,754,028 |
| Encoded entries | 0 | 423 | 0 | 428 |
| Probation key observations | Not recorded | 508 | Not recorded | 483 |
| Cumulative admission skips | Not recorded | 1,018 | Not recorded | 1,018 |
| Cumulative admitted entries | Not recorded | 510 | Not recorded | 535 |
| Cache hits | 153 | 198 | 153 | 243 |
| Cache misses | 1,573 | 1,528 | 1,643 | 1,553 |
| Cache evictions | 832 | 87 | 832 | 107 |
| Backoff count | 1 | 0 | 1 | 0 |
| Remaining bypass requests | 3,778 | 0 | 3,708 | 0 |
| Total tracked owned CPU buffers | 7,787,776 | 58,531,040 | 7,525,632 | 58,279,660 |
| Tracked owned CPU-buffer peak | 60,687,364 | 60,648,540 | 60,687,364 | 60,648,540 |

The empty view is particularly relevant to resource consumption: original owns **3,657,984 bytes**, while candidate still owns **54,401,248**. It retains its cache payload and scratch across that view. Before capture, ongoing ownership increases **50,743,264 bytes / 651.6%**; return increases **50,754,028 bytes**. This is not a new high-water buffer budget: the tracked peak is 38,824 bytes lower, a difference of only about 0.064%. The original reaches a similar temporary peak during its initial encoding trial and later releases the buffers on backoff. Candidate instead remains near that occupancy.

Both entry caps are **independently 1,024**: up to 1,024 encoded entries and up to 1,024 probation keys. They are not a combined 1,024-entry cap. The 48 MiB budget constrains encoded payload, not all JavaScript metadata or encoder scratch. The first observation holds no source RGBA; it stores a string key and Map entry. This record measures the number of observations, not their byte footprint. **Map/key/object metadata bytes are unmeasured**, and a key-count bound alone is not a bound on total string-byte length. No fabricated ghost-byte estimate is added to tracked ownership.

`peakOwnedCpuBytes` measures the declared CPU buffers in the renderer's accounting, not a complete heap/Canvas/JavaScript metadata allocation profile. Peak pending RGBA remains **1,982,464 bytes**, and all GPU ownership/peak/layout fields remain equal. The post-cycle forced-GC heap samples happen after the cycle has disposed its resources; their smaller candidate heap/backing-storage totals do not refute the approximately 50 MB of active cache buffers recorded before/empty/returned. These heap records and teardown measurements are retained in the derived output.

The complete changed non-timing fields are cache backoffs/bypass, payload/scratch/owned bytes, entries/hits/misses/evictions, the three admission/probation fields, total owned CPU bytes and tracked CPU-buffer peak. All remaining recorded non-timing card fields, including source/native mip residency, masks, geometry, draw order and GPU uploads/copies, match. Representative before values still include 14 pages, capacity/live layers 105, active layers 97, 70 visible/71 pooled chunks, 41,444 draw-buffer bytes, 191,718,124 owned GPU bytes, 194,710,892 peak GPU bytes, 652,717,160 scratch-upload bytes, 1,724 partial uploads and zero full-upload fallbacks. Render state is 142 calls, 404 triangles, 72 geometries and 18 textures.

## Saved source work and cumulative cost

Before capture, true cache misses decrease **45 per lifetime (2.86%)**; at return, cumulative misses decrease **90 (5.48%)**. The GPU-card `rasterizations` count remains 1,726 before capture: this counter also includes CPU-cache recovery and does not count only Canvas painter executions. A cache miss distinguishes fresh paint/readback from recovery in this path.

Unlike the first candidate, two-hit admission reduces the initial codec workload: 1,018 first observations skip compression, 510 entries are admitted, and only 87 are evicted by the before capture. The recovery/encoding estimate now keeps the original adaptive algorithm out of backoff, which explains the high occupancy as well as continued recovery. New counters are shown as unreported for original rather than invented zeros.

| Per-lifetime cumulative before-capture mean | Original | Candidate | Candidate minus original |
| --- | ---: | ---: | ---: |
| Cache measured work | 929.700 ms | 437.400 ms | −492.300 ms |
| Estimated avoided paint/readback | 535.175 ms | 644.150 ms | +108.975 ms |
| Paint stage | 462.775 ms | 429.025 ms | −33.750 ms |
| Readback stage | 4519.075 ms | 4236.950 ms | −282.125 ms |
| Cache stage | 934.325 ms | 443.175 ms | −491.150 ms |
| Mask stage | 610.175 ms | 627.675 ms | +17.500 ms |
| Row flip | 140.850 ms | 143.125 ms | +2.275 ms |
| Slot work | 18.450 ms | 20.575 ms | +2.125 ms |
| GPU-transfer submission wall | 1310.725 ms | 1386.450 ms | +75.725 ms |

These counters cover preparation, warmups, CPU samples, real frames and capture work. They cannot be assigned solely to the 60 timed CPU rows. Cache-stage and cache-work values overlap. Avoided paint/readback credits earlier entry cost, so it is a counterfactual estimate rather than a measured full-frame gain. The exact transfer count/byte invariants remain equal, and cumulative transfer submission wall worsens; this result does not establish a faster uploader or resolve the [observed graphics-channel stall](../trace-analysis/report.md).

The admission direction is worth further controlled engineering because it demonstrably reduces codec work without altering recorded content. The current default-budget candidate, however, exchanges much higher ongoing memory for modest real completion improvement. Any policy chosen for integration must evaluate that tradeoff directly and pass current-source picking/visual/lifecycle checks and a fresh formal comparison. No claim of resolved main tails, reduced total memory or final shipping performance follows from this experiment.

Reproduce the independent offline validation from the repository root, outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/rle-twohit-abba/analyze.mjs
```

The original inputs remain at [original-A/raw.json](original-A/raw.json), [candidate-B/raw.json](candidate-B/raw.json), [candidate-B2/raw.json](candidate-B2/raw.json) and [original-A2/raw.json](original-A2/raw.json). [analysis.json](analysis.json) preserves every lifetime/pooled distribution, all source/provider/pixel/fact checks, full resource differences, cumulative cost records and regressions.
