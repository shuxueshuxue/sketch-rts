# Current-production stall attribution

Both 8345 diagnostic captures and offline integrity checks completed. The earlier pipeline candidate-B2 cycle 1 n114/tick38 **696.9 ms stall was not reproduced and remains unattributed**. These instrumented runs are not formal performance comparisons.

| Capture | Cycle | Largest CPU sample | World draw | n / tick | Long public copy | Main-thread channel-wait union |
|---|---:|---:|---:|---|---:|---:|
| Current trace | 0 | 468.5 ms | 465.801 ms | 135 / 45 | 236.2 ms | 236.029 ms |
| Current trace | 1 | 421.6 ms | 421.301 ms | 135 / 45 | 201.5 ms | 201.352 ms |
| Current GL trace | 0 | 474.2 ms | 471.600 ms | 135 / 45 | 255.1 ms | 254.685 ms |
| Current GL trace | 1 | 498.2 ms | 497.700 ms | 135 / 45 | 275.2 ms | 274.887 ms |

The GL capture localizes the largest synchronous stall to the **43rd texSubImage2D call in each n135 frame**: 254.799 / 275.099 ms. Its arguments update a 345×264 rectangle at (81,171), mip 0, inside a 512² scratch DataTexture, through renderer.copyTextureToTexture. CommandBufferProxyImpl::WaitForToken spans cover 254.675 / 274.887 ms, more than 99.9% of the call; no traced main-thread GC or Skia interval overlaps these particular long GL calls. This identifies the blocking site and command-buffer waiting, not which earlier GPU command caused that wait. GPU-process Scheduler::RunTask overlaps do not establish a causal link or pure GPU execution time. Short generateMipmap submission timings do not prove cheap asynchronous mip execution.

Both n135 GL frames have 53 raster/cache misses, 53 layer updates, 523 mip copy calls, 20,053,380 scratch-upload bytes, **zero new pages, zero compaction layers, zero cache encoding/reconstruction work and zero cache backoff increments**. Readback stage totals are 148.9 / 149.9 ms; mask packing is 18.0 / 18.1 ms and paint submission 11.9 ms. Whole-frame main-thread Skia unions are 95.888 / 98.144 ms, dominated by drawPath and drawRect; whole-frame GC unions are 2.088 / 5.441 ms. These are overlapping diagnostic domains and must not be added together. The evidence supports both Canvas raster/readback cost and a distinct scratch-upload command-buffer stall; it does not justify assigning the entire frame to GC, upload bytes, or software GPU execution.

At the originally implicated n114, current trace cycles measured 76.7 / 62.8 ms; GL trace measured 52.5 / 50.1 ms. No retrospective explanation of the old 696.9 ms sample follows from these values.

## Protocol and integrity

Each capture retains 18 preparation draws n0..51 with real render and completion; **renderer.render is then no-op for all warm n54..113 and sampled n114..173 frames**, not only the sampled frames. Twelve real draws n480..491 and empty/return probes follow. Warm and sampled frames still paint, read back and submit texture transfers, so asynchronous work from these stages can generate later backpressure. Between-lifetime explicit GC remains outside draw timers. Natural GC within a call is not excluded.

The analyzer matches paired UserTiming spans to cycle/hidden/row/n/tick and exact raw timestamps, validates all 304 world rows per capture, all 120 CPU samples, and no-op renderer buckets. It verifies the archived 8345 source files against capture start/end SHA maps, plus archived harness, profiler, fixture, metadata and entry HTML. It never substitutes the now-edited working tree for captured source. Both traces report no data loss and both analyses passed. Timebase offset variation is 1 microsecond in each capture.

[Pixel/fact/clock comparison](current-trace-comparison.json): all six images from GL trace, current trace and historical pipeline candidate-B2 have identical decoded RGBA. Each original PNG's encoded SHA is independently validated. Raw final pixelProof facts and CPU tick arrays match all three. The two diagnostics also have identical full snapshot-SHA sequences and all-phase clocks. The historical pipeline did not capture all-phase telemetry; its matching archived fact-fixture SHA and recorded CPU clocks are verified without inventing missing records.

## Reproduction and evidence

The analyzer refuses to overwrite an existing output directory. Use fresh directories when reproducing:

```bash
node --max-old-space-size=8192 scripts/art-card-current-trace-analyze.mjs --input docs/art/refactor/followup/card-streaming/stall-followup/current-gl-trace --out /tmp/current-gl-attribution-review
node --max-old-space-size=8192 scripts/art-card-current-trace-analyze.mjs --input docs/art/refactor/followup/card-streaming/stall-followup/current-trace --out /tmp/current-attribution-review
```

[GL full attribution](current-gl-attribution/analysis.json) and [current full attribution](current-attribution/analysis.json) preserve all-phase rows, original buckets, exact input/analyzer SHA, source integrity checks, long-call spans and clipped category unions. Cross-thread/process overlaps are correlation only. Only getImageData/copy/GL calls over the configured long-call threshold have individual spans; buckets retain short calls. Missing named trace events do not prove missing work. Neither capture includes a complete OS off-CPU stack or command-level dependency proof. Further experiments must target this measured wait without presenting diagnostic timings as formal gains.
