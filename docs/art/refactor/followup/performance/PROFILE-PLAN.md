# Locate the five-second dynamic draw

Prepared from source `9de6820873367c06401cdfa4d8938aa17e78f199`; **not yet executed**. Wait for an exclusive profiling window and record the actual frozen production hashes. `painted-card-batches.ts` remains owned by the GPU lane; no production edits are needed for this diagnostic.

## Concrete questions from source

The measured submission time includes both `PaintedCardBatches.finish()` and `WebGLRenderer.render()`. A tiny final `gl.finish()` duration does not show that GPU work was cheap: GL calls or earlier readbacks may already synchronize it. Split those paths before attributing the stall.

Each missing pose currently paints a pooled 512/640-sized Canvas, calls `getImageData` over its full extent, scans alpha bounds, copies the cropped rows into a page buffer, and marks that layer dirty. The actual stored page rectangle can differ from the scanned source dimensions. Cache-key reuse depends on kind, owner ink, animation key, facing, density, appearance, variant and tile size. Per-frame misses must distinguish repeated requests for a new key from unique rasterizations.

Installed Three.js `WebGLTextures.js` uploads each dirty array layer using `texSubImage3D`; afterward it calls `generateMipmap(TEXTURE_2D_ARRAY)` for the texture. Thus partial layer updates do not imply partial mip generation. Current page size/depth and dirty-layer count must accompany GL time. This is a source-based hypothesis, not yet a bottleneck finding.

## Minimal first profile

Run one diagnostic layer lifetime with the existing final-art **1000-unit real replay, four warmups (ticks 16–19), all twelve measured ticks (20–31)**, unchanged camera/selection/quality, actual combat/projectile trackers and the usual screenshot. A single lifetime is sufficient to locate the cost; it is not replacement performance-distribution evidence. Retain the identical replay SHA, visible/action counts and errors. Leave the full formal benchmark untouched.

Generate a temporary fixture/runner from `art-browser-benchmark.mjs` and the existing runtime fixture. Store the exact generated files, source hashes, JSON counters, screenshot and CDP `.cpuprofile` under `followup/performance/<commit>/`. Temporary file cleanup must not remove archived reproduction inputs.

1. Before warmup, wrap the renderer-owned `layer.cards` methods at runtime. TypeScript private fields here are ordinary JS properties. Fail immediately if expected methods or fields are absent.
2. Reset profiling counters immediately before each timed draw; record them after the normal completion fence. Record warmup and measured frames separately. All wrappers call their original implementations unchanged.
3. Wrap the incoming `add` paint callback to time actual painter execution. Wrap `getImageData` only while a card raster call is active; report count, dimensions, requested bytes and synchronous elapsed time.
4. Wrap `raster`, `slot`, `compact`, `createPage`, `remove`, `finish`, and the renderer instance's `render`. For exact alpha-scan and row-copy timing, inject timers into **served diagnostic source** through a Vite transform hook, with exact source-anchor assertions. Never rewrite the production file. Store the transformed diagnostic source and hash. Without that hook, report the unseparated raster residual honestly and use the CPU profile to identify `cardBounds`/typed-array-copy activity.
5. Wrap the actual WebGL2 context methods `texStorage3D`, `texImage3D`, `texSubImage3D`, `generateMipmap`, `drawElements`, `drawElementsInstanced`, `drawArrays`, `drawArraysInstanced`, and `finish`. Record synchronous call count/time and upload dimensions/texels/bytes. Track bound array textures so mip calls can be associated with page dimensions and allocated layer depth. Do not label JS call duration as GPU execution time.
6. Start the CDP CPU profiler just before the diagnostic cycle, sampling at 1000 microseconds. Stop immediately afterward and archive the complete profile. Timed browser marks delimit each warmup/measurement draw for correlation. A profile that reports native/idle time is not proof of no cost; use GL call wrappers to resolve it.

## Per-frame counters and accounting

- `addRequests`, `warmCacheHits`, `initialMissRequests`, `uniqueRasterizations`, and `duplicatePendingRequestsResolved`: count original cache lookup and actual raster creation separately.
- Slot evictions, page-removal evictions and compaction moves separately; warm keys protected in the current frame; newly allocated/freed pages and bytes; dirty pages/layers; total page/card/texel storage before and after.
- Canvas paint, `getImageData`, alpha scan, slot lookup, row clear/copy, raster residual, compaction, instance setup and renderer elapsed time.
- Upload calls/bytes, mip calls/page texels, GL draw calls, final fence and GL errors.
- Real blood/projectile coverage remains the existing final-art metadata. No simulation runs inside the measured draw; record the unchanged replay hash.

Nested timers must not be summed indiscriminately: paint/readback/scan/copy are children of raster; raster/compact/instance setup are children of finish; GL upload/mip/draw are children of renderer. Report inclusive durations plus explicit parent residuals. Track instrumentation overhead and clock quantization; this profile locates orders-of-magnitude costs, not a publishable speedup.

## Only if the first profile remains ambiguous

Use a second separate diagnostic experiment on **the same replay and full quality inputs**, with one controlled stub at a time:

- Bypass only `renderer.render` after real card generation to isolate CPU preparation; pixels intentionally absent, label the run invalid for visual/performance acceptance.
- Suppress only mip generation or texture upload calls to locate synchronization. These deliberately invalidate rendering, must never enter product code or acceptance performance tables, and require comparing actual GL call timing before/after.
- Alternatively add explicit fences before/after the dominant upload/mip call in a separate run. This changes pipelining and is diagnostic only; do not mix these times into the original profile.

Do not run speculative quality-changing experiments unless the unchanged first profile indicates which one is useful. No blanket “software GPU is slow” conclusion: identify the measured call/path and its per-frame workload first.
