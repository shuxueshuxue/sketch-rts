# Budget-only 16 MiB: pilot with unchanged algorithms

This one-lifetime pilot supports a larger comparison of the simpler budget change. The candidate changes **only the default constructor budget from 48 to 16 MiB**; get/put/clear/stats, codec, admission behavior and adaptive backoff code remain byte-identical. Tracked CPU-buffer peak decreases **34,330,456 bytes (56.57%)**, and all three endpoint ownership measurements remain equal to original. It also loses 150 source recoveries and adds 150 true Canvas misses.

The observed CPU mean decreases 1.67% and real completion-wall mean 0.53%, but this is a single original-then-candidate lifetime, not balanced ABBA or a stable speed result. CPU maximum worsens, subsequent-real mean worsens, and every real sample remains above 100 ms. All samples are retained. No two-hit/ghost mechanism is present or credited.

## Strict evidence

Core source is `aec09d620801dd07852042732831e5b2de1c4193`, with current one native-mip bank, mask, peak, uploader, shader and artist code. Original/current/corpus cache SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`; candidate is `f9c83fe94bcb5fd4136b5ae820911d6af880a50c1e240c8037853a29f3e3e78b`.

The [independent analyzer](analyze.mjs) verifies the archived candidate bytes by replacing exactly one original `constructor(private budget=48*1024*1024){}` with its 16 MiB version. It independently checks the actual `candidateExactSingleConstructorDifference` and runtime `noAdmissionMetadata` records, rather than requiring nonexistent aliases. The entire external class is selected only for the exact current `PaintedCardBatches` import, with run-start serving and balanced module preparation.

The analyzer exits 0 with no violations. [analysis.json](analysis.json) retains source/harness/provider hashes, **6 zero-difference decoded RGBA PNGs** and raw PNG SHA equality, **2 visible facts**, **120 CPU clocks**, and **6 resource snapshots**. GPU materialization/upload/copy bytes and counts, native page layout, geometry/chunks/order, masks, GPU ownership/peaks and visible/render facts remain exact. Original raw inputs and PNGs are unchanged and their input hashes are rechecked.

Actual encoded budgets are 50,331,648 and 16,777,216 bytes. Encoded entries remain capped at 1,024. Neither class has probation/admission/ghost statistics: these fields are absent from actual stats, and the corresponding validation fields are **null/not applicable**, not fabricated zeros. Budget constrains encoded payload, not encoder scratch or all JavaScript entry metadata.

The original 60 paced CPU/12 real schedule, first cold real jump to `n=480`, all slow samples, mixed/hidden-0 scene, device and viewport are preserved. The environment is Chromium/ANGLE SwiftShader at 1280 × 720, DPR 1, zoom 0.75. The timing harness adds no actual picking query or internal graphics trace; separate correctness proofs are required before integration.

## Timing observations

Durations are milliseconds. Quantiles select sorted index `floor(count × q)`, capped at the last sample. With 12 real samples, p95/p99 both select the maximum. Single cold/empty/returned observations have no meaningful tail distribution.

| Measurement | Samples per policy | Original mean | Candidate mean | Original p95 | Candidate p95 | Original p99 | Candidate p99 | Original >50 / >100 | Candidate >50 / >100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Full CPU presentation | 60 | 40.802 | 40.120 | 139.4 | 121.6 | 393.7 | 475.8 | 18 / 8 | 18 / 4 |
| World3D CPU | 60 | 40.467 | 39.828 | 138.9 | 121.1 | 393.3 | 475.4 | 18 / 8 | 18 / 4 |
| Canvas/coordinator residual | 60 | 0.335 | 0.292 | 0.6 | 0.5 | 2.5 | 0.6 | 0 / 0 | 0 / 0 |
| Fresh CPU tick | 20 | 66.730 | 70.435 | 393.7 | 475.8 | 393.7 | 475.8 | 9 / 1 | 9 / 1 |
| Repeated CPU tick | 40 | 27.837 | 24.962 | 139.4 | 121.6 | 149.5 | 145.1 | 9 / 7 | 9 / 3 |
| Repeat phase 1 | 20 | 22.290 | 21.825 | 114.0 | 121.6 | 114.0 | 121.6 | 4 / 3 | 4 / 2 |
| Repeat phase 2 | 20 | 33.385 | 28.100 | 149.5 | 145.1 | 149.5 | 145.1 | 5 / 4 | 5 / 1 |
| Real completion wall | 12 | 428.508 | 426.250 | 1397.2 | 1324.6 | 1397.2 | 1324.6 | 12 / 12 | 12 / 12 |
| Real submission | 12 | 50.575 | 55.033 | 257.4 | 298.5 | 257.4 | 298.5 | 3 / 3 | 3 / 3 |
| Real frame-start interval | 11 | 457.809 | 456.836 | 1402.7 | 1324.9 | 1402.7 | 1324.9 | 11 / 11 | 11 / 11 |
| First cold real | 1 | 1397.200 | 1324.600 | 1397.2 | 1324.6 | 1397.2 | 1324.6 | 1 / 1 | 1 / 1 |
| Subsequent real | 11 | 340.445 | 344.582 | 1025.3 | 1056.4 | 1025.3 | 1056.4 | 11 / 11 | 11 / 11 |
| Fence wait wall | 12 | 377.917 | 371.183 | 1139.7 | 1026.0 | 1139.7 | 1026.0 | 12 / 12 | 12 / 12 |
| Fence-poll call wall | 12 | 0.283 | 0.458 | 1.1 | 2.1 | 1.1 | 2.1 | 0 / 0 | 0 / 0 |
| Yielded completion wall | 12 | 377.475 | 370.500 | 1137.9 | 1023.6 | 1137.9 | 1023.6 | 12 / 12 | 12 / 12 |
| Empty-view completion wall | 1 | 59.400 | 65.900 | 59.4 | 65.9 | 59.4 | 65.9 | 1 / 0 | 1 / 0 |
| Empty-view submission | 1 | 7.100 | 7.100 | 7.1 | 7.1 | 7.1 | 7.1 | 0 / 0 | 0 / 0 |
| Returned-view completion wall | 1 | 1368.800 | 1380.300 | 1368.8 | 1380.3 | 1368.8 | 1380.3 | 1 / 1 | 1 / 1 |
| Returned-view submission | 1 | 250.500 | 245.700 | 250.5 | 245.7 | 250.5 | 245.7 | 1 / 1 | 1 / 1 |

CPU p50 decreases 17.6→8.1 ms but maximum increases 393.7→475.8 ms. Mean subsequent-real completion increases, as do real submission mean/max and returned wall. These regressions remain alongside the favorable means. CPU measurements are nested/residual and fence wait contains yields/polls; they cannot be summed. Completion wall includes graphics scheduling and is not a GPU timer or FPS result.

## Buffer peak and extra painting

| Resource/counter | Original | Candidate |
| --- | ---: | ---: |
| Tracked owned CPU-buffer peak | 60,687,364 bytes | 26,356,908 bytes |
| Peak pending RGBA | 1,982,464 bytes | 1,982,464 bytes |
| Before / empty / returned owned CPU buffers | 7,787,776 / 3,657,984 / 7,525,632 bytes | Same |
| Endpoint encoded payload / scratch / entries | 0 / 0 / 0 | 0 / 0 / 0 |
| Before cache hits / misses | 153 / 1,573 | 3 / 1,723 |
| Returned cache hits / misses | 153 / 1,643 | 3 / 1,793 |
| Evictions | 832 | 280 |
| Backoffs | 1 | 1 |
| Before / returned remaining bypass | 3,778 / 3,708 | 2,773 / 2,703 |

The lower budget also changes the original churn-trigger threshold from 96 to 32 MiB because the unchanged algorithm tests `budget × 2`. Budget-dependent cache behavior therefore legitimately changes: 150 fewer recoveries and 150 additional fresh Canvas misses. GPU-card materialization still totals 1,726 before capture and includes both fresh painting and CPU recovery; it is not a painter-call counter.

Both policies release their buffers at backoff, keeping endpoint ownership equal. The lower peak is measured declared-buffer ownership, not all physical process RAM, Canvas backing or Map/key/object metadata. There is no new ghost metadata to estimate. The complete changed non-timing fields are budget, bypass requests, hits/misses/evictions and tracked CPU-buffer peak; all other recorded resource/content/GPU fields match.

| Cumulative before-capture duration | Original | Candidate |
| --- | ---: | ---: |
| Cache measured work | 911.6 ms | 271.0 ms |
| Estimated avoided paint/readback | 529.7 ms | 8.8 ms |
| Paint stage | 464.9 ms | 497.1 ms |
| Readback stage | 4534.4 ms | 4968.5 ms |
| Cache stage | 915.2 ms | 274.0 ms |
| Mask stage | 626.5 ms | 636.4 ms |
| Row flip | 136.4 ms | 144.3 ms |
| Slot work | 20.7 ms | 22.4 ms |
| GPU-transfer submission wall | 1196.5 ms | 1290.8 ms |

These counters include preparation, warmup, samples and captures; they do not isolate the timed CPU subset. Cache stage overlaps measured cache work, and avoided-paint credit estimates older entry cost. Lower codec cost trades against higher paint/readback and cannot by itself establish full-frame improvement.

The repeatable-memory question warrants the planned full mixed ABBA and a canonical work-identity check below the cap. This pilot supplies no stable-tail or final shipping-speed claim and does not borrow benefits from the rejected two-hit policy.

Reproduce the independent offline check outside any measurement window:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/rle-budget-only-pilot/analyze.mjs
```

[Original input](original-A/raw.json), [candidate input](candidate-B/raw.json) and [complete analysis](analysis.json) retain every sample, phase resource, source/provider check and measured regression. Earlier tools and evidence remain intact.
