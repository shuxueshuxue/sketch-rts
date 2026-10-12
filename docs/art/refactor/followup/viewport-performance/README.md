# Fixed visible content, increasing offscreen population

This experiment measures how much client presentation work is caused by units
outside the camera. Every scenario contains the same 100 visible units, the same
movement, attack/cast releases and blood facts, selection, map and camera.
Only the offscreen population changes: 0, 900, or 9900 units. Those units cover
eight kinds with stationary, moving, charge, attack and cast display states.
The visible content is **not reduced** for the larger worlds.

## Frozen baseline and environment

- Baseline: `b50cc87982c333ddbdbef9a0977d2251d8b03250`, detached checkout
  `/tmp/sketch-viewport-baseline`. That checkout is unchanged by implementation.
- Node 24.19.0, Chromium 151.0.7922.173, Linux, ANGLE Vulkan SwiftShader.
  This environment supplies a **software GPU**. No hardware FPS claim is valid.
- 1280×720, DPR 1, zoom 0.75, same antialiasing, 2048 shadow map and authored
  artwork as production. `preserveDrawingBuffer` is enabled solely to make the
  composite screenshot capture reliable and is identical in both runs.
- Real samples run sequentially; other test/build/performance workloads are
  paused. Each count receives two independent WorldPresentation lifetimes.
- `before/results.json` includes the source commit, five relevant production
  source hashes, harness and fixture hashes, browser identification, all timing
  samples, owned card resource counters and a separately timed simulation probe.
  The exact original baseline harness/fixture are archived beside it.

## Measurements and limitations

1. The real production `WorldPresentation.draw` runs all three passes: WebGL
   actors, Canvas ground and Canvas overlay. The timed body does not replace
   snapshots with camera-clipped snapshots or externally update trackers.
   Production code chooses what work to perform.
2. Eighteen real draw updates prepare the scene. Sixty CPU warmup frames precede
   360 measured frames per lifetime. A fresh snapshot arrives every three frames
   (20 Hz); same-tick and fresh-tick distributions are also reported. Snapshot
   construction occurs outside the timed body.
3. For the CPU diagnostic, only `renderer.render` is temporarily disabled.
   This excludes normal GPU scene rendering, but card rasterization, uploads,
   driver backpressure and Canvas submission can still occur. These are **CPU
   submission wall times, not isolated JavaScript execution times**. Long upload
   stalls are retained in raw samples and quantiles. The nested World3DLayer
   timer and the remaining Canvas passes/coordinator timer sum to the full timer;
   adding the full timer to the layer timer would double count.
4. Eighteen further real three-pass draws per lifetime wait for a verified
   `fenceSync/flush/clientWaitSync` completion. The wall measurement contains
   submission, GPU completion and event-loop polling/scheduling. It is an upper
   bound, **not a precise GPU timer duration or display cadence**. The 36 total
   real samples per world size are too few to infer a stable p99. All sample
   durations and frame-start intervals are retained.
5. The camera moves to empty space, then returns at the same prescribed time.
   The three canvases are composited into battlefield, empty and return PNGs.
   The comparison script checks every RGBA channel, not only a visual glance.
   The visible facts are hashed separately from images.
6. Owned card GPU bytes count program-owned allocation capacity, not actual
   driver/hardware residency. Pick masks, raster recovery, scratch buffers and
   canvas backing are listed separately. Heap samples are collected **after
   layer disposal and requested GC**; they are not peak in-match memory.
7. The simulation probe executes 12 real ticks, excludes two warmup ticks, and
   separately times snapshot serialization. Units hold with one owner and no AI.
   It diagnoses population scaling only; it does not estimate actual combat/AI
   tick costs. Simulation is never included in presentation timing.

## Baseline observations

The two baseline lifetimes produced full three-pass CPU submission p50 values:

| Offscreen units | Visible units | Lifetime 1 p50 | Lifetime 2 p50 |
| ---: | ---: | ---: | ---: |
| 0 | 100 | 0.90 ms | 0.90 ms |
| 900 | 100 | 2.10 ms | 1.90 ms |
| 9900 | 100 | 17.50 ms | 17.70 ms |

The first lifetime's fresh-tick p50 was 2.30 / 5.50 / 29.80 ms respectively.
In all six lifetimes, the battlefield PNGs had the same byte hash; the return
PNGs also matched across sizes and repeats. Visible facts matched byte for byte.
All six scenes retained 61 painted cards and exactly 113,442,048 owned GPU bytes
at the same final frame. Actual rendered content and card resource demand are
thus fixed while CPU presentation cost grows with the offscreen population.

The absolute mean submission costs, approximately 23–26 ms, are strongly
affected by software-driver upload backpressure and new pose stalls. Full real
complete-wall means were approximately 207–242 ms. Neither establishes hardware
FPS, and this viewport experiment does not solve the separate pose upload/cache
problem. Baseline rendering still spends real work on previously unseen poses.

Baseline sampling completed with all validation checks passed. Its original
runner then hit a temporary-profile cleanup race after writing the complete
report. The current runner only adds a browser-exit wait and retrying directory
cleanup; the fixture and timed bodies are unchanged.

## Reproduction

```sh
git worktree add --detach /tmp/sketch-viewport-baseline b50cc87982c333ddbdbef9a0977d2251d8b03250
ln -s "$PWD/node_modules" /tmp/sketch-viewport-baseline/node_modules
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-viewport-baseline \
  --out docs/art/refactor/followup/viewport-performance/before/results.json
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source "$PWD" \
  --out docs/art/refactor/followup/viewport-performance/after/results.json
node scripts/art-viewport-compare.mjs
```

Smoke flags: `--hidden 0 --repeats 1 --cpu-frames 36 --real-frames 3
--skip-simulation`. A smoke run is insufficient for performance claims.

## Stage 1: useful same-tick improvement, rejected fresh-tick result

The first candidate is frozen at
`5eb401d9bbb6db43d4a1bc3b1029b82ed2cd397b`. Its complete run, original harness,
fixture and captures are preserved in `stage1/`. Both runs passed browser
validation. `stage1/comparison.json` pools 720 CPU frames and 36 real complete
frames for each population size.

| Offscreen units | CPU p50 before → stage 1 | CPU p95 before → stage 1 | CPU mean before → stage 1 |
| ---: | ---: | ---: | ---: |
| 0 | 0.90 → 0.80 ms | 16.00 → 16.10 ms | 23.93 → 24.01 ms |
| 900 | 2.00 → 1.00 ms | 18.30 → 19.50 ms | 24.65 → 24.97 ms |
| 9900 | 17.60 → 1.10 ms | 42.30 → 48.20 ms | 25.00 → 24.01 ms |

For 9900 offscreen units, both fresh-tick lifetime medians **regressed** from
29.80 / 30.90 ms to 32.40 / 34.70 ms. All 240 fresh-tick samples in each run
exceeded 16.67 ms. The same-tick improvement is substantial, but this candidate
does not meet the goal of reducing new-snapshot work and cannot be reported as
an overall solution. Software-driver upload stalls also remain: total p99 grew
330.40 → 453.20 ms and samples above 50 ms grew 20 → 31. Those tails contain
resource upload/driver effects and are not attributable solely to JavaScript.

The nested World3DLayer p50 improved 9.80 → 0.70 ms and the Canvas/coordinator
p50 improved 3.50 → 0.40 ms in that largest scene. Final candidates, posed units
and stored visible positions were all exactly 100; the index still held the
10,000 world facts in 3470 populated cells. The empty-camera probe produced
zero candidates and zero posed units. Its remaining GPU draw is the background
shadow receiver (two triangles), not offscreen blood. This probe occurs after
airborne drops have landed, so it **does not measure live offscreen droplet
submission**. Dedicated boundary/unit tests and the real battle proof cover
that behavior separately.

All 18 before/stage-1 composited PNG comparisons have **zero changed RGBA
pixels**. Visible fact hashes are identical. Painted card counts, resource
allocation capacity and upload/rasterization counts are unchanged: 61 final
cards, 113,442,048 owned GPU bytes, 15,035,956 owned CPU bytes, 627 rasterizations
and 1,104,789,504 cumulative scratch-upload bytes per lifetime. The latter
includes preparation, warmup and measurements; it is not a per-frame number.
The viewport index introduces additional CPU-side data structures whose exact
bytes are not covered by the painted-card counters. Post-disposal CDP heap
readings cannot establish in-match peak memory or those structures' capacity.

The fixture's untimed counter collector gained `viewStats` after the baseline.
Consequently the whole fixture hash differs; the comparison explicitly records
`fixtureIdentical: false`. Removing only that collector and its explanatory
comment gives identical hashes for the remaining entire fixture,
`fixtureExceptUntimedCountersIdentical: true`. The snapshot construction,
timed loops, timestamps, rendering configuration and capture body are unchanged.
The current runner additionally archives itself and the fixture and records all
client source file hashes (including newly introduced source files). These
metadata and cleanup changes are outside the sample timers.

## Stage-1 phase diagnostic

`scripts/art-viewport-diagnostic.js` imports the unchanged formal fixture and
wraps production method prototypes to locate costs. This intrusive diagnostic
is separate from the formal sample. It reads the detached stage-1 source, so
later edits cannot affect it. `stage1/diagnostic/results.json` preserves its
90 CPU samples, 30 of them fresh ticks. `phase-summary.json` aggregates each
inclusive phase. Phases can nest; adding their times double counts some work.

| Phase | Fresh-tick p50 | Fresh-tick mean |
| --- | ---: | ---: |
| View index update | 9.80 ms | 10.87 ms |
| Animation history update | 4.80 ms | 6.74 ms |
| Combat history update | 4.10 ms | 4.25 ms |
| Motion history update | 1.70 ms | 1.70 ms |
| Facing history update | 1.10 ms | 1.57 ms |
| Wake history update | 0.20 ms | 0.26 ms |
| Camera query | 0.10 ms | 0.08 ms |

This locates the new overhead in rebuilding the full grid, not querying visible
cells. It supports reusing entries and cell membership while maintaining all
world history needed for re-entry. Animation/combat allocations also deserve
attention. The diagnostic's total fresh-tick p50 was 32.10 ms; its three real
draw samples are not a performance comparison.

```sh
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-viewport-stage1 \
  --fixture art-viewport-diagnostic.js \
  --out docs/art/refactor/followup/viewport-performance/stage1/diagnostic/results.json \
  --hidden 9900 --repeats 1 --cpu-frames 90 --real-frames 3 --skip-simulation
```

## Final unpaced comparison

The revised production source is frozen at
`35dca2b748fb6f620e4ba1f932d32a7b45d6cf85`. The full source run is preserved in
`after/`, and `comparison.json` compares it with the original baseline. All
18 RGBA image pairs have zero changed pixels; visible fact hashes match.

| Offscreen units | Full CPU p50 before → after | Full CPU p95 before → after | Full CPU mean before → after |
| ---: | ---: | ---: | ---: |
| 0 | 0.90 → 0.80 ms | 16.00 → 17.10 ms | 23.93 → 23.81 ms |
| 900 | 2.00 → 1.20 ms | 18.30 → 20.90 ms | 24.65 → 25.39 ms |
| 9900 | 17.60 → 1.10 ms | 42.30 → 36.40 ms | 25.00 → 23.74 ms |

For the largest world, 380 → 157 of 720 samples exceed 16.67 ms. Same-tick p50
falls 11.40 → 0.80 ms and fresh-tick p50 falls 30.20 → 21.30 ms. This fixes the
stage-1 fresh-tick median regression, while keeping all visible detail.

**The long tails remain problematic and are not hidden.** Fresh-tick mean rises
40.64 → 55.58 ms and p95 rises 52.60 → 487.40 ms. Total p99 rises
330.40 → 580.50 ms and max rises 462.20 → 1040.00 ms; total samples above 50 ms
remain 20 → 20. The full real SwiftShader complete-wall mean rises
211.12 → 238.36 ms in the largest scene, while its median falls
151.00 → 143.60 ms. These data **do not prove GPU acceleration or a general
frame-time improvement**. They prove a reduction in the common presentation
path and visible-pose work; uploads, snapshot/history work and severe stalls
remain separate constraints.

The timed CPU loop intentionally submits 360 frames synchronously, with the
normal GPU scene render disabled. A possible explanation is that faster common
frames feed the software driver uploads sooner, shifting its backpressure into
fresh frames; the slower baseline gives it more background time. That is an
inference, not an established causal decomposition. A separately recorded RAF
paced comparison follows to test whether the effect persists when frames yield
to the browser. The original adverse unpaced tails remain preserved.

## Paced pilot and follow-up

`--paced` adds one `await requestAnimationFrame` **outside the CPU timer**, before
snapshot construction, in each CPU iteration. Every snapshot, tick schedule,
visible event, authored raster, canvas pass, upload and original timer body is
unchanged. The flag, generated harness, fixture hashes and original files are
archived independently in `paced/`; this never overwrites unpaced reports.

The pilot uses one lifetime per world size and 120 CPU samples (40 fresh ticks).
These are exploratory data, not the final formal sample:

| Offscreen units | Full CPU mean before → after | Full CPU p95 before → after | Fresh CPU mean before → after | Fresh CPU p95 before → after |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 5.05 → 5.25 ms | 20.60 → 21.80 ms | 10.70 → 11.78 ms | 41.20 → 74.80 ms |
| 9900 | 25.91 → 11.57 ms | 59.20 → 42.20 ms | 43.45 → 30.97 ms | 77.90 → 66.10 ms |

The largest world improves in both mean and p95 under pacing, supporting further
measurement of the driver-backpressure hypothesis. The smaller scene has
variable tails and some extra cost. Each pilot lifetime performed exactly 340
rasterizations and 575,045,632 cumulative scratch-upload bytes in both sources.
Two full 360-sample lifetimes per size are preserved in `paced/before/` and
`paced/after/`; `paced/comparison.json` contains their pooled distributions.
The formal paced run validates with zero changed RGBA pixels in all 12 image
pairs, identical visible facts and identical full fixture hashes.

| Offscreen units | Full CPU mean before → after | Full CPU p50 before → after | Full CPU p95 before → after | Full CPU p99 before → after |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 5.16 → 5.00 ms | 1.40 → 1.30 ms | 17.70 → 20.20 ms | 78.90 → 78.30 ms |
| 9900 | 25.36 → 11.06 ms | 19.50 → 1.50 ms | 56.80 → 39.20 ms | 81.20 → 68.60 ms |

| 9900 offscreen units | Mean before → after | p50 before → after | p95 before → after | p99 before → after |
| --- | ---: | ---: | ---: | ---: |
| Fresh ticks (240 samples) | 42.81 → 28.92 ms | 40.50 → 24.20 ms | 76.60 → 53.30 ms | 89.60 → 100.20 ms |
| Same tick (480 samples) | 16.64 → 2.13 ms | 13.70 → 1.20 ms | 31.10 → 6.30 ms | 44.90 → 13.90 ms |

The large-world paced CPU mean falls 56.4%, full p95 falls 31.0% and fresh-tick
mean falls 32.5%. Samples above 16.67 ms fall 414 → 222; samples above 50 ms
fall 63 → 16. Fresh-tick p99 still grows 89.60 → 100.20 ms, and 218 of 240 fresh
frames still exceed 16.67 ms. The smaller world's full p95 also grows
17.70 → 20.20 ms, while mean and p99 are essentially stable. These limitations
prevent any claim of universal improvement or sustained 60 fps.

The paced real complete-wall mean is 172.87 → 157.09 ms for the largest world;
this remains a SwiftShader submission/completion/scheduling upper bound,
not an isolated GPU speedup. Every formal lifetime still performs exactly 627
rasterizations, 1,104,789,504 cumulative scratch-upload bytes, 6270 mip-copy calls
and the same final card allocation capacities as the unpaced runs. Yielding
changes the queueing conditions while preserving workload and visual content.
The result supports the backpressure interpretation of the unpaced tail shift,
but does not identify its exact GPU-versus-scheduler contribution. Both the
adverse unpaced data and the favorable paced data are retained.

```sh
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-viewport-baseline \
  --out docs/art/refactor/followup/viewport-performance/paced/before/results.json \
  --hidden 0,9900 --repeats 2 --paced
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source "$PWD" \
  --out docs/art/refactor/followup/viewport-performance/paced/after/results.json \
  --hidden 0,9900 --repeats 2 --paced
node scripts/art-viewport-compare.mjs \
  docs/art/refactor/followup/viewport-performance/paced/before/results.json \
  docs/art/refactor/followup/viewport-performance/paced/after/results.json \
  docs/art/refactor/followup/viewport-performance/paced/comparison.json
```

## Real battle, simulation identity and active offscreen drops

`scripts/art-viewport-battle-proof.mjs` adapts the existing
`art-guard-blood-fixture.ts` by relocating its imports, recording every simulated
snapshot hash, and adding a same-clock camera probe. It retains the original
commands, 160 simulation ticks, 80 capture frames and authored artwork. The
generated fixture and normalized source hash are archived for both versions.

- Both sources passed the original guard/blood proof: four directional lancer
  kills, retreat/idle carry, carry expiry, body and weapon blood transfer and
  correct facing.
- **All 80 simulation snapshot hashes match**, and **all 80 original PNG byte
  hashes match**. The `src/shared`, `src/ai` and `src/server` Git tree hashes
  are identical. No simulation, AI or server rule changes are involved.
- At frame 1 / tick 2 / 100 ms, 30 real lethal-hit droplets are airborne. The
  battlefield submits 32 ink instances (30 air + two body) in both versions.
- With the camera moved to empty space at the **same clock and same snapshot**,
  baseline submits all 30 invisible airborne instances in one GPU draw; the new
  source submits **zero**, recording 30 culled instances. World droplet history
  stays at 30, and the simulation hash stays unchanged.
- Returning the camera restores 32 instances and exactly the original PNG bytes
  in both versions. The extra draws run zero simulation steps.

Evidence: `battle/comparison.json`, both `battle/*/proof.json`, seven selected
frames per source, the three probe images, and `battle/after/proof.mp4`. All
80 original frames are retained once as
`battle/before/all-frames-lossless.mkv` (FFV1 BGRA, 19,623,152 bytes). Before
removing the 160 duplicate `frame-NNN.png` files, the archive was decoded to RGBA
and every frame hash matched the original pixels. Both source runs' original
RGBA hashes are stored in `battle/archive.json`; all 80 before/after hashes
match. The encoded source PNG byte hashes remain independently in `proof.json`.
Re-encoding a decoded lossless frame as PNG may change its encoded-byte hash
while preserving every pixel; those hashes must not be confused.

```sh
node --import tsx scripts/art-viewport-battle-proof.mjs \
  --source /tmp/sketch-viewport-baseline \
  --out docs/art/refactor/followup/viewport-performance/battle/before/proof.json
node --import tsx scripts/art-viewport-battle-proof.mjs \
  --source "$PWD" \
  --out docs/art/refactor/followup/viewport-performance/battle/after/proof.json
node scripts/art-viewport-battle-archive.mjs
```

The archive script must run after performance sampling. It verifies the original
PNG bytes, decoded RGBA identity and the lossless video's decoded frames before
deleting duplicate raw PNGs. Selected images, all source hashes and the small
viewing MP4 remain available.
