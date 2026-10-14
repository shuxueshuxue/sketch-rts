# Mixed-scene ABBA: two-hit admission with a 16 MiB budget

Original PNG bytes are archived without changing raw/proof/helper/source bytes; before rerunning the unchanged analyzer, restore `original-A`, `candidate-B`, `candidate-B2` and `original-A2` with `python3 scripts/art-card-latency-budget-evidence-archive.py --materialize --folder rle-budget-abba/<arm>` from the repository root, following the [restore instructions and receipt](../evidence-archives/README.md).

The complete comparison retains a strong **tracked CPU-buffer peak reduction of 55.3%**, but it does **not** reproduce the pilot's CPU speed improvement. Pooled CPU mean changes from **42.023 to 42.255 ms (+0.55%)**, and real-render completion-wall mean from **433.569 to 442.504 ms (+2.06%)**. CPU p95 and maximum also worsen. All four candidate lifetimes retain 123 additional true Canvas misses. The policy has a measured memory benefit and a measured timing tradeoff; it is not an overall speed improvement in this mixed scene.

This compares the joint policy of **two-hit admission plus a 16 MiB constructor-default encoded budget** against the original class's 48 MiB budget. It does not isolate admission or budget alone. The [one-lifetime pilot](../rle-budget-pilot/report.md) remains separate evidence and its approximately 8% lower CPU mean must not be carried forward as this formal result. Production integration remains undecided pending the canonical comparison and evaluation of whether a simpler budget change provides the memory benefit.

## Strict evidence

Core source is `aec09d620801dd07852042732831e5b2de1c4193`, with one native-mip bank and unchanged current mask, peak, uploader, shader, geometry and artist code. The original/current/corpus cache SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`; candidate is `ace8a4a40d06107dd342e6173dc45a08c764ab177d41824fafd7e2999933eade`. The entire external class is selected for only the exact current `PaintedCardBatches` import and served from run-start archived bytes. Neither the constructor default nor individual methods are overwritten by the harness.

The [independent analyzer](analyze.mjs) exits 0 with no violations. [analysis.json](analysis.json) records:

- Four complete ABBA runs, two independently recreated lifetimes per run, mixed/hidden-0 scene, original 60 paced CPU/12 real sample protocol, matching device/settings, zero browser/network/GL errors and valid disposal.
- **480 CPU clocks**, all original cold/slow samples, actual fact hashes, preserved `n=114..173` tick grid and real jump to `n=480`.
- Common initial/final 295-entry client-source SHA maps and archived provider/harness/helper/fixture bytes, balanced module setup and actual selected complete-class path/SHA.
- Runtime budget expectations and each before/empty/returned budget proof: original 50,331,648 bytes, candidate 16,777,216. The CLI budget value validates the default; it does not replace it.
- **24 PNGs decoded at zero RGBA tolerance**, with corresponding raw PNG SHA equality, **8 visible-fact/asset-coverage records**, and **24 resource snapshots**.
- Strict equality of GPU-card materialization, upload/copy call counts and bytes, pages/native mips/capacity, geometry/chunks/order, masks, GPU ownership/peaks and phase visible/render facts. All cache and CPU ownership/peak differences are fully recorded.

Both the encoded-entry cap and the probation-key cap are independently 1,024. Actual cache byte accounting and admission counters are checked, without inventing a ghost metadata byte estimate. Original raw files and pictures remain unchanged and input hashes are rechecked after analysis.

The environment is Chromium/ANGLE SwiftShader at 1280 × 720, DPR 1, zoom 0.75. Picture equality covers the captured views. This timing harness adds no actual picking queries or complete per-call graphics trace and does not archive every served public-resource byte; semantic/picking/lifecycle proofs are separate requirements.

## Pooled distributions

Chronological order is `original-A`, `candidate-B`, `candidate-B2`, `original-A2`. All samples from four lifetimes per policy are pooled before quantiles; lifetime percentiles are not averaged. Quantiles select sorted index `floor(count × q)`, capped at the final sample. Durations are milliseconds, including cold first real frames.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 240 | 42.023 | 42.255 | 118.1 | 124.3 | 458.5 | 459.5 | 77 / 29 | 75 / 26 |
| World3D CPU | 240 | 41.698 | 41.889 | 117.7 | 124.0 | 458.1 | 459.1 | 76 / 28 | 75 / 26 |
| Canvas/coordinator residual | 240 | 0.325 | 0.366 | 0.5 | 0.5 | 1.5 | 2.1 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 80 | 72.661 | 73.171 | 429.7 | 459.0 | 496.9 | 529.7 | 41 / 5 | 39 / 5 |
| Repeated CPU tick | 160 | 26.704 | 26.797 | 118.1 | 122.7 | 153.5 | 148.5 | 36 / 24 | 36 / 21 |
| Repeat phase 1 | 80 | 22.581 | 23.024 | 109.4 | 117.8 | 139.4 | 124.3 | 16 / 11 | 16 / 12 |
| Repeat phase 2 | 80 | 30.826 | 30.570 | 145.5 | 147.2 | 161.9 | 153.6 | 20 / 13 | 20 / 9 |
| Real completion wall | 48 | 433.569 | 442.504 | 1353.0 | 1356.1 | 1405.8 | 1411.7 | 48 / 48 | 48 / 48 |
| Real submission | 48 | 52.679 | 53.244 | 254.2 | 260.6 | 273.2 | 283.1 | 12 / 12 | 12 / 12 |
| Real frame-start interval | 44 | 462.439 | 469.368 | 1362.1 | 1365.8 | 1415.2 | 1416.4 | 44 / 44 | 44 / 44 |
| First cold real | 4 | 1366.750 | 1370.575 | 1405.8 | 1411.7 | 1405.8 | 1411.7 | 4 / 4 | 4 / 4 |
| Subsequent real | 44 | 348.734 | 358.134 | 1049.6 | 1089.9 | 1132.2 | 1117.6 | 44 / 44 | 44 / 44 |
| Fence wait wall | 48 | 380.873 | 389.248 | 1079.8 | 1101.6 | 1153.6 | 1151.1 | 48 / 48 | 48 / 48 |
| Fence-poll call wall | 48 | 0.404 | 0.444 | 1.3 | 1.3 | 1.7 | 1.5 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 48 | 380.288 | 388.625 | 1077.7 | 1099.7 | 1152.3 | 1149.4 | 48 / 48 | 48 / 48 |
| Empty-view completion wall | 4 | 60.925 | 59.525 | 61.5 | 67.1 | 61.5 | 67.1 | 4 / 0 | 4 / 0 |
| Empty-view submission | 4 | 6.575 | 6.400 | 7.6 | 7.5 | 7.6 | 7.5 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 4 | 1355.050 | 1328.050 | 1390.3 | 1355.7 | 1390.3 | 1355.7 | 4 / 4 | 4 / 4 |
| Returned-view submission | 4 | 240.625 | 243.250 | 247.0 | 256.1 | 247.0 | 256.1 | 4 / 4 | 4 / 4 |

CPU p50 worsens from 7.1 to 8.4 ms, p95 increases 6.2 ms, and the maximum rises from 496.9 to 529.7 ms. There are fewer CPU samples above 50/100 ms, but this does not mean all tails improve. The returned-camera wall improves, while headline and subsequent-real wall worsen. All these results are retained.

CPU rows are nested/residual, and fence wait contains yields/polls; those components cannot be added as independent costs. Real completion wall includes graphics completion and scheduling rather than hardware GPU nanoseconds or directly measured FPS. This unprofiled run cannot identify the internal command responsible for a particular long wait.

## Every lifetime

| Run | Lifetime | CPU mean | CPU p95 | CPU p99 / max | CPU >50 | CPU >100 | Real mean | Real p95 / p99 / max | First cold real | Subsequent real mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| original-A | 0 | 41.275 | 112.0 | 496.9 | 18 | 7 | 440.333 | 1405.8 | 1405.8 | 352.564 |
| original-A | 1 | 41.173 | 121.8 | 429.7 | 20 | 6 | 439.217 | 1378.5 | 1378.5 | 353.827 |
| candidate-B | 0 | 42.265 | 124.3 | 529.7 | 16 | 7 | 461.067 | 1313.4 | 1313.4 | 383.582 |
| candidate-B | 1 | 41.592 | 124.3 | 467.5 | 18 | 5 | 428.642 | 1411.7 | 1411.7 | 339.273 |
| candidate-B2 | 0 | 43.082 | 135.5 | 459.5 | 20 | 7 | 438.283 | 1401.1 | 1401.1 | 350.755 |
| candidate-B2 | 1 | 42.082 | 137.5 | 459.0 | 21 | 7 | 442.025 | 1356.1 | 1356.1 | 358.927 |
| original-A2 | 0 | 43.442 | 139.4 | 458.5 | 18 | 8 | 431.883 | 1329.7 | 1329.7 | 350.264 |
| original-A2 | 1 | 42.202 | 109.4 | 462.1 | 21 | 8 | 422.842 | 1353.0 | 1353.0 | 338.282 |

All 12 real frames in each lifetime exceed 50/100 ms. With 12 samples, p95/p99 select that lifetime maximum. No unfavorable first/slow lifetime is filtered. ABBA reduces simple order drift but four lifetimes per policy do not establish stable tail probabilities or portable hardware ratios.

## Stable memory and miss effects

The following non-timing effects are identical in all four candidate lifetimes compared with their corresponding original lifetimes:

| Resource/counter | Original | Candidate |
| --- | ---: | ---: |
| Encoded payload budget | 50,331,648 bytes | 16,777,216 bytes |
| Tracked owned CPU-buffer peak | 60,687,364 bytes | 27,131,360 bytes |
| Before owned CPU buffers | 7,787,776 bytes | 7,787,776 bytes |
| Empty owned CPU buffers | 3,657,984 bytes | 3,657,984 bytes |
| Returned owned CPU buffers | 7,525,632 bytes | 7,525,632 bytes |
| Peak pending RGBA | 1,982,464 bytes | 1,982,464 bytes |
| Before cache payload / scratch / entries | 0 / 0 / 0 | 0 / 0 / 0 |
| Before cache hits / misses | 153 / 1,573 | 30 / 1,696 |
| Returned cache hits / misses | 153 / 1,643 | 30 / 1,766 |
| Evictions | 832 | 255 |
| Before backoffs / remaining bypass | 1 / 3,778 | 1 / 3,796 |
| Returned remaining bypass | 3,708 | 3,726 |
| Cumulative admission skips / admitted | Not recorded | 982 / 414 |
| Current probation keys, all phases | Not recorded | 0 |

The measured buffer-peak reduction is **33,556,004 bytes**, stable across lifetimes. Both policies enter backoff and release their buffers, so endpoints remain equal; the sustained +50 MB seen in the [48 MiB two-hit experiment](../rle-twohit-abba/report.md) is absent at these endpoints. This is a lower tracked buffer peak, not proof of lower total physical process memory or every JavaScript allocation.

Encoded entries and probation keys each have a separate 1,024 cap. Map/key/object metadata bytes are unmeasured and are not assigned fabricated sizes. Zero probation keys after backoff does not establish the peak ghost count or imply that no metadata was allocated earlier. Tracked buffer ownership excludes such metadata and other unprofiled heap/Canvas overhead.

The candidate loses 123 recoveries and adds **123 actual Canvas misses (7.82%)** before capture, with the same cumulative difference on return. The GPU-card materialization counter remains 1,726 before capture; it includes both fresh painting and CPU-cache recovery. All upload bytes/calls/layout/order and visible content remain exact. The changed non-timing fields are budget/bypass, hits/misses/evictions, the new admission/probation fields and CPU-buffer peak. No other recorded card/phase resource difference is hidden.

## Cumulative workload

These per-lifetime mean counters include preparation, warmup, timed CPU/real samples and capture work. They do not isolate timed CPU rows, and credited avoided painting is an estimate based on older entry cost.

| Cumulative before-capture mean | Original | Candidate | Candidate minus original |
| --- | ---: | ---: | ---: |
| Cache measured work | 895.225 ms | 312.475 ms | −582.750 ms |
| Estimated avoided paint/readback | 511.325 ms | 106.450 ms | −404.875 ms |
| Paint stage | 456.550 ms | 516.975 ms | +60.425 ms |
| Readback stage | 4412.550 ms | 4857.350 ms | +444.800 ms |
| Cache stage | 900.725 ms | 318.025 ms | −582.700 ms |
| Mask stage | 616.800 ms | 617.300 ms | +0.500 ms |
| Row flip | 141.625 ms | 164.175 ms | +22.550 ms |
| Slot work | 18.200 ms | 18.700 ms | +0.500 ms |
| GPU-transfer submission wall | 1330.325 ms | 1359.725 ms | +29.400 ms |

Lower codec work accompanies more painting/readback. Cache stage overlaps measured cache work and must not be added to it. Lower cache cost alone does not establish a full-presentation win; the actual formal timing rows show the contrary mean changes here.

This experiment establishes a repeatable tracked memory-peak benefit and preserves its timing/miss disadvantages. Choosing the policy requires the canonical 0/9,900-hidden comparison and a simpler-budget control if the extra admission mechanism is to be justified. Neither future result is included in this report, and no overall speedup or solved long-tail claim is made.

Reproduce offline checks outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/rle-budget-abba/analyze.mjs
```

All four original inputs remain at [original-A/raw.json](original-A/raw.json), [candidate-B/raw.json](candidate-B/raw.json), [candidate-B2/raw.json](candidate-B2/raw.json) and [original-A2/raw.json](original-A2/raw.json). [analysis.json](analysis.json) retains every lifetime/distribution, resource difference, cumulative cost and measured regression, alongside source/provider/image/fact verification.
