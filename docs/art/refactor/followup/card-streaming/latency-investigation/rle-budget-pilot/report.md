# 16 MiB two-hit cache: one-lifetime pilot

Original PNG bytes are archived without changing raw/proof/helper/source bytes; before rerunning the unchanged analyzer, restore both `original-A` and `candidate-B` with `python3 scripts/art-card-latency-budget-evidence-archive.py --materialize --folder rle-budget-pilot/<arm>` from the repository root, following the [restore instructions and receipt](../evidence-archives/README.md).

This pilot demonstrates a much lower **tracked CPU-buffer peak**, from **60,687,364 to 27,131,360 bytes (55.3%)**, while before/empty/returned ongoing ownership matches the original after both caches enter backoff and release their buffers. It also makes **123 more true Canvas misses**, with lower codec work but more cumulative readback time. CPU mean is lower in this single observation, while real-render completion-wall mean is **1.92% higher**. The policy merits the planned full ABBA comparison; this pilot is not a shipping result or evidence of stable tail improvement.

This compares a **joint admission and constructor-default budget policy**: original complete cache class at 48 MiB, versus two-hit complete class at 16 MiB. It does not isolate budget alone or claim a same-budget admission comparison. The budget CLI value is an expectation checked against runtime counters, not a constructor override. No slow/first sample is excluded.

## Provenance and verification

Core source is `aec09d620801dd07852042732831e5b2de1c4193`, with one native-mip bank and unchanged current mask, peak, uploader, artist and geometry code. Original/current/corpus cache SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`. External candidate SHA is `ace8a4a40d06107dd342e6173dc45a08c764ab177d41824fafd7e2999933eade`.

The entire original or candidate class is selected only for the exact current `PaintedCardBatches` cache import; loaded class bytes come from run-start snapshots. Both modules are imported without constructing classes before sampling. The runtime budget expectations are 50,331,648 bytes for original and 16,777,216 for candidate. The actual driver records these under `cacheIsolation.expectedBudgets`, and before/empty/returned `cacheBudgetValidation` records independently match each class's actual statistics.

The [independent analyzer](analyze.mjs) exits 0 with no violations. Its [analysis.json](analysis.json) records all checks and input SHA values:

- Two complete runs, one recreated lifetime per policy, 60 paced CPU and 12 real frames, common mixed/hidden-0 device/settings/fixture and valid GL/disposal.
- **120 CPU clocks**, preserving `n=114..173`, `tick=floor(n/3)`, the first real jump to `n=480` and all cold/slow samples.
- Matching 295-entry client-source SHA maps and initial/final snapshots, harness/fixtures/helpers/loader/source archives, provider SHA/path and run-start compile route.
- **6 decoded PNGs at zero RGBA tolerance**, with corresponding raw PNG SHA equality, plus **2 visible-fact records**, actual fact hashes and asset coverage.
- **6 before/empty/returned snapshots**, with exact GPU materialization/upload/copy byte and call counts, pages/native mips/capacity, geometry/chunks/order, GPU ownership/peaks and visible-content/render facts.
- Separate 1,024 encoded-entry and 1,024 probation-key limits, selected runtime budgets, byte-accounting identities, and every cache/CPU peak difference.

The original raw files and screenshots are unchanged. The environment is Chromium/ANGLE SwiftShader, 1280 × 720, DPR 1, zoom 0.75. This performance harness does not add actual picking queries or independently archive every served public-resource/module response; separate semantic and native picking/visual/lifecycle proofs remain necessary.

## All timing results

Each policy has only one lifetime. Order is original then candidate, so this is not balanced ABBA and cannot remove order drift. Quantiles select sorted index `floor(count × q)`, capped at the last sample. Durations are milliseconds. With 12 real samples, p95 and p99 both select the maximum. A single cold/empty/return value has no meaningful tail distribution.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 60 | 42.690 | 39.252 | 120.3 | 115.6 | 472.2 | 379.0 | 20 / 7 | 20 / 6 |
| World3D CPU | 60 | 42.350 | 38.955 | 120.0 | 115.3 | 470.1 | 378.6 | 20 / 7 | 20 / 6 |
| Canvas/coordinator residual | 60 | 0.340 | 0.297 | 0.5 | 0.5 | 2.1 | 0.6 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 20 | 74.580 | 66.190 | 472.2 | 379.0 | 472.2 | 379.0 | 11 / 1 | 11 / 1 |
| Repeated CPU tick | 40 | 26.745 | 25.782 | 120.3 | 115.6 | 140.8 | 145.5 | 9 / 6 | 9 / 5 |
| Repeat phase 1 | 20 | 22.680 | 22.410 | 116.1 | 115.6 | 116.1 | 115.6 | 4 / 3 | 4 / 3 |
| Repeat phase 2 | 20 | 30.810 | 29.155 | 140.8 | 145.5 | 140.8 | 145.5 | 5 / 3 | 5 / 2 |
| Real completion wall | 12 | 434.342 | 442.683 | 1470.2 | 1415.3 | 1470.2 | 1415.3 | 12 / 12 | 12 / 12 |
| Real submission | 12 | 51.625 | 50.700 | 264.2 | 251.8 | 264.2 | 251.8 | 3 / 3 | 3 / 3 |
| Real frame-start interval | 11 | 467.118 | 471.182 | 1471.7 | 1416.5 | 1471.7 | 1416.5 | 11 / 11 | 11 / 11 |
| First cold real | 1 | 1470.200 | 1415.300 | 1470.2 | 1415.3 | 1470.2 | 1415.3 | 1 / 1 | 1 / 1 |
| Subsequent real | 11 | 340.173 | 354.264 | 1062.0 | 1097.7 | 1062.0 | 1097.7 | 11 / 11 | 11 / 11 |
| Fence wait wall | 12 | 382.700 | 391.975 | 1206.0 | 1163.5 | 1206.0 | 1163.5 | 12 / 12 | 12 / 12 |
| Fence-poll call wall | 12 | 0.333 | 0.417 | 0.6 | 1.6 | 0.6 | 1.6 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 12 | 382.225 | 391.433 | 1205.2 | 1162.3 | 1205.2 | 1162.3 | 12 / 12 | 12 / 12 |
| Empty-view completion wall | 1 | 56.100 | 66.500 | 56.1 | 66.5 | 56.1 | 66.5 | 1 / 0 | 1 / 0 |
| Empty-view submission | 1 | 6.700 | 6.900 | 6.7 | 6.9 | 6.7 | 6.9 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 1 | 1341.700 | 1350.800 | 1341.7 | 1350.8 | 1341.7 | 1350.8 | 1 / 1 | 1 / 1 |
| Returned-view submission | 1 | 233.500 | 229.200 | 233.5 | 229.2 | 233.5 | 229.2 | 1 / 1 | 1 / 1 |

CPU mean decreases 3.438 ms, but its p50 increases from 6.9 to 13.3 ms. Repeated-phase-2 tail and mean subsequent-real wall worsen. The full real mean increases 8.342 ms even with a lower first cold sample. These results must all be retained when deciding whether the larger study is worthwhile.

CPU measurements are nested/residual, and fence wait includes yields/polls; these rows cannot be added as independent costs. Real completion wall includes graphics completion and scheduler effects and is neither a GPU timer nor directly measured FPS.

## Resource and cache tradeoff

| Resource/counter | Original | Candidate |
| --- | ---: | ---: |
| Constructor-default encoded budget | 50,331,648 bytes | 16,777,216 bytes |
| Tracked owned CPU-buffer peak | 60,687,364 bytes | 27,131,360 bytes |
| Peak pending RGBA | 1,982,464 bytes | 1,982,464 bytes |
| Before owned CPU buffers | 7,787,776 bytes | 7,787,776 bytes |
| Empty owned CPU buffers | 3,657,984 bytes | 3,657,984 bytes |
| Returned owned CPU buffers | 7,525,632 bytes | 7,525,632 bytes |
| Before cache payload / scratch / encoded entries | 0 / 0 / 0 | 0 / 0 / 0 |
| Before cache hits / misses | 153 / 1,573 | 30 / 1,696 |
| Returned cache hits / misses | 153 / 1,643 | 30 / 1,766 |
| Before evictions | 832 | 255 |
| Before backoffs / remaining bypass | 1 / 3,778 | 1 / 3,796 |
| Returned remaining bypass | 3,708 | 3,726 |
| Cumulative admission skips / admitted | Not recorded | 982 / 414 |
| Current probation keys, all three endpoints | Not recorded | 0 |

The tracked peak reduction is **33,556,004 bytes**. Both policies release encoded buffers and scratch on backoff, so the 48 MiB candidate's sustained +50 MB issue does not occur at these endpoints. There is no evidence of a lower endpoint than original here: endpoints are equal. These buffer counters do not measure all Canvas backing, Map/key/object metadata, transient JavaScript arrays or total physical process memory.

Encoded entries and probation keys each have their own 1,024 cap. Ghost key/Map metadata bytes are **unmeasured**, not assigned invented byte sizes. Their zero endpoint count does not prove that no metadata was allocated earlier or establish an observed peak ghost count. Post-cycle forced-GC heap samples remain in the raw/derived records but do not replace active buffer-peak accounting.

The candidate loses 123 recoveries and makes 123 more true Canvas misses at both the before and returned captures. GPU-card materialization still counts 1,726 before capture, with identical upload/copy work and layout. This counter includes CPU recovery and must not be mistaken for the count of actual Canvas painter executions.

The complete changed non-timing fields are bypass requests, cache hits/misses/evictions/budget, the new admission/probation fields, and tracked peak CPU bytes. All remaining recorded non-timing card fields and phase render/content facts match; GPU quality/calls/bytes/order are strict invariants.

## Cumulative costs

These counters include preparation, warmup, timed CPU/real samples and capture work. They do not isolate the 60 timed CPU rows, and credited avoided paint/readback is an estimate based on older entry cost.

| Cumulative before-capture duration | Original | Candidate |
| --- | ---: | ---: |
| Cache measured work | 896.9 ms | 310.7 ms |
| Estimated avoided paint/readback | 533.7 ms | 100.5 ms |
| Paint stage | 495.1 ms | 486.6 ms |
| Readback stage | 4567.3 ms | 4767.9 ms |
| Cache stage | 907.9 ms | 317.9 ms |
| Mask stage | 612.8 ms | 611.8 ms |
| Row flip | 127.7 ms | 135.0 ms |
| Slot work | 17.8 ms | 15.2 ms |
| GPU-transfer submission wall | 1298.5 ms | 1191.3 ms |

Lower codec cost accompanies higher readback cost and fewer recoveries. Cache stage overlaps cache measured work and cannot be added to it. Without a per-sample profiler/trace, the pilot does not attribute the real-wall change to a particular upload or graphics wait.

The clearly lower measured buffer peak justifies a larger fixed-protocol ABBA comparison. That next experiment must include all original cold/slow lifetimes and the memory/miss/wall tradeoff; it must not claim that budget alone caused any improvement. This report includes only this pilot's evidence.

Reproduce the independent offline checks outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/rle-budget-pilot/analyze.mjs
```

The [original input](original-A/raw.json), [candidate input](candidate-B/raw.json) and [complete derived analysis](analysis.json) remain available. No earlier RLE/upload experiment, tool or raw artifact was overwritten.
