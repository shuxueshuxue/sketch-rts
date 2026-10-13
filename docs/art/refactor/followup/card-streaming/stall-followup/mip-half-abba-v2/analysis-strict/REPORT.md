# Half-margin v2 formal ABBA

Strict evidence validation passed on the first analyzer run. This candidate reduces owned GPU storage and improves the empty-camera return probe, but **does not establish faster steady presentation**: CPU mean is worse and complete real-frame mean is essentially unchanged. The unfinished v1 A/B/failed-B2 evidence is not included in these results.

| Metric | Production one-level margin | Candidate half-level margin |
|---|---:|---:|
| CPU all mean, 240 samples/policy | 40.128 ms | 41.482 ms |
| CPU p50 / p95 / p99 | 6.8 / 108.7 / 459.4 ms | 9.8 / 108.3 / 469.4 ms |
| CPU max | 482.0 ms | 501.0 ms |
| CPU >50 / >100 / >250 ms counts | 75 / 18 / 4 | 82 / 22 / 4 |
| Fresh-tick CPU mean | 70.541 ms | 72.173 ms |
| Same-tick CPU mean | 24.922 ms | 26.137 ms |
| Complete real all mean, 48 samples/policy | 426.490 ms | 426.075 ms |
| Real p50 / p95 / p99 | 198.3 / 1350.8 / 1409.1 ms | 192.0 / 1295.6 / 1329.5 ms |
| Real max | 1409.1 ms | 1329.5 ms |
| Real >250 ms counts | 16 | 18 |
| First real cold-stream frame mean, 4/policy | 1349.025 ms | 1297.250 ms |
| Following 11 real frames mean, 44/policy | 342.623 ms | 346.877 ms |
| Empty→returned complete wall mean, 4/policy | 1397.325 ms | 1018.325 ms |
| Endpoint owned GPU bytes | 191,718,124 | 125,395,696 |
| Peak owned GPU bytes | 194,710,892 | 135,613,804 |
| Peak owned CPU bytes | 26,356,908 | 26,103,152 |

CPU mean increases 3.37%; real mean changes -0.097%, smaller than arm-to-arm variation and not an established speedup. Endpoint GPU ownership falls 34.59%, peak GPU ownership 30.35%. These are renderer ownership accounting domains, not process RSS or actual device total memory. The return probe improves about 27.12%, but it is reported separately, never substituted for all-real timing. Following real frames are not assumed fully cache-warm. With only 48 real samples per policy, nearest-rank p99 equals the maximum and is not a stable population-tail estimate.

All cycles have 1726 rasterizations, one cache backoff and 280 evictions. Production has 3 cache hits/1723 true Canvas misses; candidate has 4/1722. Both end with zero retained RLE payload after backoff. Cumulative cache work averages 272.8→261.85 ms per lifecycle. Mip copies fall 17073→16329, while scratch upload bytes only fall 652,717,160→652,567,280. These cumulative counts cover prep/warm/sample/real up to the endpoint, not isolated timed CPU samples. The gate does not meaningfully reduce source painting/readback demand; smaller GPU residency is not equivalent to fewer source Canvas misses.

## Strict checks and scope

Four ABBA arms, each two lifetimes, use the same frozen 8345 source/assets, 100 visible mixed units, no hidden units, one native bank, 18 real preparation draws, 60 render-no-op warmups, all 60 render-no-op CPU samples n114..173 and all 12 real frames n480..491. No samples were removed. True complete wall includes completion polling/scheduling. CPU full-presentation and nested layer costs are not additive.

Validation checks every archived source against immutable 8345 Git blobs and start/end SHA maps, public tree identity, all provider/helper snapshots, loader and compiled runtime function hashes, module resolution/load graph, canonical Three identity, and prebundle entry/chunk bytes and exact startup/finish metadata. The sole gate-module difference is `Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-1)` to `Math.floor(Math.log2(footprint.minimumTexelsPerPixel)-.5)`; painter/shader/uploader/cache implementations are unchanged.

All 24 PNG encoded hashes validate and corresponding decoded RGBA images match across all four arms. All eight captured fact SHA values match their corresponding cycle oracle; the capture harness removed raw pixelProof objects, so this is **not** a raw-fact field comparison. CPU tick arrays match exactly. Real-frame clocks follow the exact archived fixture; this capture has no per-frame real n telemetry. Independent camera correctness evidence is complementary, not additional performance samples.

[analysis.json](analysis.json) retains every arm/cycle distribution, all endpoint resources, every permitted resource difference, source/provider provenance, PNG hashes and validation results. [run.log](run.log) records the first successful execution; [analyzer.py](analyzer.py) preserves its exact source. Original captures and prior failed v1 evidence were not modified.
