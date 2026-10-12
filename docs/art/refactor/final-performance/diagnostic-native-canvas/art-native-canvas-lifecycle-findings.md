# Native Canvas lifecycle diagnostic

Independent Node subprocesses using installed @napi-rs/canvas 1.0.9. No production files or official benchmark changed. Each iteration paints the same 640×640 source; readback samples all RGBA with getImageData. Crop variants add varying 160..196 × 200..228 outputs to approximate exact-size cache mismatch. RSS is MiB; these short loops are allocation diagnostics, not game performance benchmarks.

400 iterations, independent processes:

| Variant | Initial RSS | Final RSS before optional GC |
|---|---:|---:|
| reset, no readback | 61.0 | 62.6 |
| reset + getImageData | 61.1 | 864.9 |
| clearRect + getImageData | 61.1 | 865.0 |
| width reset + getImageData | 60.9 | 866.4 |
| new canvas + getImageData + shrink 1×1 | 61.0 | 867.3 |
| cropped outputs shrunk, no readback | 61.1 | 64.5 |
| cropped outputs in 8-canvas exact-size pool, no readback | 61.1 | 81.0 |
| reset + getImageData + event-loop yield every 20 | 60.9 | 234.8 |
| reset + canvas.data() + event-loop yield every 20 | 61.0 | 233.6 |

The synchronous 1,200-read run grew from 61.0 to 2,469.6 MiB. In a separate 2,400-read run WITHOUT --expose-gc or explicit GC, event-loop yields every 20 iterations held RSS around 232–235 MiB from iteration 200 onward (one 204 MiB dip), ending at 231.8 MiB. Pixel sample checksums were identical per iteration.

Interpretation: the dominant synthetic growth is associated with native pixel readback and withholding event-loop opportunities, consistent with deferred N-API external-buffer cleanup plus allocator retention. It is not explained by ctx.reset alone, exact-size crop pool mismatch, or failing to shrink discarded canvas backing stores. Calling explicit GC at the end of a long synchronous loop did not promptly return RSS. canvas.data() is not a remedy; it behaved similarly.

The official Canvas script runs all four 600-frame loops synchronously, without intervening event-loop yields. A browser presents across event-loop turns, so this diagnostic does not establish a browser memory leak. Do not replace or discard the existing formal benchmark memory evidence. A separately labeled headless lifecycle experiment could insert setImmediate between chunks outside timing sections to evaluate natural cleanup, preserving simulation timestamps and pixels. That is a harness scheduling change, not a demonstrated production rendering fix. No further production cache modification is recommended from these results alone.

Files:
- ./art-native-canvas-lifecycle.cjs
- ./art-native-canvas-lifecycle-results.jsonl
- ./art-native-canvas-lifecycle-finalizers.jsonl
- ./art-native-canvas-lifecycle-no-gc.json

Example reproduction:
node docs/art/refactor/final-performance/diagnostic-native-canvas/art-native-canvas-lifecycle.cjs reset-read-yield 2400
node --expose-gc docs/art/refactor/final-performance/diagnostic-native-canvas/art-native-canvas-lifecycle.cjs reset-read 400

Run reproduction commands from the repository root. The first two JSONL files used --expose-gc, invoked only after all timed iterations. The no-gc JSON used ordinary node: its beforeGC/afterGC labels refer to the common optional diagnostic hook, which performed no collection because global.gc was absent. All finalizers JSONL modes performed one 50ms event-loop wait after recording those fields; only modes ending in -yield yielded during iteration. Initial results JSONL had no post-loop wait. Archived raw outputs are unmodified. The archived script adds explicit dimension/yield/GC metadata for future reproduction; it was not rerun for this archive.

The initial synchronous 1,200-read output is archived in `art-native-canvas-lifecycle-synchronous-1200.json`, transcribed verbatim from the captured tool stdout (the initial run was not redirected). It used --expose-gc only after iterations and no yield. Follow-up direction: inspect the installed N-API ImageData external-buffer finalizer scheduling and allocator retention; separately compare a naturally yielding headless loop with identical frame content. No additional safe production-source fix has been established.
