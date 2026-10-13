# Queue bracket v3 diagnosis

Strict comparison passed with no violations. This is a synchronized, instrumented diagnosis on Chromium/SwiftShader, not a performance improvement or a hardware-GPU result. Failed v1/v2 captures remain separate and are excluded.

| Strategy | Life | Pre drain ms | Draw ms | Post drain ms | Inclusive envelope ms | Longest n135 GL call ms |
|---|---:|---:|---:|---:|---:|---:|
| control | 0 | 0.0 | 479.3 | 0.0 | 479.3 | 228.2 |
| control | 1 | 0.0 | 459.5 | 0.0 | 459.5 | 225.6 |
| pre | 0 | 410.1 | 227.9 | 0.0 | 638.2 | 0.1 |
| pre | 1 | 418.6 | 257.8 | 0.0 | 676.5 | 0.2 |
| pre-post | 0 | 426.9 | 226.0 | 944.3 | 1597.7 | 0.2 |
| pre-post | 1 | 417.9 | 252.3 | 926.1 | 1596.4 | 0.3 |

The added pre-drain removes the roughly 226–228 ms texSubImage2D CPU stall in both lifetimes while moving 410–427 ms of waiting before the draw. The pre-post strategy then waits another 926–944 ms after submission. Its end-to-start envelope is about 1.60 seconds. These envelopes have different completion boundaries; control and pre do not wait for all n135 work to complete. They cannot be compared as equivalent completed-frame performance, and their differences are not pure GPU durations.

At n135 all six cases do the same 53 rasterizations/cache misses, 53 mip layer updates, 523 mip copies (102,868,324 reported copied bytes) and 20,053,380 reported scratch-upload bytes. Cache hits, evictions and compaction do not increase. All rows’ cheap before/after counters and resident-mip return values match across strategies after excluding measured time fields; see [work-summary.json gzip](work-summary.json.gz). Canvas readback remains roughly 152–165 ms in this frame; short GL submission times do not establish cheap mip generation or execution.

Every life has 294,826 content GL calls. Their order, captured scalar arguments/ROI, observed bindings, renderer scope, and canonicalized WeakIDs match. Explicit diagnostic observer calls are excluded and counted separately, as is variable original completion polling outside a draw. Captured GL argument descriptions are not a byte-for-byte recording of upload payloads or unlogged object fields. ROI texels are reported separately from transfer/view bytes.

All six complete browser-exported profile files match their UTF-8 SHA and byte count, UTF-16 character/chunk count, export header and raw non-GL profile fields. Full raw facts, snapshot sequence, clocks, sample counts and screenshots match. The frozen Git source inventory, blob bytes, helper archives, startup/finish optimized bundles and full Three resolved identity passed. The analysis preserves all 152 rows per life and all original CPU/real samples.

This experiment supports a dependency on preceding queued work and shows substantial completion work after CPU submission. It does not uniquely identify which prior upload, mip generation, copy, driver task or transfer-buffer allocation caused a token wait. Matching Chromium source provides a legal staging-reclaim path through Release/InsertToken/FreeOldestBlock/WaitForToken, not proof of that stack in this capture. Trace-flow/token attribution remains separate pending analysis; whole-run cgroup deltas are background only. Transformed production-JavaScript snapshots were not archived. No hardware GPU is available in this environment.

Reproduce from repository root with `python scripts/art-card-queue-bracket-analyze-v3.py --out /tmp/queue-v3-recheck` (new output directory required). [analysis.json gzip](analysis.json.gz) retains detailed timing, contexts and integrity results; [analyzer.py gzip](analyzer.py.gz) and [run.log gzip](run.log.gz) preserve this execution.

Before reading stored inputs with the original analyzer/helper, restore them
at their original repository paths: run `python3 scripts/art-naming-evidence-archive.py --materialize`,
then `python3 scripts/art-queue-input-archive.py --materialize`, then
`python3 scripts/art-queue-source-archive.py --materialize --folder queue-bracket-v3/<arm>`
for each of `control`, `pre`, `pre-post`. These restore commands omit `--out`;
the analyzer output remains a new directory. [The queue archive guide](../../queue-archives/README.md)
documents independent restore layouts and cleanup. Compression preserves the
original filenames, full bytes, SHA values and all failed v1/v2 records.

GPU command-boundary queries were available and non-disjoint in all six captures:

| Strategy | Life | Command-boundary elapsed ms |
|---|---:|---:|
| control | 0 | 1101.125 |
| control | 1 | 995.543 |
| pre | 0 | 953.189 |
| pre | 1 | 1076.233 |
| pre-post | 0 | 913.385 |
| pre-post | 1 | 910.241 |

These values include command arrival/idle within the markers. They are neither exclusive mip execution nor equivalent to the host-side pre/draw/post envelopes.
