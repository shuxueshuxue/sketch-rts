# Canonical ABBA: two-hit/16 MiB has significant CPU regressions

Original PNG bytes are archived without changing raw/proof/helper/source bytes; before rerunning the unchanged analyzer, restore `original-A`, `candidate-B`, `candidate-B2` and `original-A2` with `python3 scripts/art-card-latency-budget-evidence-archive.py --materialize --folder rle-budget-canonical-abba/<arm>` from the repository root, following the [restore instructions and receipt](../evidence-archives/README.md).

The canonical comparison does **not** support making the joint two-hit/16 MiB policy the global default. With hidden population 0, pooled CPU mean rises approximately **16.5%**, although real-render wall improves approximately 4.35%. With hidden population 9,900, CPU mean rises approximately **4.57%** and real-render wall approximately **6.48%**. Both populations reduce reported ongoing CPU-buffer ownership by 3,028,248 bytes, but add 77 actual Canvas misses. The populations are reported separately; their means are not mixed to conceal the larger-world regression.

The [mixed-scene ABBA](../rle-budget-abba/report.md) shows a 55.3% buffer-peak reduction with timing regressions. That memory result must not replace this canonical evidence. The simpler budget-only control is the next useful comparison before accepting the extra admission mechanism. No budget-only result or production integration is included here.

## Protocol and strict evidence

All runs use source `aec09d620801dd07852042732831e5b2de1c4193`, one native-mip bank, current mask/peak/uploader/shader/artist code, and only the selected complete cache class differs. Original/current/corpus cache SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`; candidate is `ace8a4a40d06107dd342e6173dc45a08c764ab177d41824fafd7e2999933eade`.

This is the joint admission and constructor-default budget comparison, original 48 MiB versus candidate 16 MiB. The CLI budget argument checks the class's actual default; it does not override the constructor. The exact current `PaintedCardBatches` cache import selects the entire external class, served from run-start archived bytes. Both modules are prepared without constructing classes before cycles.

Chronological order is `original-A`, `candidate-B`, `candidate-B2`, `original-A2`. Each run has two recreated lifetimes at each hidden population 0 and 9,900, with 360 paced CPU and 18 real frames per lifetime. There are 100 visible units in each case. The original sample grid begins at `n=114`, and real frames begin at `n=480`. All first/slow lifetimes and cold samples remain included.

The [independent analyzer](analyze.mjs) exits 0 with no violations. Its [analysis.json](analysis.json) checks:

- Four complete runs, 16 population/lifetime cases, matching settings/device, zero browser/network/GL failures and valid disposal.
- **5,760 CPU clocks**, same actual visible facts/captured snapshot hashes and original fixed schedules.
- Common 295-entry initial/final client-source SHA maps, archived harness/helper/fixture/loader/class bytes, selected complete-class provider path/SHA, balanced preparation and frozen sources.
- Actual runtime 48/16 MiB budget proofs, encoded-byte accounting, independently bounded encoded entries and probation keys, and admission counters.
- **48 PNGs decoded at zero RGBA tolerance**, with corresponding raw PNG SHA equality, and **16 visible-fact records**.
- **48 before/empty/returned snapshots**, strict GPU materialization/upload/copy byte and call counts, pages/native mips/capacity, geometry/chunks/render order, masks, GPU ownership/peaks and phase render/content equality. Every non-timing cache/CPU ownership/peak difference is retained.

Raw inputs and pictures are unchanged and input hashes are rechecked after processing. The environment is Chromium/ANGLE SwiftShader, 1280 × 720, DPR 1, zoom 0.75. The performance harness does not add actual picking queries or record every internal graphics command; semantic/picking/lifecycle correctness is separate. It does not independently archive every public resource or served browser-module response.

## Hidden population 0

Per policy, all four lifetimes contribute 1,440 CPU samples and 72 real frames. Raw samples are pooled before quantiles rather than averaging lifetime percentiles. Quantiles select sorted index `floor(count × q)`, capped at the last sample. Durations are milliseconds.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 1440 | 3.820 | 4.449 | 15.1 | 18.9 | 23.0 | 35.8 | 0 / 0 | 3 / 0 |
| World3D CPU | 1440 | 3.323 | 3.879 | 14.4 | 17.7 | 22.5 | 35.0 | 0 / 0 | 2 / 0 |
| Canvas/coordinator residual | 1440 | 0.497 | 0.570 | 0.7 | 0.8 | 2.3 | 3.8 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 480 | 6.986 | 8.830 | 20.6 | 31.6 | 29.7 | 42.3 | 0 / 0 | 3 / 0 |
| Repeated CPU tick | 960 | 2.237 | 2.259 | 6.1 | 6.0 | 11.4 | 11.4 | 0 / 0 | 0 / 0 |
| Repeat phase 1 | 480 | 2.013 | 1.988 | 4.8 | 5.0 | 12.5 | 9.3 | 0 / 0 | 0 / 0 |
| Repeat phase 2 | 480 | 2.461 | 2.530 | 8.1 | 8.0 | 11.0 | 14.4 | 0 / 0 | 0 / 0 |
| Real completion wall | 72 | 162.256 | 155.203 | 358.9 | 328.6 | 436.6 | 422.1 | 72 / 72 | 72 / 68 |
| Real submission | 72 | 5.389 | 5.932 | 12.7 | 16.3 | 28.0 | 38.4 | 0 / 0 | 0 / 0 |
| Real frame-start interval | 68 | 171.313 | 164.568 | 365.3 | 334.8 | 442.7 | 428.8 | 68 / 68 | 68 / 64 |
| First cold real | 4 | 388.150 | 380.000 | 436.6 | 422.1 | 436.6 | 422.1 | 4 / 4 | 4 / 4 |
| Subsequent real | 68 | 148.968 | 141.979 | 259.4 | 248.3 | 306.8 | 302.2 | 68 / 68 | 68 / 64 |
| Fence wait wall | 72 | 156.847 | 149.260 | 346.6 | 314.6 | 408.6 | 387.0 | 72 / 72 | 72 / 65 |
| Fence-poll call wall | 72 | 0.150 | 0.153 | 0.5 | 0.4 | 0.7 | 0.6 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 72 | 156.606 | 149.015 | 345.8 | 314.2 | 407.9 | 386.3 | 72 / 72 | 72 / 65 |
| Empty-view completion wall | 4 | 61.550 | 61.600 | 66.3 | 69.0 | 66.3 | 69.0 | 4 / 0 | 4 / 0 |
| Empty-view submission | 4 | 8.775 | 6.225 | 11.4 | 7.0 | 11.4 | 7.0 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 4 | 121.500 | 124.150 | 132.7 | 152.7 | 132.7 | 152.7 | 4 / 4 | 4 / 4 |
| Returned-view submission | 4 | 2.925 | 3.050 | 3.2 | 3.3 | 3.2 | 3.3 | 0 / 0 | 0 / 0 |

The CPU maximum rises from 39.2 to 70.0 ms, and three CPU samples now exceed 50 ms. The extra CPU work is concentrated on fresh ticks. The real-wall improvement is retained as an observed favorable result, despite its opposing CPU/submission changes; without a trace this comparison cannot assign a particular internal graphics cause.

## Hidden population 9,900

This population independently contributes 1,440 CPU samples and 72 real frames per policy under the same quantile definition.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 1440 | 10.557 | 11.039 | 36.1 | 39.6 | 46.5 | 48.7 | 8 / 0 | 12 / 0 |
| World3D CPU | 1440 | 9.387 | 9.830 | 32.7 | 36.7 | 42.1 | 46.4 | 6 / 0 | 8 / 0 |
| Canvas/coordinator residual | 1440 | 1.170 | 1.208 | 3.0 | 3.4 | 10.4 | 10.9 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 480 | 26.642 | 28.227 | 42.8 | 46.0 | 54.7 | 55.9 | 7 / 0 | 12 / 0 |
| Repeated CPU tick | 960 | 2.515 | 2.444 | 6.5 | 6.5 | 13.1 | 14.6 | 1 / 0 | 0 / 0 |
| Repeat phase 1 | 480 | 2.330 | 2.146 | 5.6 | 5.3 | 11.2 | 11.2 | 1 / 0 | 0 / 0 |
| Repeat phase 2 | 480 | 2.700 | 2.742 | 7.8 | 8.4 | 13.9 | 17.5 | 0 / 0 | 0 / 0 |
| Real completion wall | 72 | 148.885 | 158.535 | 354.0 | 336.8 | 382.4 | 403.0 | 72 / 68 | 72 / 69 |
| Real submission | 72 | 10.449 | 11.018 | 30.1 | 32.4 | 35.3 | 49.2 | 0 / 0 | 0 / 0 |
| Real frame-start interval | 68 | 158.628 | 168.663 | 363.3 | 346.0 | 385.2 | 418.4 | 68 / 66 | 68 / 66 |
| First cold real | 4 | 364.900 | 378.200 | 382.4 | 403.0 | 382.4 | 403.0 | 4 / 4 | 4 / 4 |
| Subsequent real | 68 | 136.178 | 145.613 | 250.1 | 258.4 | 286.9 | 277.0 | 68 / 64 | 68 / 65 |
| Fence wait wall | 72 | 138.424 | 147.508 | 323.1 | 304.4 | 347.1 | 368.0 | 72 / 60 | 72 / 66 |
| Fence-poll call wall | 72 | 0.132 | 0.129 | 0.4 | 0.3 | 0.6 | 0.4 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 72 | 138.219 | 147.294 | 322.8 | 304.3 | 347.0 | 367.7 | 72 / 60 | 72 / 66 |
| Empty-view completion wall | 4 | 64.000 | 59.950 | 71.7 | 67.8 | 71.7 | 67.8 | 4 / 0 | 4 / 0 |
| Empty-view submission | 4 | 5.300 | 5.375 | 6.3 | 5.8 | 6.3 | 5.8 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 4 | 119.675 | 134.275 | 140.6 | 157.2 | 140.6 | 157.2 | 4 / 4 | 4 / 4 |
| Returned-view submission | 4 | 3.500 | 3.875 | 3.7 | 4.4 | 3.7 | 4.4 | 0 / 0 | 0 / 0 |

Mean/p95/p99 CPU all worsen. Real p95 improves but real mean, p99, cold/subsequent mean and returned wall worsen. Selecting real p95 alone would conceal the regression. Full CPU contains World3D and Canvas/coordinator is residual; fence wait contains yields/polls. The rows cannot be summed. Complete wall includes graphics completion and scheduling, not hardware GPU nanoseconds or directly measured FPS.

## Every lifetime

Each row retains 360 CPU and 18 real frames. With 18 real samples, lifetime p95/p99 both select the maximum. No first/slow lifetime is filtered.

| Run | Hidden | Lifetime | CPU mean | CPU p95 | CPU p99 | CPU >50 | CPU >100 | Real mean | Real p95 / p99 | Cold first real | Subsequent real mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| original-A | 0 | 0 | 3.661 | 14.9 | 20.6 | 0 | 0 | 162.033 | 369.6 | 369.6 | 149.824 |
| original-A | 0 | 1 | 3.836 | 14.7 | 19.8 | 0 | 0 | 158.633 | 387.5 | 387.5 | 145.171 |
| candidate-B | 0 | 0 | 4.479 | 18.9 | 37.5 | 1 | 0 | 154.817 | 422.1 | 422.1 | 139.094 |
| candidate-B | 0 | 1 | 4.806 | 21.4 | 34.8 | 0 | 0 | 143.833 | 328.6 | 328.6 | 132.965 |
| candidate-B2 | 0 | 0 | 3.944 | 17.6 | 34.0 | 0 | 0 | 158.117 | 366.0 | 366.0 | 145.888 |
| candidate-B2 | 0 | 1 | 4.569 | 18.9 | 38.7 | 2 | 0 | 164.044 | 403.3 | 403.3 | 149.971 |
| original-A2 | 0 | 0 | 3.563 | 14.1 | 29.4 | 0 | 0 | 164.083 | 436.6 | 436.6 | 148.053 |
| original-A2 | 0 | 1 | 4.220 | 19.7 | 27.0 | 0 | 0 | 164.272 | 358.9 | 358.9 | 152.824 |
| original-A | 9900 | 0 | 10.682 | 37.6 | 44.1 | 1 | 0 | 144.494 | 354.0 | 354.0 | 132.171 |
| original-A | 9900 | 1 | 9.880 | 34.2 | 41.0 | 0 | 0 | 140.267 | 367.9 | 367.9 | 126.876 |
| candidate-B | 9900 | 0 | 11.126 | 38.9 | 48.5 | 3 | 0 | 161.356 | 403.0 | 403.0 | 147.141 |
| candidate-B | 9900 | 1 | 11.448 | 41.0 | 47.5 | 1 | 0 | 156.928 | 378.9 | 378.9 | 143.871 |
| candidate-B2 | 9900 | 0 | 10.608 | 39.3 | 49.9 | 3 | 0 | 145.783 | 336.8 | 336.8 | 134.547 |
| candidate-B2 | 9900 | 1 | 10.971 | 40.1 | 55.8 | 5 | 0 | 170.072 | 394.1 | 394.1 | 156.894 |
| original-A2 | 9900 | 0 | 10.959 | 36.1 | 49.1 | 3 | 0 | 152.083 | 355.3 | 355.3 | 140.129 |
| original-A2 | 9900 | 1 | 10.707 | 38.2 | 51.6 | 4 | 0 | 158.694 | 382.4 | 382.4 | 145.535 |

ABBA reduces simple order drift but four lifetimes per population/policy do not establish stable tail probabilities or universal hardware ratios. The individual variation remains visible alongside the pooled results.

## Memory and true Canvas work

The following resource/counter values match across both hidden populations and every corresponding lifetime and before/empty/returned phase:

| Resource/counter | Original | Candidate |
| --- | ---: | ---: |
| Reported owned CPU buffers | 13,143,872 bytes | 10,115,624 bytes |
| Tracked owned CPU-buffer peak | 15,126,336 bytes | 12,098,088 bytes |
| Encoded payload | 7,859,264 bytes | 4,831,016 bytes |
| Encoder scratch | 131,072 bytes | 131,072 bytes |
| Cache tracked owned buffers | 7,990,336 bytes | 4,962,088 bytes |
| Encoded entries | 129 | 77 |
| Cache hits / misses | 413 / 129 | 336 / 206 |
| Evictions / backoffs / bypass | 0 / 0 / 0 | 0 / 0 / 0 |
| Cumulative admission skips / admitted | Not recorded | 129 / 77 |
| Current probation keys | Not recorded | 52 |
| Encoded budget | 50,331,648 bytes | 16,777,216 bytes |

Ongoing tracked CPU ownership decreases **3,028,248 bytes (approximately 23.0%)** and tracked peak approximately 20.0%. These are buffer-accounting measurements, not complete physical RAM or JavaScript metadata profiles. Probation keys/Map/string/object bytes remain **unmeasured**; the separate 1,024 key-count bound is not a measured byte estimate. Both budgets are above the observed encoded occupancy, and neither side has an eviction or backoff in this workload. The source/counters therefore point to admission withholding first observations as the relevant difference here; the joint experiment still must not be advertised as an isolated budget study.

Each candidate lifetime makes **77 extra true Canvas misses (129→206)** and loses 77 recoveries. GPU-card materialization stays 542 before capture; that count includes recovery and must not be equated with Canvas painter calls. All GPU byte/call/layout/order invariants remain exact. The changed non-timing fields are cache payload/owned bytes/entries/hits/misses/budget, new admission/probation counters and total/peak CPU-buffer ownership. No other recorded difference is omitted.

## Cumulative cost by population

These are per-lifetime mean before-capture counters, including preparation/warmup, CPU/real sampling and capture work. Cache stage overlaps cache measured work, and avoided-paint credit estimates older entry cost; neither is a measured total-frame counterfactual.

| Cumulative duration | H0 original | H0 candidate | H9900 original | H9900 candidate |
| --- | ---: | ---: | ---: | ---: |
| Cache measured work | 276.375 ms | 217.525 ms | 240.975 ms | 198.350 ms |
| Estimated avoided paint/readback | 1175.675 ms | 1160.250 ms | 1131.700 ms | 917.500 ms |
| Paint stage | 47.950 ms | 78.675 ms | 42.825 ms | 64.525 ms |
| Readback stage | 326.325 ms | 545.825 ms | 297.950 ms | 494.875 ms |
| Cache stage | 278.600 ms | 219.650 ms | 242.700 ms | 200.950 ms |
| Mask stage | 326.275 ms | 324.025 ms | 321.525 ms | 314.100 ms |
| Row flip | 13.125 ms | 26.275 ms | 13.500 ms | 23.650 ms |
| Slot work | 5.675 ms | 7.600 ms | 8.225 ms | 7.500 ms |
| GPU-transfer submission wall | 414.425 ms | 437.450 ms | 400.525 ms | 406.225 ms |

Codec work decreases, but cumulative readback increases **219.500 ms at H0** and **196.925 ms at H9900**. This matches the loss of source recoveries as an actionable cost, rather than a reason to claim that lower codec counters alone improve the renderer. The trace does not establish a particular graphics-command cause for the mixed directions in real-wall results.

The significant canonical CPU regression and larger-world completion-wall regression argue against the two-hit complexity as the global default. A one-line budget-only control can test whether the mixed memory-peak benefit is available with simpler behavior. Any final policy needs fresh correctness and complete timing/resource tradeoff evidence. This report includes no later control result and no final shipping speedup claim.

Reproduce the independent offline verification outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/rle-budget-canonical-abba/analyze.mjs
```

All four original inputs remain at [original-A/raw.json](original-A/raw.json), [candidate-B/raw.json](candidate-B/raw.json), [candidate-B2/raw.json](candidate-B2/raw.json) and [original-A2/raw.json](original-A2/raw.json). [analysis.json](analysis.json) retains the separate hidden-population pools, every lifetime, source/provider/image/fact checks and complete resource/cost/regression records.
