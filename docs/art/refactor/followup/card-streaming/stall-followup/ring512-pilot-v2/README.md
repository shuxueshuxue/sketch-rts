# 512-square dual-scratch full-frame pilot

This independent original→candidate pilot has one WorldPresentation lifetime
per arm. Both captures exit 0; [strict analysis](analysis-strict/analysis.json)
exits 0 with no violations. It is not balanced ABBA or production integration.
Frozen source is `8345a0dcfeb96b6777ac3940ec64cba13816c851`, with unchanged
16 MiB cache, one-level mip gate, one-bank implicit sampling, art and original
GPU mip chain. Only the full external uploader's 512-square scratch policy
changes to two independent CPU/GPU slots; all other dimensions remain single.

[Original raw](original-A/raw.json), [candidate raw](candidate-B/raw.json),
[original log](original-A.log), [candidate log](candidate-B.log),
[analyzer log](analysis.log) retain the full records and archived run-start
providers/helper/metadata. Complete tracked-source and runtime-helper snapshots,
module graph and startup/final optimized bundles/chunks are retained. Strict
analysis verifies the 8345 Git blobs, all exact replacement anchors, stable
full-query Three identity, readonly source, and complete capture provenance.

Candidate SHA remains
`0263e5bfb530a48b5a25f3eb67dfeb6c113ed27e67d13643facb109bf7fb3ff4`;
driver SHA remains
`27fd9e42cae81ec97ce3478a766022e3f1842c2f26ad38ce02ee537f48228d5d`.
The preparation metadata's historical static status is retained; actual execution
status is recorded in these proofs. No previous row-band tools or evidence changed.

The pilot gives **no complete-frame benefit signal**. The CPU all-sample mean
decreases 4.33%, but fresh-tick CPU mean increases 0.93%, real complete wall
increases 3.12%, and the cold real frame remains over 1.2 s. One arm per policy
does not establish a portable small regression. The added ownership and transfer
cost is confirmed, so the pilot does not justify production adoption or further
acceptance ABBA solely on performance evidence.

| Metric (ms, nearest-rank percentiles) | Original | Candidate |
| --- | ---: | ---: |
| CPU mean, all 60 samples | 43.905 | 42.003 |
| CPU p95 / maximum | 132.400 / 481.300 | 109.800 / 445.600 |
| Fresh-tick CPU mean, 20 samples | 74.555 | 75.250 |
| Same-tick CPU mean, 40 samples | 28.580 | 25.380 |
| Complete real-frame wall mean, all 12 | 409.800 | 422.575 |
| Complete real-frame p95 / maximum | 1282.100 / 1282.100 | 1309.700 / 1309.700 |
| First cold real-frame wall | 1282.100 | 1309.700 |
| Following 11 real frames mean | 330.500 | 341.927 |
| Real frames over 250 ms | 4 | 4 |

The capture's historical percentile helper differs from the analyzer's nearest
rank. The table consistently uses the latter. Every sample, including the first
cold real frame and same-tick frames, stays in the all-sample distributions.
Following real frames are not assumed fully cache-warm.

Raw visible facts and all three battlefield/empty/returned RGBA captures match
exactly. Both arms have 1,726 rasterizations, 1,723 true Canvas misses, 3 raster
cache hits, one cache backoff and 280 evictions at the before-empty endpoint.
Page layout, original array mip-tail copy count/bytes, masks and visible content
remain equal. The independent [native correctness proof](../ring512-native/README.md)
adds 10,684 zero-difference raw mip/layer comparisons per provider, including
512 N1/N2 failure/full retry and selected-slot ownership. Native instrumentation
and readback are deliberately absent from the timed capture. The separate 135
color/depth/distance shader matrix was not run for this candidate.

The selected slot compares against its own earlier image, so physical dirty
rectangles, initial/partial/unchanged counts need not equal the original. Their
cumulative before-empty endpoint values, including preparation and warmup, are:

| Resource or transfer fact | Original | Candidate |
| --- | ---: | ---: |
| Scratch texture count | 2 | 3 |
| Scratch CPU bytes | 3,031,040 | 4,079,616 |
| Scratch GPU native-mip bytes | 4,041,344 | 5,439,444 |
| Peak owned CPU bytes | 26,356,908 | 27,405,484 |
| Peak owned GPU bytes | 194,710,892 | 196,108,992 |
| Initial full scratch upload bytes | 3,031,040 | 4,079,616 |
| Partial scratch upload bytes | 649,686,120 | 653,267,912 |
| Total scratch upload bytes | 652,717,160 | 657,347,528 |
| Partial uploads | 1,724 | 1,722 |
| Unchanged scratch skips | 0 | 1 |

Extra ownership is exactly 1,048,576 CPU / 1,398,100 GPU bytes. Total scratch
transfer bytes increase 4,630,368, or 0.71%. These endpoint facts include
preparation/warmup/measurement; they are not per-measured-frame attribution.
The partial/initial counts imply one fewer scratch-update event in this lifetime,
not a directly instrumented native generateMipmap count in timed samples.
Do not add nested raster/transfer cumulative times to full presentation durations.

Schedule remains original: 18 preparation draws n=0..51, 60 CPU warmups,
60 measured CPU draws n=114..173, 12 real draws n=480..491 including the cold
pose-streaming jump, then unchanged empty/return probes. CPU samples disable
renderer.render only, retaining transfers and possible queue backpressure.
Complete real wall includes Canvas, submission, fence completion and scheduling.
Snapshot construction, screenshot capture and GC are outside timed draws.
This Chromium/ANGLE SwiftShader environment does not establish GPU timer-query
duration, player hardware FPS or a general theorem about scratch reuse hazards.
No production, simulation, quality or visible content change was made.

Reproduce serially in an owner-coordinated quiet window, with fresh directories:

```sh
node --import tsx scripts/art-card-upload-ring512-formal-proof-v2.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy original --pilot --repeats 1 --out work/ring512-pilot/original-A/raw.json
node --import tsx scripts/art-card-upload-ring512-formal-proof-v2.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy candidate --pilot --repeats 1 --out work/ring512-pilot/candidate-B/raw.json
python3 scripts/art-card-upload-ring512-formal-analyze.py --pilot --input work/ring512-pilot
```

Provider/helper/metadata path overrides can use the archived run-start bytes.
Output directories are exclusive; failures and historical inputs remain intact.
