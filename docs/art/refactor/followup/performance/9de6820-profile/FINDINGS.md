# Unchanged-quality profile: the upload call is the primary blocking site

Isolated detached source `9de6820873367c06401cdfa4d8938aa17e78f199`, `/tmp/sketch-art-profile`, shared installed dependencies. The main worktree had unrelated GPU proof scripts and animation edits; none entered this run. Browser started at 12:39:50 UTC after other tests and GPU proofs stopped. One full real final-art lifetime retains all 1000 initial units, 4 warmup ticks and all 12 measured ticks, camera, selected units, rendering quality and production combat/projectile paths. There are no stubs or disabled render features.

Result: mean fenced draw **5130.18 ms**. The twelve real-render interaction/resource checks pass; errors are empty. Replay hash, visible counts, animation-mode totals and final card-cache statistics exactly match the uninstrumented final-art record. This is a diagnostic with timer/profiler overhead, not a new formal performance comparison.

## Measured blocking sites

Per measured frame, averaged over all twelve frames:

| Stage | Synchronous wall time | Relationship |
| --- | --- | --- |
| Real renderer.render | 4447.07 ms | Parent of GL calls below |
| GL texSubImage3D calls | **4440.99 ms** | 248 calls / 163.00 MB submitted RGBA |
| Card rasterization | 670.72 ms | Parent of painting/readback/scan/copy below |
| Canvas getImageData | **488.54 ms** | 248 calls / 291.65 MB full-source RGBA |
| Alpha bounds scan | 98.09 ms | Full source extents, not cropped layer extents |
| Painter callbacks | 51.16 ms | Actual authored drawing |
| Layer clear/row copy | 21.91 ms | Cropped pixel buffers |
| Slot lookup | 4.16 ms | Includes any page allocation it invokes |
| Compaction | 0.12 ms | No measured-window moves; 64 occurred in warmup |
| GL generateMipmap calls | 0.033 ms | 45.67 calls, ~118.45M page-base texels |
| GL instanced draw calls | 0.125 ms | 102 calls |

Do not add parents and their children. `texSubImage3D` accounts for approximately 86.6% of the entire observed draw. CPU profile sampled attribution corroborates ~53.3 seconds across the measured window at the wrapped native GL call, ~5.87 seconds at getImageData and ~1.18 seconds in `cardBounds`. Raw `.cpuprofile` content is in [cpu-profile.json](cpu-profile.json); approximate clock mapping and sorted attribution are in [summary.json](summary.json).

**This locates the blocking API, not isolated GPU-command execution.** GL upload calls can wait on previously queued draw/mipmap work. Near-zero direct mip generation, draw and final fence time does not establish that those GPU operations are cheap. In particular, Three.js enqueues mip generation for an entire array texture after its dirty-layer uploads, so the next upload may absorb queued work. No elapsed-GPU query or controlled fence experiment has separated that causal contribution yet.

The first warmup frame uploads 730 layers in 47 newly allocated pages and spends 4148 ms inside uploads. The second warmup frame uploads 563 layers in only 35.3 ms, while the third uploads 188 in 4576.1 ms without a new page. Therefore new page allocation alone does not explain the repeated stall, and bytes/call count alone do not predict it; inter-frame GPU synchronization deserves explicit testing.

## Cache turnover

Each measured frame makes 999 visible card requests on average: 688.83 warm hits, 310.17 initial miss requests, 248 actual new rasterizations and 62.17 duplicate pending requests resolved by the first rasterization. Across the twelve frames there are 8266 warm hits / 11988 requests, 2976 rasterizations and 2907 slot evictions. Approximately 45.67 pages are dirty each frame despite only ~248 dirty layers. Newly allocated pages average 0.5/frame, so most traffic rewrites existing storage. Final storage remains 49 pages / 772 cards / 127926272 texels.

The soft budget is far below the currently visible working set, so current-frame preservation is correct but cross-frame pose reuse is limited. The source does not reduce resolution or visibility to make this profile faster. Arbitrarily enlarging the cache could exchange CPU/upload work for still larger memory; no such experiment is included.

## Instrumentation and limits

The production files on disk were untouched. Runtime wrappers cover cache methods, Canvas readbacks and the actual WebGL2 context calls; a Vite pre-transform adds precise bounds/copy timers to the served diagnostic module only. The transformed source, generated fixture/runner, source hashes and reproduction launchers are archived here. CDP uses a 1000µs CPU sampling interval. It profiles the complete lifetime; the summary restricts attribution to the approximate measured-frame interval.

The first diagnostic uses `finishMs` for both the cards.finish parent and the final GL finish wrapper, so that field combines the two. The normal fullDraw/submission arrays still separately establish the final fence delta; do not interpret the combined field as standalone GL finish time. Nested timers, wrapper allocations, profiler sampling and console serialization add overhead. Twelve measured frames locate a dominant path, not a stable latency distribution.

## Smallest useful next experiment

Add a per-GL-call sequence log with texture/page ID, layer, byte count and elapsed time to determine whether the first upload following a mip generation carries most of the stall. In a separate same-input diagnostic, insert a fence immediately after mip generation to move any queued work to that location; total work/quality stay the same, but pipeline scheduling changes, so do not present it as an optimization result.

If that confirms synchronization, compare dirty-layer versus full-page uploads with identical final page bytes/mips in a controlled diagnostic. Full-page upload increases bytes but reduces the number of calls; this can distinguish byte bandwidth from per-call/ordering overhead without removing visible content. A no-mipmap or no-upload stub would invalidate quality and should be used only as explicitly labeled diagnostic evidence if the unchanged-quality checks remain ambiguous. No such follow-up has run yet.
