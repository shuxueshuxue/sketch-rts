# Current-source latency trace

The trace identifies two different sources of long frames. Many `getImageData` calls execute substantial Skia drawing on the renderer main thread. A separate 241 ms CPU-to-scratch texture update spends almost its entire duration waiting on the graphics command channel. Main-thread garbage collection does not explain either of these principal observations. These results guide further cache and upload work; they do not establish that the remaining stalls are unavoidable hardware costs.

This is a diagnostic trace of one lifetime on source `d48fb3d95d248db91b9237f0dcb290e736f6a75b`, with one bank, native mip residency, 60 CPU samples and 12 real-render samples. Tracing and the additional timing marks have observation costs. Its timings must not replace the uninstrumented [four-run ABBA results](../peak-abba/report.md).

## Evidence and reproducibility

- [Complete derived analysis](analysis.json), including matched CPU rows and individual long calls.
- [Compact union-overlap summary](compact.json), excluding the large event metadata lists.
- [Offline trace parser](analyze.mjs) and [compact summary script](compact.mjs).
- Original byte-exact [trace gzip](../trace-current/trace.json.gz), [restore manifest](../trace-current/evidence-archive.json), and [raw sample data](../trace-current/raw.json). The expanded trace is recoverable at its original path; [storage instructions](../evidence-archives/README.md) describe the envelope and verification.
- Earlier [matched method profile](../profile-report.md), which separates inclusive methods from disjoint CPU costs.

The parser verifies the recorded trace hash, complete raw data, profiler provenance and `dataLossOccurred=false`. It matches `CardLatency` user-timing spans to raw rows using sample index, `n` and `tick`. All 152 recorded world-draw spans match; the trace/performance timebase offset varies by only 1 microsecond. The main renderer is PID/TID `60151/60151`; GPU-process events use PID `60094`.

Reproduce the derived outputs from the repository root, outside any measurement window:

```sh
python3 scripts/art-card-latency-evidence-archive.py --materialize --folder trace-current
node docs/art/refactor/followup/card-streaming/latency-investigation/trace-analysis/analyze.mjs
node docs/art/refactor/followup/card-streaming/latency-investigation/trace-analysis/compact.mjs
```

The original 86,393,736-byte trace has SHA-256 `02ea2d212013f488adf0d4a9009c2e1e2167b77085c54cb84553b8a5bf2a6e22`. The analysis verified the input hashes again after processing. Evidence storage may remove the duplicate expanded `trace.json` after validating the existing gzip; the restore command recovers every original byte before the unchanged parser runs. The original gzip, raw data, helpers and derived outputs remain unchanged. No benchmark, browser or production source was modified for this analysis.

For each timed call, the analysis clips matching Chrome events to the call interval, merges overlapping intervals, and measures their union. Nested GC, Skia and scheduler events are not summed. Main-thread activity and concurrent worker/GPU-process activity are reported separately. The compact script also verifies that the selected get/copy call intervals are disjoint before aggregating their per-call unions.

## Long Canvas calls

There are 400 individually marked CPU `getImageData` calls longer than 1 ms. Their call-interval union is **1,407.197 ms**. Shorter calls remain in the raw method buckets but are outside this long-call correlation set.

The raw buckets record 472 gets and 1,462.8 ms inclusive get time; the 400 marked calls cover approximately 96.2% of that time. The CPU-sample readback stages total 1,493.8 ms, compared with 2,755.207 ms total world draw across the same 60 rows. The small difference between bucket and stage totals includes work outside the wrapped get call. These are measurements of the instrumented lifetime, not formal before/after ratios.

| Activity within those 400 calls | Interval union | Share of call time | Calls with overlap |
| --- | ---: | ---: | ---: |
| Renderer main-thread Skia | 938.241 ms | 66.67% | 400 |
| Renderer main-thread GC, broad event group | 0.776 ms | 0.055% | 4 |
| Strict top-level main-thread GC pauses | 0 ms | 0% | 0 |
| Renderer main-thread graphics-channel waits | 0 ms | 0% | 0 |
| Same-renderer worker GC, concurrent | 28.959 ms | 2.06% | 9 |
| GPU-process activity, concurrent | 1,307.053 ms | 92.88% | 376 |

The concurrent rows are correlations, not additions to main-thread cost. In particular, worker GC cannot be counted as a renderer-main-thread pause, and broad GPU-process scheduler overlap cannot be called GPU execution time. The separately reported Canvas event group overlaps the same Skia intervals and must not be added to them.

The largest marked get is `n=132`, `tick=44`: a full 704 × 704 rectangle, **10.599 ms**. Its main-thread Skia union is **8.408 ms (79.33%)**, with zero main-thread GC or channel-wait overlap. The trace contains actual `SkCanvas::drawRect` and `SkCanvas::drawPath` work inside that call. Other large examples include a 9.7 ms get at `n=165` with 8.352 ms Skia overlap, and a 9.3 ms get at `n=138` with 7.923 ms Skia overlap.

This establishes that these calls include deferred Canvas drawing work. It does **not** establish that `getImageData` is predominantly a GPU-to-CPU download. The trace does not isolate every remaining pixel-copy/conversion cost, and it does not explain why all of that drawing was deferred to this boundary. A backend-attribution experiment must keep the painter, pixels and request schedule unchanged to answer that next question.

## The 241 ms upload stall

The worst marked copy is `n=135`, `tick=45`, raw row 99:

| Field | Observation |
| --- | --- |
| Public operation | `copyTextureToTexture` |
| Source | CPU `DataTexture`, 512 × 512, level 0 |
| Destination | Scratch `DataTexture`, 512 × 512, level 0 |
| Dirty region | 345 × 264 × 1 |
| Call duration | 241 ms |
| Main-thread `WaitForToken` union | 240.631 ms, 99.85% |
| Main-thread GC overlap | 0 ms |
| Main-thread Skia overlap | 0 ms |

The production public-API call performs the CPU-to-scratch region update with destination mip generation enabled. Two `CommandBufferProxyImpl::WaitForToken` intervals account for the wait union. This is evidence of a synchronous graphics-channel wait at that public update boundary. It is **not** the later 704-pixel source mip-1 to array mip-1 copy: that different call, at `n=150`, lasts 3.3 ms and has no marked channel wait.

Read-only inspection of `src/client/world3d/card-mip-uploader.ts` confirms that this CPU source shares the source raster and is never initialized on the GPU. In the installed Three implementation, `WebGLRenderer.copyTextureToTexture` takes its CPU `DataTexture` branch: destination texture setup, unpack-state handling, `texSubImage2D`, unpack-state restoration, and `generateMipmap` for destination level 0. The distinct initialized-source/mip-copy branch binds framebuffers and copies or blits their attachments. This source-level distinction narrows the investigation, but the trace does not identify which operation within the CPU branch blocks. Unpack-state queries are cached after the corresponding state is established, so this inspection also does not justify asserting that every copy performs a fresh synchronous `getParameter` round trip.

GPU-process activity overlaps 240.836 ms of the long call, much of it under `Scheduler::RunTask`. That is consistent with a command-channel dependency, but the recording does not connect a particular internal GL command, transfer-buffer allocation or GPU task to the token. The 241 ms is a wall duration observed on the renderer main thread, not a GPU timer. It would be unsupported to attribute it specifically to an array-layer blit, framebuffer validation, mip generation alone, or a unique driver command.

## Whole-frame context and repeat spikes

The raw raster stages and the trace overlap groups describe different views of the same frame. Do not add them together: readback-stage time contains the marked Canvas calls, and upload/copy time is nested within broader methods.

| CPU sample | World draw | Paint | Readback stage | Cache | Mask | Flip | Slot | Main GC union | Main Skia union | Main channel-wait union |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `n116/tick38`, repeated phase 2 | 161.3 ms | 7.9 ms | 94.0 ms | 17.7 ms | 18.7 ms | 2.0 ms | 0.6 ms | 0 ms | 58.563 ms | 0 ms |
| `n135/tick45`, fresh sample | 485.199 ms | 11.0 ms | 139.6 ms | 33.4 ms | 23.6 ms | 3.7 ms | 0.6 ms | 5.313 ms | 87.089 ms | 240.631 ms |
| `n158/tick52`, repeated phase 2 | 154.1 ms | 7.8 ms | 109.5 ms | 0 ms | 13.2 ms | 4.4 ms | 0.4 ms | 4.214 ms | 73.825 ms | 0 ms |

At `n135`, the raw copy bucket records 576 calls, 246.8 ms total, and a 241 ms maximum. One region-update wait therefore dominates that frame's copy bucket. Its longest get is only 5.8 ms, with 4.14 ms Skia overlap and no GC or channel wait. GC elsewhere in the world draw occupies 5.313 ms; it cannot explain the 485 ms frame or the isolated 241 ms copy.

At `n116` and `n158`, no individual copy exceeds 1 ms, while many marked gets collectively coincide with the large readback stage. Short copies still exist: respectively 294 calls/4.4 ms total and 368 calls/4.2 ms total. These repeat spikes survive after the peak-accounting optimization and cannot be explained just by initial GPU allocation or increased visible draw calls.

There are also **24 CPU rows with no get, copy, raster or upload activity**. Their median world-draw duration is **1.2 ms** (`n148`), with zero resource deltas and zero GC overlap. This provides a warm control for the host draw path. It does not prove that every other frame has the same cost, but it argues against treating the routine draw/gate work as the principal cause of these particular long frames.

## What the recording does and does not resolve

The capture contains 431,045 events and explicit main-thread Skia drawing, V8 GC, command-channel waits and GPU-process scheduling. Relevant observed names include `SkCanvas::drawPath`, `SkCanvas::drawRect`, `CommandBufferProxyImpl::WaitForToken`, `WaitForGetOffset`, `ImplementationBase::WaitForCmd`, `GpuChannel::Flush`, `CommandBufferStub::OnAsyncFlush` and `Scheduler::RunTask`. This is stronger evidence than attributing all stage readback to downloading pixels or all long frames to garbage collection.

For the principal observed spikes, the recording rules out synchronous main-thread GC as the dominant cause. It also distinguishes the slow CPU-to-scratch update from the separate array-mip copy path. The earlier matched profile shows that gate, draw and slot costs are small relative to readback, and the warm control is consistent with that finding. None of these statements claims that GC, draw submission or array copies are always free.

The trace lacks an exact token-to-command/work linkage, OS scheduling/off-CPU stack samples and hardware GPU timing. GPU-process and worker overlap remain concurrent evidence. The absence of a marked channel wait inside the long gets does not mean their remaining unclassified duration is zero-cost pixel copying. This single traced lifetime also cannot supply a general hardware-performance guarantee.

## Next engineering work

1. **Reduce repeated source painting/readback by fixing cache reuse and backoff.** The expensive repeated phase-2 samples are a concrete target. Inspect whether cache encoding/backoff repeatedly rejects the same valid source card and causes a full redraw on the next unchanged request. Reuse must preserve the exact full RGBA source, including RGB under zero alpha, pose changes, facing, weapons and all original mip levels. A bounded cache change needs the same tick schedule and strict image/resource checks; it cannot trade away animation or visible content.
2. **Separate deferred Canvas drawing from the remaining readback/conversion work.** The measured local Skia overlap is substantial, so backend hints or alternate staging need a controlled comparison before implementation. The existing context already requests `willReadFrequently`; merely adding that flag is not a new fix. No unseen backend experiment result is incorporated here.
3. **Investigate public upload backpressure at the CPU-to-scratch boundary.** Examine the actual public Three implementation and trace the command/transfer path without claiming that a particular internal command is already proven responsible. Buffer reuse, transfer-memory pressure or queued graphics work are candidates to test. A fix must retain original GPU mip construction and retry/context-recreation correctness. Reducing array mip-copy count alone would not directly target the observed 241 ms region update.
4. **Optimize mask construction only with a real-art corpus and unchanged hit semantics.** The large samples contain 13–24 ms mask stages. A semantic proof and isolated microbenchmark can decide whether that bounded CPU cost is worth addressing; synthetic speed is not a whole-frame performance result.

The existing peak-accounting change removes measurable continuous work, but the [ABBA comparison](../peak-abba/report.md) retains long tails and some real-render regressions. Any cache, Canvas, mask or upload change therefore needs a fresh same-source formal comparison after correctness checks. The trace offers actionable targets; it does not justify declaring the performance work complete.
