# Default-budget-only mixed ABBA

The 16 MiB constructor default reduced measured peak CPU buffer ownership by **56.57%**. Across all four lifetimes per policy, CPU sample mean fell **5.57%** and completed real-frame wall mean fell **2.91%**. It also caused **150 additional fresh Canvas misses per lifetime**, worsened CPU p99 and fresh-tick p95, increased real submission mean, and made the return-to-view wall mean worse. This is a useful memory tradeoff candidate, not a resolution of the remaining stalls. The canonical workload still needs its separate below-cap identity check before a default decision.

Reproduce the offline audit with `node docs/art/refactor/followup/card-streaming/latency-investigation/rle-budget-only-abba/analyze.mjs`. [analysis.json](analysis.json) retains raw distributions, every lifetime, every resource field and differences; the analyzer records its own SHA and all raw input SHAs. Historical input files were unchanged.

## What was compared

Four runs in ABBA order, `original-A`, `candidate-B`, `candidate-B2`, `original-A2`, each contain two complete lifetimes of the same mixed scene: 60 paced CPU samples, 12 real frames, hidden population 0, one bank and native mip policy. Both sides use client source `aec09d620801dd07852042732831e5b2de1c4193`, current peak accounting and current mask, and the same painter, shader, page allocator, upload and corrected draw order. Simulation is skipped equally.

The complete external cache class is selected at the current `PaintedCardBatches` import. The original provider SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`; candidate SHA is `f9c83fe94bcb5fd4136b5ae820911d6af880a50c1e240c8037853a29f3e3e78b`. Archived source bytes differ only at `constructor(private budget=48*1024*1024){}` → `constructor(private budget=16*1024*1024){}`. There is no new admission, ghost, probation, retention or codec algorithm. The budget is a constructor default from the provider, not a fixture constructor override. The existing budget-dependent churn threshold consequently changes from 96 to 32 MiB.

The audit passed all **24 PNGs at zero decoded RGBA tolerance**, including RGB beneath zero alpha; their recorded PNG hashes also matched. All eight visible-fact snapshots and **480 CPU sample clocks** matched. Initial/final client SHA maps, whole-provider snapshots, loader/harness/fixture helpers, selected modules, runtime budgets, original 12-field cache stats and explicit not-applicable probation fields were checked independently. All recorded GPU bytes, page capacities, resident mips, upload/copy counts, draw resources, geometry/order records and non-card phase fields were equal. There were no GL errors, source changes or incomplete disposal records.

## Timing results

Quantiles pool the raw samples from all four lifetimes per policy; they are not averages of per-lifetime quantiles. Values are milliseconds. Real wall includes completion polling and scheduling; it is not a GPU timer or a FPS measurement.

| Samples / metric | 48 MiB mean | 16 MiB mean | 48 / 16 p95 | 48 / 16 p99 | 48 / 16 >50 ms | 48 / 16 >100 ms |
|---|---:|---:|---:|---:|---:|---:|
| CPU full, 240 each | 41.423 | 39.116 | 122.7 / 103.1 | 441.7 / 466.2 | 77 / 71 | 31 / 14 |
| World3D CPU, 240 each | 41.080 | 38.802 | 122.4 / 102.8 | 441.4 / 465.7 | 73 / 69 | 31 / 13 |
| Fresh tick CPU, 80 each | 70.632 | 67.990 | 220.7 / 396.7 | 523.6 / 487.6 | 41 / 35 | 6 / 4 |
| Repeated tick CPU, 160 each | 26.819 | 24.679 | 117.5 / 103.1 | 147.2 / 140.9 | 36 / 36 | 25 / 10 |
| Real complete wall, 48 each | 441.833 | 428.956 | 1317.9 / 1293.9 | 1406.6 / 1385.6 | 48 / 48 | 48 / 48 |
| Real submission, 48 each | 50.590 | 52.983 | 252.1 / 265.9 | 256.4 / 309.5 | 12 / 12 | 12 / 12 |
| Real intervals, 44 each | 470.352 | 458.791 | 1318.7 / 1294.2 | 1420.1 / 1395.0 | 44 / 44 | 44 / 44 |
| First cold real, 4 each | 1349.100 | 1320.325 | 1406.6 / 1385.6 | 1406.6 / 1385.6 | 4 / 4 | 4 / 4 |
| Subsequent real, 44 each | 359.355 | 347.923 | 1052.0 / 1070.3 | 1160.5 / 1096.6 | 44 / 44 | 44 / 44 |
| Fence wait, 48 each | 391.240 | 375.958 | 1061.5 / 1005.9 | 1154.5 / 1140.1 | 48 / 48 | 48 / 48 |
| Empty-view wall, 4 each | 65.250 | 65.650 | 74.0 / 90.5 | 74.0 / 90.5 | 4 / 4 | 0 / 0 |
| Returned-view wall, 4 each | 1364.925 | 1384.950 | 1398.3 / 1407.7 | 1398.3 / 1407.7 | 4 / 4 | 4 / 4 |
| Returned submission, 4 each | 249.050 | 252.225 | 254.3 / 289.7 | 254.3 / 289.7 | 4 / 4 | 4 / 4 |

The CPU maximum changes 523.6 → 487.6 ms, but pooled CPU p99 and fresh-tick p95 still regress. All measured real frames exceed 100 ms on both sides. Canvas residual mean changes 0.343 → 0.314 ms; the full/World3D/residual values are nested, not three additive costs. Phase-1 repeated CPU mean/p95 changes 22.254/116.8 → 20.185/96.2 ms; phase-2 changes 31.384/146.1 → 29.172/139.4 ms. The analysis retains all polling/yield distributions too; a poll count is a count, not a duration.

All lifetimes are retained below. With 60 CPU and 12 real samples in one lifetime, CPU p99 and real p95/p99 are their respective maxima.

| Run / lifetime | CPU mean | CPU p95 | CPU max | CPU >50 / >100 | Real mean | Real max / first cold | Subsequent real mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| original-A / 0 | 40.117 | 123.8 | 220.7 | 20 / 10 | 428.508 | 1304.1 | 348.909 |
| original-A / 1 | 42.498 | 117.5 | 523.6 | 19 / 7 | 451.983 | 1317.9 | 373.264 |
| candidate-B / 0 | 37.460 | 107.9 | 396.7 | 15 / 4 | 441.600 | 1385.6 | 355.782 |
| candidate-B / 1 | 40.060 | 103.1 | 466.2 | 21 / 4 | 421.433 | 1271.9 | 344.118 |
| candidate-B2 / 0 | 38.853 | 131.8 | 471.2 | 18 / 3 | 420.625 | 1329.9 | 337.964 |
| candidate-B2 / 1 | 40.090 | 102.9 | 487.6 | 17 / 3 | 432.167 | 1293.9 | 353.827 |
| original-A2 / 0 | 40.122 | 116.9 | 441.7 | 18 / 7 | 452.692 | 1367.8 | 369.500 |
| original-A2 / 1 | 42.957 | 146.7 | 477.5 | 20 / 7 | 434.150 | 1406.6 | 345.745 |

## Memory and extra painting

Every original lifetime has tracked peak CPU buffer ownership **60,687,364 B**; every candidate lifetime has **26,356,908 B**, a reduction of **34,330,456 B / 56.57%**. Tracked peak RGBA buffer ownership remains 1,982,464 B. GPU ownership is unchanged. Active endpoint CPU ownership is identical at before 7,787,776 B, empty 3,657,984 B and returned 7,525,632 B. The cache has already backed off and released encoded payload/scratch at all these endpoints; equal endpoint values do not erase the measured peak difference.

| Cumulative before-view counter, each lifetime | 48 MiB | 16 MiB |
|---|---:|---:|
| Cache hits | 153 | 3 |
| Cache misses / fresh Canvas paintings | 1573 | 1723 |
| Cache evictions | 832 | 280 |
| Cache bypass requests | 3778 | 2773 |
| Cache backoffs | 1 | 1 |
| GPU card materializations, including cache recovery | 1726 | 1726 |

Returned-view cache misses are 1643 → 1793, again **+150**. Returned bypass requests are 3708 → 2703. GPU materialization counts include cache recovery and are not a fresh-paint counter. Encoded entry capacity remains 1024, and actual encoded bytes are checked against each budget. Owned cache bytes include reconstruction scratch and may exceed the encoded budget. Declared buffers do not measure total process memory, Canvas backing storage or existing JavaScript entry/key/Map metadata. Neither provider adds a ghost table; no such byte or count estimates were invented. Post-disposal heap snapshots are retained in the JSON and do not measure active cache ownership.

The following are mean cumulative before-view stage costs across all four lifetimes. They cover preparation and sampling together, not just the 60 timed CPU rows. Cache work is nested in the cache stage; do not sum both.

| Cumulative stage / estimate | 48 MiB ms | 16 MiB ms |
|---|---:|---:|
| Cache work | 896.975 | 264.825 |
| Estimated avoided paint | 523.475 | 9.325 |
| Paint | 442.500 | 472.375 |
| Canvas readback | 4453.100 | 4775.850 |
| Cache stage | 901.875 | 268.350 |
| Mask packing | 609.400 | 607.850 |
| Row flip | 144.650 | 155.825 |
| Slot assignment | 18.250 | 20.475 |
| GPU transfer submission | 1256.225 | 1339.475 |

The smaller budget trades less codec/cache work for more fresh paint and readback work. The avoided-paint value is an estimate, not a measured counterfactual frame speedup. These records do not include per-copy profiling, GC attribution or GPU timer queries, so the experiment cannot identify whether a graphics-channel wait moved between calls.

This result concerns the simple constructor-budget policy on the same current renderer. It does not establish stable tail behavior across devices or replace the planned canonical workload check. Earlier two-hit admission experiments and their regressions remain separate evidence; this candidate contains none of that added policy.
