# Queue bracket diagnostic plan (not executed)

Production and rejected candidates remain unchanged. This plan observes the same
production GPU content commands; it adds synchronization and scheduling changes
that must be reported as observer perturbation. A slow WebGL API boundary is not
proof that its named GPU operation exclusively caused the delay.

The safest first comparison uses three strategies, each with the original two independent
lifetimes and all original sample frames/content retained:

| Policy | Before n135 CPU draw | After n135 CPU draw |
| --- | --- | --- |
| Control | No added synchronization | No added synchronization |
| Pre-drain | Fence + flush + asynchronous zero-timeout polling | Original schedule |
| Pre/post bracket | Same historical queue drain | A second fence + flush + asynchronous polling |

The fence insert point is after the stock async fixture's `update(n)` and before
its existing CPU `at=performance.now()`. This excludes fixture snapshot creation
from the drain and keeps the same snapshot, logical clock, facing and animation.
Control does not add an unconditional `await`/microtask. Both bracket modes record
pre-drain latency separately; CPU submission retains the original synchronous
`view.draw`. The post bracket starts only after the complete draw returns. Total
bracket time includes both drains, CPU submission, cleanup and scheduling; a
shorter CPU draw after a long pre-drain is latency relocation, not optimization.
The post wait includes any new queued work in that draw and scheduling; it is
not an isolated mip-generator duration. Preserve all CPU/real sample arrays,
frame-start intervals, warmup rows and original real-frame completion records.

Existing evidence for synchronous call contracts:

- `src/client/world3d/world-layer.ts:202` implements synchronous `draw`; line425
  calls both card batches' synchronous `finish` before returning.
- `src/client/world3d/painted-card-batches.ts:168` synchronously calls
  `mipUploader.uploadLayer`, then publishes the card/slot and instances.
- `src/client/world3d/card-mip-uploader.ts:72` synchronously initializes/uploads
  the scratch and copies every native tail level before publishing completion.
- `scripts/art-viewport-streaming-fixture.js` already has an async cycle, paced
  CPU loop and `waitForArtGpuCompletion` for preparation/real frames.
- `scripts/art-gpu-completion.mjs` already uses public `fenceSync`, `flush`,
  zero-timeout `clientWaitSync`, event-loop yielding, timeout and `deleteSync`.

Making uploader/draw wrappers async would change caller semantics. Immediate
asynchronous per-layer waiting cannot be safely inserted there without rewriting
the actual production call chain. Busy-spin polling would hold the main thread,
starve scheduling and distort SwiftShader work. Do not use it. If per-layer
positions are needed later, synchronously insert completion markers after each
successful upload but defer polling until the frame returns. Such markers give
observed completion bounds, not independent per-layer execution durations, and
add their own queue commands. They do not serialize original uploads.

Use new exclusive fixture, observer and runner files; do not edit executed stock
helpers. Freeze the requested production commit and its complete src/public
inventory. Reuse the already verified v2 explicit startup Three/GLTF optimizer,
start/final bundle and chunk SHA, exact Three query identity, full source/helper
snapshots and module graph. Keep two independent WorldPresentation lifetimes,
original18 preparation /60 warm /60 CPU /12 real schedule, empty/return probes,
original between-lifetime GC and no simulation. Keep errors and failed traces.

The new observer should record fence creation/flush/delete wall separately,
individual zero-timeout polls and their status/call wall, every yield interval,
timeout/context-loss facts, total drain wall, performance time origin and User
Timing markers. It must not query or alter render targets/framebuffers. Existing
GL boundary wrappers and supplied texture/ROI scalar arguments remain intact.
Record observer fence/query operations separately from original content commands.
Cross-policy strict checks compare all snapshot facts/SHA, screenshot RGBA,
source mip/domain/filter configuration, page layouts, original upload/copy/gen
counts and exact ROI sequence. A divergence invalidates the comparison rather
than being silently excused as perturbation.

Optional later GPU timer queries require runtime extension support. Query
results/disjoint status must be collected asynchronously outside CPU submission;
never label a CPU function timer as GPU time. A query covering upload/native mip
commands still measures command-boundary elapsed time and can include GPU idle
while commands arrive; it does not prove exclusive algorithm cost. Avoid nested
time-elapsed queries and keep query commands in their own observer account. The
first minimal comparison need not add these queries.

Interpretation: a large pre-drain plus a shorter n135 API stall supports inherited
queue pressure affecting that sample, not a wall-time gain. A remaining stall
with a drained history suggests pressure created inside the current draw or
another cause; it does not prove scratch mip generation alone. New trace timing
must establish the actual command-channel sequence. `/dev/dri` is absent; this
software Chromium/ANGLE environment is not a hardware-general result.
