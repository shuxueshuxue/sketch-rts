# Full-domain card streaming: Phase A evidence and follow-ups

This page records the **historical Phase A** comparison (`f87c3b7` →
`742d2b8`). Its source epochs, timing values and zero-difference captures are
specific to that phase. The integrated renderer subsequently gained original
mip-tail residency and stable ordered multi-bank draws; the three hired-company
models were also independently redrawn. Do not interpret the historical 80
matching battle images below as a claim that the final renderer matches the
old cache-dependent overlap order.

Current verification and deliverables:

- [Combined pipeline mixed ABBA](latency-investigation/pipeline-abba/report.md):
  strict 24 PNGs / eight facts / 480 CPU clocks, all lifetimes and remaining
  long-tail regressions retained. This is the latest combined policy evidence;
  the formal source is `aec09d6`, not a relabelled final HEAD.
- [Budget-only canonical work identity](latency-investigation/rle-budget-only-canonical/report.md):
  the 16 MiB cap preserves all original work and resources below the cap; the
  only resource-field change is the budget value.
- [Final stable-order bank/mip comparison](bank-order/README.zh.md), with a
  corrected **same-source** one-bank/full-chain reference.
- [135-case color/depth/distance GPU proof](bank-correctness.md).
- [Exact idle drawing identities, including the new mercenary models](idle-identity/README.md).
- [Three independent hired-company models](../mercenary-models/README.md).
- [Homepage first-gesture audio proof](../../../../validation/homepage-audio/README.zh.md).
- Earlier frozen client `0de509c`: **124 test files / 956 tests passed** and
  production build passed; [test log](validation/client-final.log) and
  [build log](validation/build-final.log).
- Promoted and upstream-integrated client `1e03c5f`: **133 test files / 1066
  tests passed** and production build passed; [tests](latency-investigation/final-validation/tests.log),
  [build](latency-investigation/final-validation/production-build.log),
  [commands](latency-investigation/final-validation/commands.json).

This follows the viewport work in draft PR #346. The accepted art, animation,
camera, simulation and visible content stay unchanged. The work targets pose
upload bandwidth and allocation peaks rather than eliminating world simulation.

## Latest combined policy and remaining stalls

The [combined same-source comparison](latency-investigation/pipeline-abba/report.md)
uses one full-chain bank with frozen original peak/mask methods and a 48 MiB
cache as reference; the candidate uses one native-mip bank, current peak/mask
methods and the original cache with only its default budget changed to 16 MiB.
It retains current artwork, upload implementation, allocator and corrected draw
order. The four-run ABBA includes four complete lifetimes per policy, with no
slow or cold samples removed. These are whole-policy measurements; they cannot
be split into component gains or added to earlier phase percentages.

| Mixed combined metric | Reference | Candidate |
| --- | ---: | ---: |
| CPU mean / p95 | 44.013 / 127.8 ms | 42.356 / 112.3 ms |
| CPU maximum | 470.9 ms | **696.9 ms** |
| Complete real-wall mean | 435.542 ms | 431.325 ms |
| Subsequent real-wall mean / p95 | 348.745 / 1039.8 ms | 349.050 / 1068.8 ms |
| First cold real mean | 1390.300 ms | 1336.350 ms |
| Peak tracked CPU buffers | 60,720,132 B | 26,356,908 B |
| Before-view owned card GPU textures | 210,914,668 B | 191,718,124 B |
| Resident pages / draw chunks | 10 / 61 | 14 / 70 |
| Fresh Canvas misses per lifetime | 1573 | 1723 |

The covered resource reduction is substantial: peak tracked CPU buffers fall
56.59% and before-view card texture ownership falls 9.10%, with exact visible
RGBA and facts. Mean CPU improves 3.77%; complete-wall mean improves only 0.97%,
and warm subsequent wall mean/p95 regress. The worst candidate lifetime has
52.838 ms CPU mean and a 696.9 ms maximum. All real frames remain above 100 ms
in this software-GPU fixture. More pages/draw segments and 150 extra Canvas
misses are explicit costs. The remaining long stalls are not claimed solved.

The production cache promoted at `37a8594` has the exact `f9c83…e78b` source
bytes used by the candidate's external provider. The
[upstream integration receipt](latency-investigation/upstream-integration.json)
records unchanged client/shared/server trees from that promotion to `1e03c5f`.
Final runtime validation is separate from the formal AEC measurement epoch.
Reproduction of the old 48/16 driver requires frozen AEC, frozen 5b providers
and archived candidate/harness bytes; current HEAD already has the 16 MiB
default and cannot be passed off as the original source. Aggregate page/chunk
snapshots do not independently prove every submitted instance or picking;
real-camera correctness remains a separate check.

## Frozen sources and method

- Before: `f87c3b7609df1ab5cd261971ce20f490c508c5ad`, a detached checkout after
  merging current main. Its client tree is identical to the prior viewport
  implementation; this is not a comparison against the older unculled renderer.
- After: `742d2b8`, with nine production/test files changed. Subsequent evidence
  commits do not change these production sources.
- Same Chromium 151 / ANGLE Vulkan SwiftShader, Linux, 1280×720, DPR 1, zoom .75,
  density 4, antialiasing, shadows, sRGB, trilinear filtering and anisotropy.
- All performance browser runs are sequential. Other builds, tests and replay
  probes stop during their measurement windows. The fixture and harness hashes
  must match in `art-card-streaming-report.mjs` before it compares results.
- Canonical fixture: exactly the previous 100 visible humans, plus 0 or 9900
  offscreen units. Two fresh lifetimes per world size, 360 paced measured CPU
  samples and 18 real three-pass samples per lifetime. Snapshot construction,
  capture, GC and simulation are outside the timed presentation body.
- CPU wall includes rasterization, Canvas submission, texture transfers and
  driver backpressure. Only ordinary `renderer.render` is disabled in the CPU
  diagnostic. Real complete-wall includes GPU completion and polling/event-loop
  scheduling. These software-GPU measurements are not hardware FPS or precise
  GPU timer-query durations; 36 real samples cannot establish a stable p99.
- Owned GPU byte counters describe program allocation capacity, including full
  mip chains and scratch. They are not measured driver residency or total VRAM.
  Heap snapshots are after disposal and requested GC, not peak match memory.

## Implementation and proof

1. The scratch texture retains the entire original authored domain. Compare all
   RGBA components and upload the smallest changed rectangle with the public
   `copyTextureToTexture` CPU DataTexture path. This includes clearing old marks
   and changes to RGB under zero alpha. Regenerate the original full mip chain,
   then copy every mip to the destination array layer. Identical input reuses
   that scratch chain. First use and recovery after a thrown transfer upload the
   complete source. No raw GL or private renderer internals enter production.
2. Allocate a smaller final array page when only part of a 16-layer page fits
   the existing 12MP soft budget. Count allocated capacity rather than live
   pixels. Visible working sets may still legitimately exceed the budget.
   Compaction copies displaced active layers into inactive holes in existing
   pages; it does not allocate a temporary third page. Publish maps only after
   all copies succeed, and retain active sources on failure.
3. Paint cache identities follow fields actually read by stock asset painters:
   creature bodies ignore owner color, while four siege painters ignore idle
   breath, attack variation/aim and carried-weapon direction. They still receive
   the original paint inputs. Preserve humans, equipment, facing, density,
   source size and opaque story variants. This does not impose a common rig or
   change the author's drawing.

[GPU correctness](gpu-correctness.md) compares every raw RGBA component at every
mip for 256/320/512/640/704px, including 3/7/14-layer transfers, zero-alpha RGB,
erasure, identical input, disposal/recreation and context restoration. All
429,211,732 compared components match. [Paint identity](paint-identity.md)
documents 10,744 exact whole-domain CPU raster comparisons across 21 creatures
and four siege assets, with human color/mirror and story-variant negative
controls. The complete browser image proof is independent of those unit checks.

## Canonical scene results

Counters are identical across all four matched lifetimes at the same final
clock, apart from timing values. They include preparation and measured frames.

| Resource/work counter per lifetime | Before | After |
| --- | ---: | ---: |
| Base RGBA bytes submitted to scratch | 1,104,789,504 | 140,625,124 |
| Peak owned card GPU allocation | 175,656,256 B | 114,840,148 B |
| Final owned card GPU allocation | 113,442,048 B | 113,442,048 B |
| Final owned CPU buffers/cache | 15,035,956 B | 14,970,420 B |
| Raster / array layer uploads | 627 | 656 |
| Layers moved during compaction | 64 | 27 |
| Array page initializations | 18 | 14 |

Base upload bandwidth falls **87.3%** and allocation peak falls **34.6%**.
Steady-state card allocation is unchanged. Misses/layer uploads rise **4.6%**;
do not claim that the page policy improves general cache hit rate. The CPU
lossless recovery cache remains at its existing 48MiB limit.

Aggregated distributions below use all raw samples, not averaged percentiles.

| 100 visible, offscreen count | CPU mean before → after | CPU p95 | CPU p99 | Samples >50ms |
| --- | --- | --- | --- | --- |
| 0 | 4.44 → 4.28 ms | 16.2 → 19.9 ms | 66.3 → 35.1 ms | 10 → 2 / 720 |
| 9900 | 10.95 → 11.20 ms | 39.8 → 41.3 ms | 70.0 → 55.3 ms | 22 → 15 / 720 |

Fresh-tick mean at 0 offscreen is 9.48 → 8.77ms, with p99 89.0 → 48.9ms.
Real complete-wall means are 156.24 → 146.28ms at 0 offscreen and
167.17 → 161.01ms at 9900. The sample shows fewer long stalls and substantial
resource-transfer savings, but does **not** support a universal CPU speedup:
the 10k-world mean and both full-loop p95 values regress. GPU drawing, full mip
generation/copies, readback and visible pose working sets remain substantial.

[comparison.json](comparison.json) retains distributions, individual lifetime
counters, empty/return camera probes and post-disposal heaps. The 12 composited
PNG pairs compare at **zero differing RGBA channels**, with identical visible
unit/effect facts. Both runs have zero GL errors and successful disposal.

## Mixed assets and real combat

The [mixed fixture](mixed-fixture.md) contains 100 visible units across 20 asset
kinds, including three golems, large beasts and all four siege machines. Each
kind has five motion/action state groups, with both owners. This is a separate
presentation stress fixture, not a simulation benchmark. Two lifetimes provide
120 CPU samples and 24 real draws; its short CPU sequence differs from the
canonical 360-frame sequence, so compare only the paired mixed runs.

| Mixed resource/work counter per lifetime | Before | After |
| --- | ---: | ---: |
| Base RGBA upload bytes | 3,142,189,056 | 678,519,724 |
| Final and peak owned card GPU allocation | 242,765,056 B | 221,793,556 B |
| Final owned CPU buffers/cache | 8,628,992 B | 8,137,472 B |
| Raster / array layer uploads | 2049 | 1793 |
| CPU wall mean / p95 | 136.87 / 564.7 ms | 41.48 / 126.8 ms |
| Real complete-wall mean | 466.05 ms | 465.49 ms |

Mixed base upload bytes fall 78.4%, owned GPU allocation falls 8.6%, and measured
CPU submission mean falls 69.7%. Complete-wall drawing is essentially unchanged:
this is not an overall GPU/FPS speedup. Both recovery caches reach their 48MiB
budget and back off in this mixed sequence; large pose churn remains expensive.
The six mixed composited PNG pairs match at zero differing channels; see
[mixed-comparison.json](mixed-comparison.json). Visual inspection also confirms
the accepted creatures, silhouettes, weapons and shadow treatment are retained.

The actual guard/blood game fixture runs 160 simulation ticks and captures 80
frames. Fresh before/after [proofs](battle-comparison.json) have identical 80 PNG
hashes and 80 authoritative snapshot hashes, with identical shared, AI and server
source trees. The same-clock airborne-blood camera probe retains 30 tracked
drops, submits zero in the empty view, and restores all 32 visible marks without
advancing simulation. Blood transfer to bodies/weapons, held attack guards and
facing checks pass. [Viewing video](battle-after/proof.mp4) and selected PNGs
remain; the independently verified lossless movie from the prior viewport
report is reused only after rehashing all fresh PNGs and the unchanged archive.

## Reproduction

```sh
git worktree add --detach /tmp/sketch-card-streaming-baseline f87c3b7
ln -s "$PWD/node_modules" /tmp/sketch-card-streaming-baseline/node_modules
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-card-streaming-baseline --out /tmp/card-before/raw.json \
  --hidden 0,9900 --repeats 2 --cpu-frames 360 --real-frames 18 --paced --skip-simulation
node --import tsx scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-card-streaming-phase-a --out /tmp/card-after/raw.json \
  --hidden 0,9900 --repeats 2 --cpu-frames 360 --real-frames 18 --paced --skip-simulation
node scripts/art-card-streaming-report.mjs \
  --before /tmp/card-before/raw.json --after /tmp/card-after/raw.json --out /tmp/card-comparison.json
node --import tsx scripts/card-streaming-gpu-proof.mjs \
  --source "$PWD" --out /tmp/card-gpu-proof.json --require-skip
```

See [mixed-fixture.md](mixed-fixture.md) for the separate 20-asset scene. It must
use the same entry fixture on both sides; the canonical harness's legacy top
level `method` wording does not describe mixed content. Its entry fixture hash,
per-cycle scope and asset coverage take precedence. The cache diagnostic is
intrusive/mock-backed and must never be used as a wall-time performance result.

For the historical after side, create a detached checkout at `742d2b8` named
`/tmp/sketch-card-streaming-phase-a` and link the same `node_modules`. Running
current HEAD is the later integrated renderer, not this historical after side.
Use the [final phase method](bank-order/method.zh.md) for current reproduction.

## Validation and remaining limits

The earlier phase-A test counts below belong to that historical source. For the
final stable-order residency comparison, use
[the final performance report](bank-order/final/performance.md). It records the
mixed CPU +6.1% and complete-wall +3.1% regressions alongside lower card texture
ownership. The [subsequent latency investigation](latency-investigation/README.md)
keeps those results and separately measures focused peak-accounting and pick-mask
fixes, rejects the unsuccessful cache/upload candidates, and reports the latest
[combined policy](latency-investigation/pipeline-abba/report.md), including its
696.9 ms maximum and subsequent real-wall regressions. Different source epochs
and benchmark variants are not combined into a single speedup figure.

120 client test files / 871 tests pass, plus the five paint-identity matrix
tests (121 files / 876 tests total). Type checking and the production build pass.
No own AI, shared simulation, server, balance or upkeep rules are modified. No PR
merge or deployment is performed. A large visible army still needs its full painted
pose working set; allocation counters do not imply a hard global memory cap.
Real hardware memory and frame pacing remain unmeasured in this environment.
