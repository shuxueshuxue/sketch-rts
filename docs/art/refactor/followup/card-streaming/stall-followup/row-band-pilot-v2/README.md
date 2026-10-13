# Row-band full-frame pilot v2

This is a two-arm, one-lifetime-per-arm diagnostic pilot, not balanced ABBA and
not production integration. Frozen source is
`8345a0dcfeb96b6777ac3940ec64cba13816c851`, with the production 16 MiB raster
cache, one-level residency gate, one-bank implicit sampling and original full
GPU mip chain. Only the complete external uploader module changes its warm CPU
view/row origin. The exact original/candidate/region SHA values remain
`3526789cda89f194eb9ee69ec266c163f043d75d88c8ef892870d1d5dfa1e295`,
`7523e7c847c159be4d06f08e9b177da75dfa9ea9989c8d6a10d77099c4080e18`,
`25d852a8b6424c81648e93b68db98de1076cee90659d3f2b01cc5b07878c8439`.

Both captures exit 0 and [strict analysis](analysis-strict/analysis.json.gz) exits
0 with no violations. [Original raw](original-A/raw.json),
[candidate raw](candidate-B/raw.json), [original log](original-A.log),
[candidate log](candidate-B.log), [analyzer log](analysis.log) retain the full
records. Each arm archives all 1,120 tracked source files, complete providers,
unchanged helper/preparation metadata, runtime helpers, optimized dependency
bundles/chunks and harness. Startup/final bundle hashes remain stable; every
public Three identity includes its query and equals the completed startup entry.
The final module graph has 201 modules. The analyzer checks archived source
against immutable 8345 Git blobs, not the concurrently evolving main worktree.

The candidate has **no benefit signal in this pilot**. A single original→candidate
comparison cannot establish a small regression or portable hardware behavior,
but it does not justify production adoption or further acceptance ABBA on
performance evidence alone.

| Metric (ms, nearest-rank percentiles) | Original | Candidate |
| --- | ---: | ---: |
| CPU draw mean, all 60 samples | 39.520 | 40.410 |
| CPU p95 / maximum | 99.400 / 468.600 | 105.800 / 452.400 |
| Fresh-tick CPU mean, 20 samples | 69.485 | 70.850 |
| Same-tick CPU mean, 40 samples | 24.538 | 25.190 |
| Complete real-frame wall mean, all 12 | 417.358 | 431.925 |
| Complete real-frame p95 / maximum | 1306.900 / 1306.900 | 1268.100 / 1268.100 |
| First cold real-frame wall | 1306.900 | 1268.100 |
| Following 11 real frames mean | 336.491 | 355.909 |
| Real frame intervals mean, 11 intervals | 446.809 | 460.364 |
| Real frames over 250 ms | 4 | 5 |

CPU mean changes +2.25%, complete real wall +3.49%. The long tail remains.
The capture's historical percentile helper uses a different rank convention;
the table consistently uses the offline analyzer's nearest-rank definition.
All cold and same-tick samples remain in the all-sample statistics. Later real
frames are not assumed fully cache-warm.

Raw visible facts, their SHA, and all three battlefield/empty/returned RGBA
captures are identical across arms. At the before-empty resource endpoint both
have 1,726 rasterizations, 1,723 true Canvas misses, 3 raster-cache hits, one
cache backoff and 280 evictions. Every non-timing field in before/empty/returned
resources matches, including page layouts, upload/copy/mip counts and bytes,
pick masks and owned-byte peaks. Reported endpoint raster/transfer times include
preparation, warmup and probes; they are not isolated measured-frame attribution
and must not be added to nested full presentation durations.

The [independent native GPU proof](../row-band-native/README.md) already verifies
8,417 native mip/layer comparisons per provider with zero RGBA differences,
including transparent RGB, clearing, tails, recovery and compaction. It shows
unchanged actual rectangle bytes and copy counts despite the shorter exposed
CPU view. It deliberately instruments and synchronizes GL and provides no
performance measurements. The separate 135 color/depth/distance shader proof
was not run for this candidate.

Schedule remains original: preparation n=0..51, 60 CPU warmups, measured
CPU n=114..173 (20 new snapshot ticks), then real n=480..491 and the unchanged
empty/return probes. CPU draws disable renderer.render but retain texture
transfers and potential queue backpressure; complete real wall includes Canvas,
submission, fence completion and scheduling. This is Chromium/ANGLE SwiftShader
in one controlled environment, not GPU timer-query results or player hardware
FPS. Snapshot construction, PNG capture and GC are outside measured draws.

The new complete v2 driver SHA is
`4a0a7474f46a7868df62250d8d402f1fd35b9189b5a3b1853625e3452f08ce4f`;
old drivers and mock failure/pass records remain unchanged. No source, art,
combat, simulation, visible content, mip quality or production upload behavior
was changed.

The strict analysis JSON and the two selected optimized dependency snapshots
are retained as exact gzip bytes: [original dependency](original-A/optimized-dependency-snapshots/26529ad0b0c5085e0505d5934eb3e2a1c38689b991de42ffba0b6560e40bdb4d.js.gz)
and [candidate dependency](candidate-B/optimized-dependency-snapshots/26529ad0b0c5085e0505d5934eb3e2a1c38689b991de42ffba0b6560e40bdb4d.js.gz).
Raw records retain their original filenames and SHA values. To validate stored
captures, first restore the naming evidence, then both complete source snapshots,
then use the original analyzer. From the repository root:

```sh
python3 scripts/art-naming-evidence-archive.py --materialize
python3 scripts/art-card-stall-source-archive-v2.py --materialize --folder row-band-pilot-v2/original-A
python3 scripts/art-card-stall-source-archive-v2.py --materialize --folder row-band-pilot-v2/candidate-B
```

[The archive index](../EVIDENCE-INDEX.md) records all 18 paths and the independent
`--out` restore layout. Normal repository tests do not require these bare files.

Reproduce in an owner-coordinated quiet window, using fresh exclusive directories:

```sh
node --import tsx scripts/art-card-upload-row-band-formal-proof-v2.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy original --pilot --repeats 1 --out work/row-band-pilot/original-A/raw.json
node --import tsx scripts/art-card-upload-row-band-formal-proof-v2.mjs --source /tmp/sketch-stall-baseline-8345 --upload-policy candidate --pilot --repeats 1 --out work/row-band-pilot/candidate-B/raw.json
python3 scripts/art-card-upload-row-band-formal-analyze-v2.py --pilot --input work/row-band-pilot
```

Provider/helper/metadata CLI overrides accept the archived inputs. Never overwrite
the source snapshots, preparation metadata, raw captures or negative records.
