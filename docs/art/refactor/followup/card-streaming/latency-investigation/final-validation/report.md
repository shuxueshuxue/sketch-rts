# Final source validation and retained limits

The final runtime keeps all three independent mercenary models and the homepage trusted-click sound fix, and promotes three bounded rendering changes: cheap exact ownership-peak sampling, exact aligned-word picking masks, and the original lossless raster cache with its encoded default budget reduced from 48 to 16 MiB. No admission, ghost, survivor-retention or segmented-upload candidate is shipped.

## Source provenance

Final captures and tests use **`1e03c5fa1ae1cf17276ee20e5fb005573af1e861`**. The budget promotion commit is `37a8594314430a45b7ff822a4d43c28fcd3ad2b2`; its cache SHA is exactly the tested external candidate, `f9c83fe94bcb5fd4136b5ae820911d6af880a50c1e240c8037853a29f3e3e78b`. Only its constructor default differs from the original cache. Existing codec, lookup, LRU, backoff and public statistics remain unchanged.

The [upstream integration receipt](../upstream-integration.json) verifies every client file and the client/shared/server Git trees remain unchanged while integrating upstream `a644ae04c09829233ebd5885721f269440050da2`. The AI tree equals that explicitly named upstream tree. This lane makes no AI, simulation, balance, economy or upkeep-rule changes. PR #346 remains draft; this is not a merge into main or a deployment.

The timed [combined ABBA](../pipeline-abba/report.md) remains correctly labelled **AEC** (`aec09d620801dd07852042732831e5b2de1c4193`), with external frozen providers. Promotion and upstream integration do not relabel historical measurements. Final captures supply separate production correctness evidence.

## Complete final checks

- [133 test files / 1,066 tests passed](tests.log): complete client suite plus shared network, deterministic simulation, canonical state, replay/savegame and server lockstep/room-frame/network checks. Includes mercenary artwork, homepage audio, masks, card ownership, mip residency, uploads, shaders and world-layer tests.
- [Production build passed](production-build.log): global TypeScript check, Vite client production build and server bundle. Exact commands and exit codes are in [commands.json](commands.json). These are validation runs, not benchmark samples.
- [Camera comparison passed](../current-correctness/camera-comparison.json): 31 views, 62 original native/composite PNGs at zero decoded RGBA differences, encoded SHA equality, 5,210 actual picking probes. Covers DPR 1/2, six zooms, two viewport sizes, empty/return and first mip promotion.
- [Real mercenary comparison passed](../current-correctness/merc-comparison.json): 40 full gameplay frames and nine portrait/body/ordinary PNGs at zero decoded RGBA differences, nine real picks, 44 correct release/action/carry direction samples, real hire/attack/heal facts and three observed deaths. All authoritative clocks, commands, releases and outcomes match the frozen oracle. The deaths use the existing scripted real-command fixture; they are not a natural battle-outcome claim.

The independent cross-revision comparator verifies unchanged artwork and all other client files; only the explicitly allowed rendering modules and their tests may differ. Shared/server trees are strict. The changed AI tree requires the explicit full upstream commit, an exact tree match and ancestry proof; it is not silently ignored. The camera probes sample three screen offsets per actor, not every transparent UV boundary; the separate mask semantics corpus supplies that coverage.

Direct visual review inspected the independent mercenary lineup, the current real gameplay frame at tick 57 and the current camera battlefield composite. Company swordsman, contract archer and field medic retain distinct headgear, bodies, clothing and equipment in the game and selection portraits. The resource changes preserve those reviewed pixels exactly.

View or download the [new six-second gameplay video](../current-correctness/merc/gameplay.mp4), [current gameplay still](../current-correctness/merc/frame-019.png), [current battlefield still](../current-correctness/camera/camera-battlefield-composite.png), or [independent model comparison](../../../mercenary-models/lineup.png). Exact original PNG archives and restore instructions preserve every reviewed frame after expanded duplicate files are pruned.

All 111 final PNGs were restored and hash-verified after archival; 23 selected images remain directly viewable. The [camera restore instructions](../current-correctness/camera/PNG-ARCHIVE.md), [mercenary restore instructions](../current-correctness/merc/PNG-ARCHIVE.md) and [archive validation receipt](../evidence-archives/current-correctness-archive-receipt.json) preserve the complete original encoded bytes, proofs and comparisons. Both containers reuse the verified historical payloads; no re-rendering or lossy encoding replaces them.

## Measured benefit and remaining work

The combined same-core comparison pools every sample from four complete lifetimes per policy, in ABBA order. It does not add percentages from isolated experiments.

| Metric | Reference | Candidate |
| --- | ---: | ---: |
| Before-view owned card GPU bytes | 210,914,668 | 191,718,124 (−9.10%) |
| Peak tracked CPU buffer bytes | 60,720,132 | 26,356,908 (−56.59%) |
| CPU render mean / 240 samples | 44.013 ms | 42.356 ms (−3.77%) |
| CPU p95 | 127.8 ms | 112.3 ms |
| CPU maximum | 470.9 ms | 696.9 ms |
| Complete real-frame wall / 48 samples | 435.542 ms | 431.325 ms (−0.97%) |
| Subsequent real-frame mean | 348.745 ms | 349.050 ms |

All 24 benchmark PNGs, eight visible-fact snapshots and 480 CPU clocks match. The savings retain full authored rasters, visible content, rules and corrected ordering. Costs include 150 additional true Canvas misses per lifetime, 10→14 resident pages and 61→70 active draw chunks. The ordinary-world below-cap check separately proves identical work at hidden 0 and 9,900; its two-arm timings are diagnostic only.

Remaining limits are material: the slow 696.9 ms CPU sample remains in the result, fresh-tick CPU mean and p99 regress, and subsequent real-frame mean/tails do not improve. All measured complete real frames remain above 100 ms in this software renderer. Long deferred Canvas drawing and the observed graphics-channel wait are not solved. The [rejected experiments and raw evidence](../README.md) retain their unfavorable results and the original mixed regression.

All browser measurements use Chromium 151 with ANGLE Vulkan SwiftShader. CPU samples suppress scene draw but retain raster preparation, transfers and driver backpressure; complete-wall samples wait for GPU-command completion and include scheduling. Neither measures simulation cost or hardware GPU FPS. Declared typed-array/card-texture ownership is not total process RSS or VRAM; 16 MiB is only the encoded-cache cap. Hardware profiling and further upload/Canvas latency work remain outstanding. No broad frame-rate or all-stalls-solved claim is made.
