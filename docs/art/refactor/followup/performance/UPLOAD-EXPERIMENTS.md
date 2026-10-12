# Controlled upload diagnostics (9de6820)

All experiments preserve the same 1000-unit replay, four warmup frames, twelve measured frames, production combat trackers, texture resolution, filtering, mipmaps and visible contents. They are diagnostic runs with CDP/timer overhead, not formal optimization results. The isolated worktree is fixed to 9de6820 and no MAIN production source is changed.

## Dirty layers versus whole pages

[Full-page evidence](9de6820-fullpage/comparison.json) clears each dirty page's layer-update set immediately before the real renderer uploads it. Three consequently submits the unchanged entire page buffer once. Replay SHA, visibility, mode distribution, complete final-art event coverage, final cache state and final decoded RGBA screenshot are all identical to [the original profile](9de6820-profile/profile.json).

Mean upload calls fall 248 → 45.67 per frame while uploaded bytes rise 163.00 → 473.78 MB. CPU time inside `texSubImage3D` remains 4440.99 → 4362.09 ms; complete measured draw remains 5130.18 → 5037.13 ms. This does not establish a material benefit or justify a production full-page strategy. The small timing difference is not an isolated reproducible speedup.

## Explicit gl.finish around each operation

[Fence evidence](9de6820-fenced/comparison.json) returns to original dirty-layer uploads and inserts native `gl.finish` before and after every `texSubImage3D` and `generateMipmap`. Complete draw averages 5057.21 ms; upload call time still averages 4375.90 ms. Upload-before/after waits total 1.60 / 3.47 ms per frame, and mip-before/after waits total 0.15 / 0.108 ms. These waits did not move seconds of blocking to a different recorded call site. Inputs and final RGBA again match exactly.

This observation does **not** prove that mipmaps or draw execution are cheap, and does not prove that Chrome's finish implementation is a no-op. These API-call measurements cannot independently establish GPU completion or causal attribution. A WebGL2 sync-object completion experiment is the next check.

## A precise threshold, not a uniformly expensive upload

[Per-call analysis](9de6820-fenced/upload-threshold-analysis.json) finds exactly one upload over 100 ms in every measured frame. In all twelve frames that slow call ends at **16777216 cumulative submitted bytes (16MiB)** for that frame. Eleven calls upload 524288 bytes after 16252928 prior bytes; one uploads 1048576 after 15728640. Each single call blocks 2.29–4.98 seconds; most other uploads complete below timer resolution or in fractions of a millisecond.

Mipmap-delimited upload groups approximate texture/page batches. Only two of twelve slow calls are the group's first upload; ten are the second through seventh upload in their group. The slow group ordinal varies from 2 to 6. This contradicts a simple “every page's first upload is slow” explanation. It strongly suggests a threshold-triggered transfer/command synchronization effect, but the backend mechanism is unproven. Texture IDs and independent width/height were not recorded; upload byte size alone cannot distinguish 512×256 from 256×512 or establish prior-frame draw ownership. These missing facts must not be invented.

Next diagnostic: fenceSync + flush + asynchronous clientWaitSync(0 timeout) after each renderer return. Record CPU submission, completion-tail wall time and signaled status separately, while preserving quality and all inputs. If the tail absorbs the delay, split card preparation, real texture initialization and real scene rendering with completion waits to identify upload/mipmap work versus draw work. Neither experiment changes production behavior or constitutes a product optimization.

## Verified GPU completion corrects the earlier interpretation

[Sync-object completion](9de6820-completion/comparison.json) places `fenceSync`, `flush`, and asynchronous `clientWaitSync(sync,0,0)` after every renderer return. All twelve measured frames signal successfully. Mean CPU submission is **742.54 ms**, with **5266.08 ms** completion-tail wall wait and **6008.72 ms** total. Mean time inside upload calls falls from 4440.99 to **43.22 ms** once the preceding frame is completed before beginning the next. This supports previous-frame GPU backpressure as the source of the long upload-call stall; it does not attribute that delay to copying 16 MiB. The asynchronous wait includes timer scheduling and is a completion upper bound, **not pure GPU duration**.

[Separated stages](9de6820-split/comparison.json) defers the real renderer, calls `renderer.initTexture` for dirty pages and waits for completion, then executes the original renderer and waits again. Mean CPU card/scene preparation is **676.79 ms**. Texture initialization submits in **43.82 ms** and waits **4680.83 ms**; real rendering submits in **2.52 ms** and waits **585.57 ms**. Total is **5989.63 ms**. Both runs preserve replay inputs (excluding simulation timing samples), visibility, modes, cache state, all final-art coverage, and final decoded RGBA exactly. No production code changes.

The dominant completion stage is therefore **texture upload plus mipmap execution**, with substantial actual draw cost remaining. This experiment does not yet separate upload execution from mipmap execution. Near-zero JavaScript duration of `generateMipmap` did not imply cheap GPU work. Serialization and profiler overhead mean these are diagnostics, not new formal performance results.

Historical `fullDrawFenced` fields using only `gl.finish()` remain unmodified. They measure submission and driver-backpressure behavior in this environment, not independently verified full GPU completion. Formal before/after comparisons must rerun both sources with the same validated completion method; static small-duration workloads especially must account for polling overhead.

## One-pixel readPixels synchronization check

[Readback evidence](9de6820-readpixel/comparison.json) calls synchronous `readPixels(0,0,1,1,RGBA,UNSIGNED_BYTE,new Uint8Array(4))` after the unchanged real renderer, discards its pixel, then performs the same asynchronous sync-object verification. Twelve frames again pass all input/cache/coverage and decoded-RGBA checks. CPU submission averages **694.83 ms**, one-pixel readback **5216.19 ms**, and the subsequent completion wait **5.775 ms** (median **2.0 ms**, range **0.5–16.6 ms**). Full diagnostic wall averages **5917.06 ms**. All post-readback syncs signal; their observed polling/scheduling tail is negligible relative to five seconds, but is not zero.

This supports a one-pixel synchronous readback as a practical completion hook for this dynamic scene/environment, with the explicit cost of synchronization and readback included. It does not validate millisecond precision for static scenes: a 0.5–16.6 ms residual and browser scheduling can dominate their prior approximately 4 ms submission samples. No formal benchmark was changed, and these three instrumented runs are not a speedup comparison. Both baseline and optimized production sources must be measured anew under one chosen reliable method before claiming full-frame improvement.

Reproduction: from a detached worktree at `9de6820873367c06401cdfa4d8938aa17e78f199`, link the same dependencies, copy the selected run's `reproduce.mjs` to `scripts/art-profile-diagnostic.mjs` and `instrumentation.js` to `scripts/art-profile-instrumentation.js`, then run `node --import tsx scripts/art-profile-diagnostic.mjs OUTPUT --true-completion`, `--split-gl`, or `--read-pixel` respectively. Each run archives generated fixture/runner, transformed served source, source hashes, raw samples, screenshot and CDP profile. Production source is never modified on disk. The anchor-checked source transform intentionally fails on later renderer source, preventing accidental cross-version reuse.

## Upload and mipmap execution separated, full quality preserved

[Three-stage evidence](9de6820-split-mips/comparison.json) and [stage validation](9de6820-split-mips/stage-validation.json) retain the frozen 9de scene, four warmup and twelve measured frames. During `renderer.initTexture`, only `generateMipmap` is deferred. Each intercepted target must be a real `TEXTURE_2D_ARRAY` whose actual GL binding matches a current card page's renderer-owned texture; otherwise the run fails. Upload/allocation completes first. Deferred native mip operations then execute against those same objects in original order, saving and restoring the actual binding on the unchanged active unit without altering Three's binding cache. Mip completion is awaited before the original scene render. All requested mip operations execute, all bindings restore, and all three stages signal for every warmup and measured frame. No GL errors occur.

| Measured stage | Mean CPU submission | Mean subsequent completion wait |
| --- | ---: | ---: |
| Card/scene preparation | 693.525 ms | — |
| Texture allocation and layer upload | 58.250 ms | 6.683 ms |
| Native full-array mipmap generation | 0.067 ms | **4687.883 ms** |
| Original scene rendering | 2.692 ms | 568.842 ms |

Total diagnostic wall averages **6018.117 ms**. There are 45.667 dirty pages and 248 dirty layers per measured frame; uploads average 162,998,954.67 bytes. The table's waits are completion wall upper bounds including async polling, not isolated GPU timer-query durations. Deliberately altered submission ordering and barriers make this an attribution experiment, not a production optimization or formal before/after result.

Replay data (excluding measured simulation durations), visibility, animation modes, cache state, complete combat/projectile coverage, and final decoded RGBA are **all identical** to the original diagnostic. These checks support the conclusion that full-array mip generation is the dominant completion cost in this SwiftShader environment. Upload itself is much smaller after previous work is completed. This justifies investigating exact dirty-layer mip updates; it does not yet establish their pixel correctness, browser portability, or achievable product speedup. Actual scene rendering and CPU raster/readback costs also remain substantial.

Reproduce with the same frozen-worktree procedure above, using the `9de6820-split-mips/` archived launcher/helper and `--split-mips`. Raw frames, CDP profile, source manifest, generated fixture/runner, transformed source, screenshot and validation are retained independently of every prior experiment.
