# Exact n135 upload capture and isolated replay

The first browser run preserved the actual 53 upload payloads and passed native
RGBA/state checks in all three replay passes. Its final HTTP mapping guard failed,
so **the original run remains EXIT1**. A separate offline companion audit verified
all 199 captured HTTP bodies and resolved its six mapping gaps using actual
transformed JS import edges. No browser capture, raw result or used helper was
rewritten to change the original failure.

- [Original proof and failure](run-v1/proof.json.gz), [original complete log](run-v1/run.log.gz)
- [Original HTTP response metadata and six gaps](run-v1/runtime-http-scripts.json.gz)
- [Independent HTTP companion audit: PASS](run-v1/runtime-http-companion-audit.json.gz)
- [Actual complete input capture](run-v1/capture.json.gz), [individual RGBA manifest](run-v1/rgba-manifest.json.gz)
- [n135 image from an untimed actual render](run-v1/n135-untimed.png)
- [Independent per-event validation](run-v1/replay-validate.json.gz)
- [Frame-end replay](run-v1/replay-frame-end.json.gz), [per-layer replay](run-v1/replay-each-layer.json.gz)

## Inputs and exactness

Source is detached `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` in
`/tmp/sketch-queue-source-42bd`. All 1,125 tracked source files were verified
against Git blobs, snapshotted and checked unchanged at completion. Startup and
finish Three/GLTF optimizer bundles and complete-query Three identity stayed
stable. The harness repository's HEAD is independent of the source worktree.

Each fresh renderer executes the actual 18 preparation draws (n0..51), followed
by all 81 paced frames n54..134 with `renderer.render` disabled. Before accepting
replay, the observer checks full scratch bytes/LRU/flags/config/native mips and
all page IDs/readiness/shapes/native layers, plus the actual batch page/card map.
History fences and native readbacks are untimed and deliberately perturb the
queue; matching warm content does not prove identical allocator or token history.

The actual target stream contained **53 uploads and no page creation, compaction,
release or disposal events**. These zero counts are observations, not assumptions.
Full source RGBA inputs occupy **85,458,944 bytes**, and prior CPU scratch images
occupy **3,031,040 bytes**. All channels, transparent RGB and padding are retained
in independently copied payloads. Original simulation and presentation methods
remain synchronous; no production file was modified.

The independent validation pass immediately read each upload's destination tail,
so a later overwrite cannot hide a defect. All **523 written native mip levels**
matched the independent full-domain, native sRGB GPU-generated source chain at
zero RGBA difference. All **1,040 final resident native mip/layer combinations**,
including untouched layers, matched the captured final state. Both isolated timing
passes also matched those final layers and the complete uploader CPU/GPU state.
The CPU-only DataTexture view remained uninitialized.

The selected native content API sequence was identical in capture and replay:
53 `texSubImage2D`, 53 `generateMipmap`, 46 `copyTexSubImage3D`, and 477
`blitFramebuffer` calls, with no target texture allocation. This is a selected
content-call guard, not a log of every GL call or a complete binding-state proof.
Observed texture names track the target's latest bind and are auxiliary only;
payload SHA and actual native RGBA prove contents.

## Timing boundary and observations

Independent oracle textures are allocated only in the untimed validation pass.
The timing passes reuse its hashes, decode all input buffers before timing, and
perform final state/native reads after completion. Query markers and completion
fences remain diagnostic perturbations. Submission measurements include observer
checks and selected-call recording. Completion waits include flush, polling and
event-loop scheduling. Query elapsed intervals can include command arrival/idle;
none is claimed to be exclusive algorithm time or portable hardware performance.

| Isolated policy | Submission total | Completion waits | Entire replay envelope | Whole-upload query total |
| --- | ---: | ---: | ---: | ---: |
| Frame-end fence | 43.60 ms | 867.40 ms | 911.40 ms | 906.33 ms |
| Fence after each upload | 43.40 ms | 1,066.90 ms | 1,112.20 ms | 919.56 ms |

Each timing arm has 53 supported, non-disjoint whole-upload query intervals.
Per-layer waiting increased the envelope in this single diagnostic. It is not
adopted as an optimization. The validation pass's 4,297.60 ms envelope includes
immediate native readbacks and is not a comparable timing arm.

Actual scratch transport is **20,053,380 bytes**, versus **102,868,324 copied native
mip bytes** across 523 copies. Whole-upload query intervals are approximately
11 ms for 512-square sources and 21 ms for 704-square sources. Similar intervals
for N0/N1 at the same source size do not identify a dominant phase: N0 base copies
use a different native API path from tail blits. A separate upload/generation vs
all-tail-copy marker experiment is needed before selecting another candidate.

This is one capture, one validation pass and two isolated replay passes, not
formal ABBA, a full n135 draw benchmark or a renderer optimization. The runtime
uses software Chromium 151/ANGLE SwiftShader; results do not generalize to a
hardware GPU. The screenshot is a direct untimed real render after the event and
state capture, with no second `view.draw` or extra target uploader events. The parent visually reviewed this image as the actual 20-kind asset probe;
it is not a combat scene.

## HTTP mapping failure and companion proof

The original matcher preserved semantic queries. Vite's graph stored three
imported generated JSON modules under bare IDs, while the browser received their
JS transforms at the same paths with `?import`. That caused six missing mappings
(three loaded-module rows and three graph rows), although all three response
bodies had already been saved.

The companion reads all 199 body files, verifies complete SHA/size, and recomputes
388 inventory mappings. It permits only four actually captured JS literal import
edges from `ship-equipment.ts`, `ship-geometry.ts`, and `ship-navigation.ts`, backed
by exact graph dependencies, same-origin complete target URLs and response-body
SHA. Those edges resolve the six original gaps. No general query stripping or
post-run browser request is used. The companion passes with **388/388 mappings**
and zero violations; the original proof continues to report its original failure.

## Reproduction

A browser run requires an owner-scheduled exclusive window and a new output
directory; existing runs are never overwritten.

The invocation below records the original run. Maintained replay scripts have
since advanced to the next stage; they do not replace the executed run-v1
[driver](run-v1/art-card-upload-replay-proof.mjs.gz),
[observer](run-v1/art-card-upload-replay-observer.mjs.gz) or other frozen helpers.
Restoration recovers those original snapshots without changing maintained scripts.
Before inspecting or reusing stored evidence with the original analyzer/driver,
restore replay inputs, then the single complete source snapshot:

```sh
python3 scripts/art-replay-input-archive.py --materialize
python3 scripts/art-replay-source-archive.py --materialize --folder exact-upload-replay/run-v1
```

These commands omit `--out` so original filenames remain available in the
repository. [The archive guide](archives/README.md) documents independent
restore layouts and cleanup. This run has its own input/source archives; old
naming or queue input materialization belongs to re-auditing those other captures.

```sh
node --experimental-strip-types scripts/art-card-upload-replay-proof.mjs \
  --source /tmp/sketch-queue-source-42bd \
  --out docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1
```

The already captured HTTP evidence can be audited without a browser. The output
uses exclusive creation and must be changed for another run:

The command below preserves the audit invocation associated with this evidence.
The input manifest retains its companion result, but does not contain a copy
of the HTTP audit executable; materialization does not restore maintained audit
code. Inspect its original execution provenance before treating a new invocation
as a reproduction of that tool's past execution.

```sh
node scripts/art-card-upload-replay-http-audit.mjs \
  --run docs/art/refactor/followup/card-streaming/stall-followup/exact-upload-replay/run-v1 \
  --out /tmp/new-runtime-http-companion-audit.json
```

Used entry/observer/source-freeze/collector/driver bytes and their hashes are
archived in the run. All six new browser helper/entry files and the offline audit
passed `node --check`. No production build/test was claimed from this diagnostic.
The complete capture JSON exceeds Git's single-file limit in raw form. Exact
input compression is now complete: [the input manifest](archives/input-archives.json)
retains 279 original filenames, complete size/SHA and same-path gzip identities,
including 55 binary payloads and all 199 HTTP bodies. Original metadata gaps,
the overall EXIT1 and the independent companion result remain unchanged.
The one original PNG remains in place. [The archive guide](archives/README.md)
links the verified input/source preservation records; compression is not another
browser run or an additional performance result.

The later [native upload/generation versus tail-copy report](stage-report.md)
retains its own [v2 startup failure](stage-run-v2/proof.json.gz),
[v2 log](stage-run-v2/run.log.gz) and [v3 completed proof](stage-run-v3/proof.json.gz).
The v2 failure saved no helper/source snapshots. [The stage archive guide](stage-archives/README.md)
records exact compression and recovery of both runs' inputs, with only v3's
single complete source snapshot. Rechecking tools that read the original corpus
restore v1 inputs first, then stage inputs and v3 source before using the archived
driver/helper bytes. Current maintained scripts are not restored to past versions.
At stage packaging time, its SDK check was deferred until the final stage;
the prior run-v1 baseline result remains a historical observation.

The [final upload / native-generation / tail-copy report](stage4-report.md)
retains its [v4 proof](stage-run-v4/proof.json.gz), [generation summary](stage-run-v4/generation-summary.json.gz)
and [159-interval result](stage-run-v4/replay-stage-query.json.gz) in exact gzip.
[The generation archive guide](generation-archives/README.md) records completed
input/source verification, cleanup and complete original-SHA recovery. For tools
reading the original corpus, restore v1 inputs first, then generation inputs and
v4 source before checking the original driver/helper snapshots. The old v1 corpus
gzip is reused without exporting it again; current maintained scripts do not
stand in for earlier execution bytes. The [final original SDK test](../../../naming-gate/final-replay-generation-single-test.log.gz)
completed with 6 pass / 1 fail in 22.60 seconds; [path validation](../../../naming-gate/final-replay-generation-validation.json)
confirms exactly the original 22 baseline paths and zero new matches. The
[source freeze record](../../../naming-gate/final-replay-generation-source-freeze.json)
preserves source/public checks before and after testing. This retains the naming
failure and does not establish a fully green repository.
