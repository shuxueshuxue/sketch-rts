# Combined pipeline mixed ABBA

The combined candidate passes all recorded visual, fact, clock, source and provider checks. It reduces tracked peak CPU buffer ownership **56.59%** and before-view GPU texture ownership **9.10%**. Across every lifetime, CPU mean falls **3.77%**, while completed real-frame wall mean falls only **0.97%**. The CPU maximum regresses **470.9 → 696.9 ms**, fresh-tick CPU mean increases, and subsequent real-frame wall mean and tails regress slightly. This supports the resource benefit of the combined policy; it does **not** establish that the remaining long stalls are solved.

[analysis.json](analysis.json) retains every sample distribution, lifetime, source/provider proof and field-level resource difference. [report-summary.json](report-summary.json) contains a compact view of every lifetime and all numeric card/resource counters. Reproduce the offline audit with:

```sh
node docs/art/refactor/followup/card-streaming/latency-investigation/pipeline-abba/analyze.mjs
node docs/art/refactor/followup/card-streaming/latency-investigation/pipeline-abba/summarize.mjs
```

Both commands completed successfully. Input raw SHA values were checked before and after analysis and remained unchanged. No failed or unfavorable lifetime was removed.

## Comparison and provenance

The formal runs use client source **`aec09d620801dd07852042732831e5b2de1c4193`**, in order `reference-A`, `candidate-B`, `candidate-B2`, `reference-A2`. Each run has two complete lifetimes of the same mixed scene, hidden population 0, 60 paced CPU samples and 12 real frames per lifetime. Preparation, warming, first cold real frame and empty/returned-view measurements are retained; simulation is skipped equally. The viewport is 1280×720, DPR 1, zoom 0.75, with the same recorded browser/device and SwiftShader environment.

| Policy | Resident texture chain | Peak accounting | Mask module | CPU raster cache |
|---|---|---|---|---|
| Reference | One bank, full chain | Frozen 5b exact `stats` / `recordPeaks` prototype references on current instances | Frozen 5b | Original 48 MiB complete class |
| Candidate | One bank, native resident tail | Current methods | Current | Original complete class with default 16 MiB only |

Both retain the current painter, shader, uploader, allocator, corrected stable ordering, source artwork and rules. The reference is not an entire historical renderer and does not restore a historical ordering defect. This is a **combined-policy** comparison; percentages cannot be assigned to individual fixes or added to earlier experiments' percentages.

The old provider corpus is `5b356c7795068bb2a532ad1d486b3c22936cf735`. The cache's archived original SHA is `78d5a3b3f653fc97cf6251504bb81b2f8e17d7a5220d7331249b3750733171a0`; the external candidate SHA is `f9c83fe94bcb5fd4136b5ae820911d6af880a50c1e240c8037853a29f3e3e78b`. Its only source-byte difference is constructor default 48 → 16 MiB. There is no new ghost, admission, retention or codec policy; the existing budget-dependent churn threshold consequently changes. The candidate class supplies its own default, with no fixture constructor override.

For a new formal reproduction, use a detached checkout of the **AEC** client source and the frozen **5b** baseline; restore the external candidate from an archived `source-snapshot/candidate-card-raster-cache.ts`. Restore or verify the archived harness, parent harness, entry/fact fixture, bank helper, viewport metadata and peak helper hashes before running `scripts/art-card-pipeline-formal-proof.mjs` in reference/candidate mode with the recorded settings. Run four arms in the stated ABBA order under an exclusive measurement window. After production promotion to the 16 MiB default, running this old driver directly against the new HEAD is invalid: it deliberately requires the current source cache still match the original 48 MiB corpus. These historical measurements remain labelled AEC. Promotion and later upstream integration require separate provenance checks rather than relabelling this epoch.

Production promotion `37a8594314430a45b7ff822a4d43c28fcd3ad2b2` copies the exact candidate cache SHA above. The [upstream integration receipt](../upstream-integration.json) records that the client/shared/server trees and client-file byte SHAs are unchanged from promotion to `1e03c5fa1ae1cf17276ee20e5fb005573af1e861`, including that same `f9c83…e78b` runtime cache file. This establishes final provider provenance, not a claim that all AEC file hashes equal the promoted tree or that timing was rerun on final HEAD. Integrated **133 files / 1066 tests** and production build pass in [tests](../final-validation/tests.log), [build](../final-validation/production-build.log) and [commands](../final-validation/commands.json); final camera/picking validation remains independently recorded by its own proof.

## Strict audit

All **24 PNGs** match at **zero decoded RGBA tolerance**, including RGB under transparent alpha, and their recorded PNG SHAs are also identical. All eight visible fact snapshots and **480 CPU sample clocks** match. The initial/final client source maps, selected complete-class modules, frozen mask and peak dependency snapshots, archived helper/harness bytes, runtime method `toString` SHA values and actual two-instance method bindings pass. All recorded errors, failure arrays, GL errors and disposal checks are clear.

The reference full-chain selector and candidate native selector are checked separately. Runtime budgets are exactly 50,331,648 and 16,777,216 B. Cache stats retain the original 12-field interface, with explicit null/not-applicable probation validation and no admission/ghost fields. Actual loaded provider modules must match their archived source snapshots, rather than merely have a source file present.

Recorded baseline `three` resolution must equal the current-context resolved ID **within each record, including its query**. Opaque optimized temporary paths are not equated across runs. This establishes the recorded current package resolver contract, not a measured full browser module-graph singleton or optimized bundle byte hash.

Full/native policy changes physical resident keys, page layout, render segments and mip counters. Those are reported field by field, not incorrectly asserted identical. Scene coverage excludes resident cache-key identity; view-index content excludes mip classifications. Visible scene/content fields remain strict. The untimed residency snapshots only aggregate cards/pages/chunks; they do not record individual submitted instance IDs, matrices, feet or complete submission sequences. This audit therefore cannot independently prove that sequence or picking equivalence. The separate real-camera/picking proof remains necessary.

## All-sample timings

The table pools individual samples across four lifetimes per policy, not average quantiles. Values are milliseconds. Complete wall includes completion polling and scheduling, not GPU nanoseconds or FPS. Poll counts are counts and are not treated as frame-stall durations.

| Metric / samples each | Reference mean | Candidate mean | Reference / candidate p95 | Reference / candidate p99 | Reference / candidate >50 / >100 ms |
|---|---:|---:|---:|---:|---:|
| Full CPU / 240 | 44.013 | 42.356 | 127.8 / 112.3 | 470.0 / 469.9 | 84/35 / 75/17 |
| World3D CPU / 240 | 43.680 | 41.937 | 127.0 / 112.0 | 469.7 / 469.6 | 84/35 / 74/17 |
| Fresh-tick CPU / 80 | 75.169 | 76.108 | 463.4 / 463.2 | 470.9 / 696.9 | 48/7 / 39/5 |
| Repeated-tick CPU / 160 | 28.435 | 25.480 | 127.8 / 110.6 | 171.0 / 143.3 | 36/28 / 36/12 |
| Real complete wall / 48 | 435.542 | 431.325 | 1385.5 / 1356.3 | 1418.9 / 1377.4 | 48/48 / 48/48 |
| Real submission / 48 | 54.362 | 53.542 | 283.8 / 258.4 | 290.0 / 263.0 | 12/12 / 12/12 |
| Real intervals / 44 | 465.452 | 458.886 | 1398.7 / 1366.2 | 1430.2 / 1383.9 | 44/44 / 44/44 |
| First cold real / 4 | 1390.300 | 1336.350 | 1418.9 / 1377.4 | 1418.9 / 1377.4 | 4/4 / 4/4 |
| Subsequent real / 44 | 348.745 | 349.050 | 1039.8 / 1068.8 | 1083.5 / 1095.7 | 44/44 / 44/44 |
| Fence wait / 48 | 381.171 | 377.769 | 1095.4 / 1093.2 | 1149.5 / 1119.0 | 48/48 / 48/48 |
| Empty-view wall / 4 | 62.600 | 60.425 | 70.3 / 65.2 | 70.3 / 65.2 | 4/0 / 4/0 |
| Empty submission / 4 | 5.950 | 6.150 | 7.4 / 8.1 | 7.4 / 8.1 | 0/0 / 0/0 |
| Returned-view wall / 4 | 1561.375 | 1377.225 | 1624.4 / 1405.9 | 1624.4 / 1405.9 | 4/4 / 4/4 |
| Returned submission / 4 | 296.550 | 251.725 | 301.0 / 280.9 | 301.0 / 280.9 | 4/4 / 4/4 |

Canvas residual mean increases 0.3325 → 0.41875 ms, with maximum 2.0 → 21.6 ms. Full/World3D/residual values are nested and cannot be added. All 48 real frames per policy remain above 100 ms. CPU pooled p99 barely changes while its maximum rises sharply; the fresh-tick p99 also rises. Subsequent real mean changes **+0.087%** rather than improving. Cold and returned-view means improve, but this does not justify excluding them from the headline or hiding the warm-frame regressions.

| Run / lifetime | CPU mean | CPU p95 | CPU p99 / max | CPU >50 / >100 | Real mean | First cold / real max | Subsequent real mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| reference-A / 0 | 43.590 | 127.8 | 470.5 | 19 / 9 | 448.392 | 1385.5 | 363.200 |
| reference-A / 1 | 43.515 | 132.1 | 470.0 | 21 / 7 | 424.025 | 1418.9 | 333.582 |
| candidate-B / 0 | 39.445 | 97.5 | 469.9 | 22 / 2 | 430.892 | 1356.3 | 346.764 |
| candidate-B / 1 | 36.403 | 122.4 | 226.5 | 15 / 6 | 417.408 | 1245.5 | 342.127 |
| candidate-B2 / 0 | 40.737 | 112.3 | 548.1 | 16 / 4 | 433.117 | 1366.2 | 348.291 |
| candidate-B2 / 1 | **52.838** | **180.7** | **696.9** | 22 / 5 | 443.883 | 1377.4 | 359.018 |
| reference-A2 / 0 | 42.198 | 116.9 | 470.9 | 21 / 8 | 438.025 | 1417.5 | 348.982 |
| reference-A2 / 1 | 46.748 | 171.0 | 463.4 | 23 / 11 | 431.725 | 1339.3 | 349.218 |

With 60 CPU and 12 real samples per lifetime, their respective p99 and real p95/p99 equal the maxima. The slow candidate-B2 lifetime is retained in every pooled result. ABBA reduces simple order drift but this finite sample does not prove hardware-independent speed or stable tail improvement.

## Residency and allocation tradeoff

The following before-view values repeat exactly across all four lifetimes per policy. Bytes are declared resource ownership, not measured process RAM or dedicated hardware VRAM.

| Recorded resource | Reference | Candidate |
|---|---:|---:|
| Peak CPU buffer ownership | 60,720,132 B | 26,356,908 B |
| Before CPU ownership | 7,882,496 B | 7,787,776 B |
| Before GPU ownership | 210,914,668 B | 191,718,124 B |
| Peak GPU ownership | 210,914,668 B | 194,710,892 B |
| Returned GPU ownership | 195,688,524 B | 180,533,324 B |
| Returned CPU ownership | 7,525,632 B | 7,525,632 B |
| Resident pages | 10 | 14 |
| Active draw chunks | 61 | 70 |
| Total page capacity / live cached layers | 107 / 107 | 105 / 105 |
| Actual card base mips | 107 at N0 | 95 at N0; 10 at N1 |
| Cumulative array mip-copy calls | 17,260 | 17,073 |
| Cumulative array mip-copy submitted bytes | 3,593,517,112 B | 3,312,449,592 B |
| Cumulative scratch-upload bytes | 652,717,160 B | 652,717,160 B |
| Array CPU base-upload bytes | 0 | 0 |
| Cache fresh Canvas misses | 1573 | 1723 |
| Cache hits | 153 | 3 |

GPU ownership falls **19,196,544 B / 9.10%** at the before-view endpoint and peak GPU ownership falls 16,203,776 B. Peak CPU ownership falls **34,363,224 B / 56.59%**. Draw segmentation and page count increase, so residency savings are not a claim of universally lower draw overhead. Cached resident inventories can differ without changing visible content; all visible facts and pixels remained equal. Full source rendering/scratch remains full resolution; the candidate's recorded resident N1 entries do not change the source art or regenerate smaller source pictures.

Fresh Canvas misses increase **150 per lifetime**, with hits 153 → 3. Existing adaptive cache behavior backs off in both policies, with endpoint payload and scratch released; smaller budget is not cost-free. All numeric upload, compaction, page, capacity, temporary, peak and endpoint counters are in the summary JSON, with every resource and renderer-info difference in the strict analysis. The old and new peak methods share resource accounting semantics but have different implementation costs; these are part of the combined policy, not a separately attributed percentage.

Mean cumulative before-view stage costs across all four lifetimes are below. They include preparation and sampling, not only the timed CPU rows. Cache work nests inside cache stage; these columns must not be summed as disjoint frame costs.

| Cumulative cost / estimate | Reference ms | Candidate ms |
|---|---:|---:|
| Cache work | 898.775 | 271.375 |
| Paint | 448.175 | 510.000 |
| Canvas readback | 4443.600 | 4903.250 |
| Cache stage | 905.525 | 274.775 |
| Mask packing | 710.400 | 608.325 |
| Row flip | 152.050 | 151.650 |
| Slot assignment | 104.325 | 18.725 |
| GPU transfer submission | 1269.050 | 1452.725 |

Candidate-B2 lifetime 1 has cumulative GPU transfer submission **1957.1 ms**, compared with its other candidate lifetimes 1082.2–1405.5 ms. This is not a per-copy timing or an attribution of its 696.9 ms maximum to one GL command. The formal test has no per-call profiler, allocation/GC attribution or GPU timer query. Prior diagnostic trace evidence remains separate and must not be used to manufacture a causal breakdown of these samples.

Tracked resource ownership excludes Canvas backing allocations, process-wide memory and JavaScript entry/key/Map metadata. Post-disposal heap samples do not measure active cache ownership. The encoded cache entry cap remains 1024; reconstruction scratch is outside its encoded payload budget. No additional ghost table exists and no ghost byte estimates were invented.

The combination's resource reduction is established in this covered scene with strict visible equivalence. The small overall real-wall difference, unchanged slow warm work, higher fresh-tick tail and retained worst lifetime bound the performance claim. Production promotion, upstream integration and camera/picking validation are separate steps; these artifacts remain the frozen AEC formal evidence.
