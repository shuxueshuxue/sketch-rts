# scripts/ 清理清单（附录）

由 `sketch scripts audit` 的雏形算出（2026-10-18，main 2707f388 之后）：一个脚本算"在用"，当且仅当它被 package.json、CI workflow、src/tools 引用，或被在用的脚本 import（传递闭包），或者它本身是 vitest 会跑的 `*.test.ts`，或者是本周还在用的工具。

- 保留：48 个
- 需要 owner 或父会话确认后删除（package.json 里还挂着、但对应的是早已结束的一次性对比）：18 个
- 建议直接删除（无人引用，git 历史里仍可找回）：281 个

## 需要确认（一次性 AI 对比评测，连同 package.json 里的脚本条目一起删）

- `ai-control-benchmark.test.ts`（最后修改 2026-10-05）
- `ai-control-benchmark.ts`（最后修改 2026-09-30）
- `ai-cross-race-benchmark.test.ts`（最后修改 2026-10-05）
- `ai-cross-race-benchmark.ts`（最后修改 2026-06-08）
- `ai-matrix.ts`（最后修改 2026-06-07）
- `ai-v3-vs-prod-v2-benchmark.test.ts`（最后修改 2026-10-05）
- `ai-v3-vs-prod-v2-benchmark.ts`（最后修改 2026-06-11）
- `ai-v4-tr-vs-v3-benchmark.test.ts`（最后修改 2026-10-05）
- `ai-v4-tr-vs-v3-benchmark.ts`（最后修改 2026-06-11）
- `ai-v5-economy-stress-benchmark.ts`（最后修改 2026-06-13）
- `ai-v5-vs-hybrid-benchmark.test.ts`（最后修改 2026-10-05）
- `ai-v5-vs-hybrid-benchmark.ts`（最后修改 2026-06-11）
- `ai-v6-gauntlet-benchmark.ts`（最后修改 2026-09-25）
- `ai-v7-gauntlet-benchmark.ts`（最后修改 2026-09-26）
- `ai-v8-gauntlet-benchmark.ts`（最后修改 2026-09-29）
- `ai-version-benchmark.test.ts`（最后修改 2026-10-05）
- `ai-version-benchmark.ts`（最后修改 2026-06-08）
- `sdk-ai-matrix.ts`（最后修改 2026-06-07）

## 建议直接删除，按前缀归组

### `art-card*`：116 个，最后修改 2026-10-13

`art-card-bank-battle-proof.mjs`, `art-card-bank-camera-fixture.js`, `art-card-bank-camera-proof.mjs`, `art-card-bank-compare.mjs`, `art-card-bank-final-performance.sh`, `art-card-bank-performance-summary.mjs`, `art-card-bank-variant.js`, `art-card-bank-viewport-metadata.js`, `art-card-bank-viewport-proof.mjs`, `art-card-batch-raw-audit.py`, `art-card-battle-archive.mjs`, `art-card-battle-diagnostic-archive.mjs`, `art-card-cache-diagnostic.ts`, `art-card-canvas-attribution-analyze.mjs`, `art-card-canvas-attribution-collector.js`, `art-card-canvas-attribution-proof.mjs`, `art-card-current-correctness-archive.py`, `art-card-current-correctness-compare.mjs`, `art-card-current-gl-trace-profiler.js`, `art-card-current-gl-trace-proof.mjs`, `art-card-current-trace-analyze.mjs`, `art-card-current-trace-profiler.js`, `art-card-current-trace-proof.mjs`, `art-card-latency-budget-evidence-archive.py`, `art-card-latency-evidence-archive.py`, `art-card-latency-formal-proof.mjs`, `art-card-latency-profiler.js`, `art-card-latency-proof.mjs`, `art-card-latency-trace-profiler.js`, `art-card-latency-trace-proof.mjs`, `art-card-latency-variant.js`, `art-card-mask-benchmark.ts`, `art-card-mask-browser-fixture.mjs`, `art-card-mask-browser-micro.README.md`, `art-card-mask-browser-micro.mjs`, `art-card-mask-formal-proof.mjs`, `art-card-mask-micro-shared.mjs`, `art-card-mip-camera-fixture.js`, `art-card-mip-camera-proof.mjs`, `art-card-mip-half-camera-proof-v2.mjs`, `art-card-mip-half-camera-proof.mjs`, `art-card-mip-half-formal-analyze-v2.py`, `art-card-mip-half-formal-analyze.py`, `art-card-mip-half-provider-v2.mjs`, `art-card-mip-half-provider.mjs`, `art-card-mip-half-viewport-proof-v2.mjs`, `art-card-mip-half-viewport-proof.mjs`, `art-card-pipeline-formal-proof.mjs`, `art-card-pipeline-selectors.csv`, `art-card-queue-bracket-analyze-v3.py`, `art-card-queue-bracket-analyze.py`, `art-card-queue-bracket-entry.js`, `art-card-queue-bracket-fixture.js`, `art-card-queue-bracket-profiler.js`, `art-card-queue-bracket-proof-v2.mjs`, `art-card-queue-bracket-proof-v3.mjs`, `art-card-queue-bracket-proof.mjs`, `art-card-queue-source-freeze-v2.mjs`, `art-card-queue-source-freeze.mjs`, `art-card-raster-codec-diagnostic.ts`, `art-card-rle-backoff-semantics.ts`, `art-card-rle-budget-formal-proof.mjs`, `art-card-rle-budget-only-formal-proof.mjs`, `art-card-rle-formal-proof.mjs`, `art-card-rle-twohit-budget-semantics.ts`, `art-card-rle-twohit-semantics.ts`, `art-card-stall-source-archive-v2.py`, `art-card-stall-source-archive.py`, `art-card-streaming-report.mjs`, `art-card-upload-chunk-mock.mjs`, `art-card-upload-chunk-mock.ts`, `art-card-upload-depth1-compare.mjs`, `art-card-upload-depth1-entry.js`, `art-card-upload-depth1-fixture.js`, `art-card-upload-depth1-formal-proof.mjs`, `art-card-upload-depth1-frame-compare.mjs`, `art-card-upload-depth1-observer.mjs`, `art-card-upload-depth1-proof.mjs`, `art-card-upload-depth1-source-freeze.mjs`, `art-card-upload-double-slot-formal-analyze.py`, `art-card-upload-formal-proof.mjs`, `art-card-upload-replay-entry-v2.js`, `art-card-upload-replay-entry-v4.js`, `art-card-upload-replay-entry.js`, `art-card-upload-replay-fixture-v2.js`, `art-card-upload-replay-fixture-v4.js`, `art-card-upload-replay-fixture.js`, `art-card-upload-replay-http-audit.mjs`, `art-card-upload-replay-observer-v2.mjs`, `art-card-upload-replay-observer-v4.mjs`, `art-card-upload-replay-observer.mjs`, `art-card-upload-replay-proof-v2.mjs`, `art-card-upload-replay-proof-v3.mjs`, `art-card-upload-replay-proof-v4.mjs`, `art-card-upload-replay-proof.mjs`, `art-card-upload-replay-runtime-scripts-v2.mjs`, `art-card-upload-replay-runtime-scripts.mjs`, `art-card-upload-replay-source-freeze-v2.mjs`, `art-card-upload-replay-source-freeze-v4.mjs`, `art-card-upload-replay-source-freeze.mjs`, `art-card-upload-ring512-formal-analyze.py`, `art-card-upload-ring512-formal-proof-v2.mjs`, `art-card-upload-ring512-gpu-fixture.js`, `art-card-upload-ring512-gpu-proof.mjs`, `art-card-upload-row-band-formal-analyze-v2.py`, `art-card-upload-row-band-formal-analyze.py`, `art-card-upload-row-band-formal-proof-v2.mjs`, `art-card-upload-row-band-formal-proof.mjs`, `art-card-upload-row-band-gpu-fixture.js`, `art-card-upload-row-band-gpu-proof.mjs`, `art-card-upload-row-band-mock-v2.mjs`, `art-card-upload-row-band-mock-v2.ts`, `art-card-upload-row-band-mock-v3.mjs`, `art-card-upload-row-band-mock-v3.ts`, `art-card-upload-row-band-mock.mjs`, `art-card-upload-row-band-mock.ts`

### `other*`：41 个，最后修改 2026-10-14

`ability-effects-review-scene.ts`, `ai-behavior-playtest.ts`, `ai-selfplay.ts`, `ai-v5-arena.ts`, `ai-version-gauntlet-selection.ts`, `army-scale-probe.ts`, `cold-planning-restore-browser.mjs`, `cold-planning-restore-fixture.js`, `combat-effects-fixture.ts`, `combat-effects-proof.mjs`, `deck-remains-fixture.ts`, `deck-remains-proof.mjs`, `export-ability-icons.mjs`, `guardian-scroll-area-proof.mjs`, `heavy-broadside-review.ts`, `homepage-audio-proof.mjs`, `island-ai-audit.ts`, `local-snapshot-benchmark.ts`, `naval-behavior-trace.ts`, `naval-selfplay.ts`, `painted-card-gpu-fixture.ts`, `painted-card-gpu-proof.mjs`, `projectile-socket-fixture.ts`, `projectile-socket-proof.mjs`, `record-corpse-review.ts`, `record-segments.ts`, `shared-unit-gameplay-proof.mjs`, `ship-combat-review-viewer.html`, `ship-combat-review-viewer.js`, `ship-navigation-review-viewer.html`, `ship-navigation-review-viewer.js`, `ship-navigation-review.ts`, `ship-wake-benchmark.ts`, `sim-perf-fixed-set.ts`, `sim-perf-games.ts`, `sim-scale-probe.ts`, `skirmish-audit.ts`, `standard-match-fingerprint.ts`, `trafalgar-runtime-compare.mts`, `traffic-sweep-equivalence.mjs`, `unit-sheet-proof.mjs`

### `art-viewport*`：15 个，最后修改 2026-10-13

`art-viewport-bank-canonical-fixture.js`, `art-viewport-bank-mixed-fixture.js`, `art-viewport-battle-archive.mjs`, `art-viewport-battle-order-proof.mjs`, `art-viewport-battle-proof.mjs`, `art-viewport-benchmark.mjs`, `art-viewport-card-order-diagnostic.js`, `art-viewport-card-trace.js`, `art-viewport-compare.mjs`, `art-viewport-diagnostic.js`, `art-viewport-fixture.js`, `art-viewport-order-observe-fixture.js`, `art-viewport-order-sort-fixture.js`, `art-viewport-streaming-fixture.js`, `art-viewport-streaming-trace.js`

### `art-spirit*`：8 个，最后修改 2026-10-13

`art-spirit-gameplay-compare-v2.mjs`, `art-spirit-gameplay-compare.mjs`, `art-spirit-gameplay-fixture.ts`, `art-spirit-gameplay-proof.mjs`, `art-spirit-no-blood-compare.mjs`, `art-spirit-no-blood-fixture.ts`, `art-spirit-no-blood-proof.mjs`, `art-spirit-review.ts`

### `art-creature*`：7 个，最后修改 2026-10-14

`art-creature-followup-review.ts`, `art-creature-gait-review.ts`, `art-creature-gameplay-fixture.ts`, `art-creature-gameplay-png-archive.py`, `art-creature-gameplay-proof.mjs`, `art-creature-review.ts`, `art-creature-world-fixture.ts`

### `art-replay*`：6 个，最后修改 2026-10-13

`art-replay-generation-input-archive.py`, `art-replay-generation-source-archive.py`, `art-replay-input-archive.py`, `art-replay-source-archive.py`, `art-replay-stage-input-archive.py`, `art-replay-stage-source-archive.py`

### `art-canvas*`：5 个，最后修改 2026-10-13

`art-canvas-benchmark.ts`, `art-canvas-route-identity-fixture-v2.js`, `art-canvas-route-identity-fixture.js`, `art-canvas-route-identity-proof-v2.mjs`, `art-canvas-route-identity-proof.mjs`

### `art-direction*`：4 个，最后修改 2026-10-12

`art-direction-motion.ts`, `art-direction-playback.ts`, `art-direction-review.ts`, `art-direction-world-fixture.ts`

### `art-mercenary*`：4 个，最后修改 2026-10-13

`art-mercenary-catalog.ts`, `art-mercenary-gameplay-compare.mjs`, `art-mercenary-gameplay-fixture.ts`, `art-mercenary-gameplay-proof.mjs`

### `art-guard*`：3 个，最后修改 2026-10-12

`art-guard-balance-review.ts`, `art-guard-blood-benchmark.ts`, `art-guard-blood-fixture.ts`

### `art-idle*`：3 个，最后修改 2026-10-13

`art-idle-browser-identity-fixture.js`, `art-idle-browser-identity-proof.mjs`, `art-idle-paint-identity-proof.ts`

### `art-minimap*`：3 个，最后修改 2026-10-13

`art-minimap-cache-main-fixture.js`, `art-minimap-cache-main-proof.mjs`, `art-minimap-cache-micro.ts`

### `art-naming*`：3 个，最后修改 2026-10-13

`art-naming-evidence-archive-v2.py`, `art-naming-evidence-archive.py`, `art-naming-gate-classify.py`

### `art-reset*`：3 个，最后修改 2026-10-12

`art-reset-stability-analyze.py`, `art-reset-stability-fixture.ts`, `art-reset-stability-proof.mjs`

### `art-stability*`：3 个，最后修改 2026-10-12

`art-stability-analyze.py`, `art-stability-fixture.ts`, `art-stability-proof.mjs`

### `card-mip*`：3 个，最后修改 2026-10-13

`card-mip-gpu-fixture.js`, `card-mip-tail-gpu-fixture.js`, `card-mip-tail-gpu-proof.mjs`

### `art-authored*`：2 个，最后修改 2026-10-12

`art-authored-baseline-review.ts`, `art-authored-motion-review.ts`

### `art-gpu*`：2 个，最后修改 2026-10-12

`art-gpu-completion.mjs`, `art-gpu-completion.test.mjs`

### `art-launch*`：2 个，最后修改 2026-10-14

`art-launch-menu-fixture.ts`, `art-launch-menu-proof.mjs`

### `art-native*`：2 个，最后修改 2026-10-13

`art-native-causal-feasibility.mjs`, `art-native-environment-audit.py`

### `art-profile*`：2 个，最后修改 2026-10-12

`art-profile-diagnostic.mjs`, `art-profile-instrumentation.js`

### `art-queue*`：2 个，最后修改 2026-10-13

`art-queue-input-archive.py`, `art-queue-source-archive.py`

### `art-raster*`：2 个，最后修改 2026-10-12

`art-raster-profile.mjs`, `art-raster-profile.ts`

### `card-bank*`：2 个，最后修改 2026-10-13

`card-bank-gpu-fixture.js`, `card-bank-gpu-proof.mjs`

### `card-context*`：2 个，最后修改 2026-10-12

`card-context-fixture.ts`, `card-context-proof.mjs`

### `card-grad*`：2 个，最后修改 2026-10-13

`card-grad-diagnostic-fixture.js`, `card-grad-diagnostic.mjs`

### `card-streaming*`：2 个，最后修改 2026-10-13

`card-streaming-gpu-fixture.js`, `card-streaming-gpu-proof.mjs`

### `render-naval*`：2 个，最后修改 2026-10-09

`render-naval-map-review.ts`, `render-naval-runtime-review.mjs`

### `render-painted*`：2 个，最后修改 2026-10-12

`render-painted-catalog.ts`, `render-painted-review.ts`

### `render-ship*`：2 个，最后修改 2026-10-09

`render-ship-combat-review.mjs`, `render-ship-navigation-review.mjs`

### `art-browser*`：1 个，最后修改 2026-10-12

`art-browser-benchmark.mjs`

### `art-cache*`：1 个，最后修改 2026-10-12

`art-cache-policy-replay.py`

### `art-carry*`：1 个，最后修改 2026-10-12

`art-carry-review.ts`

### `art-catalog*`：1 个，最后修改 2026-10-12

`art-catalog-review.ts`

### `art-compare.mjs*`：1 个，最后修改 2026-10-12

`art-compare.mjs`

### `art-death*`：1 个，最后修改 2026-10-12

`art-death-equipment-review.ts`

### `art-depth1*`：1 个，最后修改 2026-10-13

`art-depth1-evidence-archive.py`

### `art-domain*`：1 个，最后修改 2026-10-12

`art-domain-parity.ts`

### `art-dragon*`：1 个，最后修改 2026-10-14

`art-dragon-face-review.ts`

### `art-dynamic*`：1 个，最后修改 2026-10-12

`art-dynamic-fixture.js`

### `art-frontend*`：1 个，最后修改 2026-10-13

`art-frontend-sync-reuse-proof.mjs`

### `art-gameplay*`：1 个，最后修改 2026-10-17

`art-gameplay-proof.mjs`

### `art-head*`：1 个，最后修改 2026-10-12

`art-head-review.ts`

### `art-issued*`：1 个，最后修改 2026-10-12

`art-issued-item-review.ts`

### `art-obstacle*`：1 个，最后修改 2026-10-13

`art-obstacle-hit-index-proof.ts`

### `art-png*`：1 个，最后修改 2026-10-13

`art-png-evidence-archive.py`

### `art-release*`：1 个，最后修改 2026-10-14

`art-release-evidence-archive.py`

### `art-rig*`：1 个，最后修改 2026-10-12

`art-rig-review.ts`

### `art-shared*`：1 个，最后修改 2026-10-12

`art-shared-caster-review.ts`

### `art-story*`：1 个，最后修改 2026-10-12

`art-story-review.ts`

### `art-turtle*`：1 个，最后修改 2026-10-14

`art-turtle-review.ts`

### `render-animation*`：1 个，最后修改 2026-10-05

`render-animation-review.ts`

### `render-combat*`：1 个，最后修改 2026-10-05

`render-combat-refinement.ts`

### `render-corpse*`：1 个，最后修改 2026-10-05

`render-corpse-review.ts`

### `render-playtest*`：1 个，最后修改 2026-10-05

`render-playtest-review.ts`

### `render-presentation*`：1 个，最后修改 2026-10-06

`render-presentation-review.ts`

## 保留

`ai-matrix-manifest.test.ts`, `ai-playtest.test.ts`, `ai-playtest.ts`, `ai-room-gauntlet-benchmark.ts`, `ai-v9-gauntlet-benchmark.ts`, `ai-version-gauntlet-cli.test.ts`, `ai-version-gauntlet-runner-boundary.test.ts`, `ai-version-gauntlet-selection.test.ts`, `ai-version-gauntlet.ts`, `benchmark-cli.test.ts`, `benchmark-cli.ts`, `browser-runtime-benchmark.mjs`, `browser-runtime-fixture.js`, `build-navigation-masks.ts`, `build-server-bundle.ts`, `crash-inventory.ts`, `deploy-production.sh`, `e2e-brutal-spec.mjs`, `e2e-room-flow.mjs`, `global-session-boundary.test.ts`, `historical-naval-review.ts`, `hud-portrait-bounds.test.ts`, `mining-throughput.ts`, `mining-waiting-review.ts`, `naval-navigation-benchmark.ts`, `naval-runtime-stress.ts`, `neutral-balance.ts`, `painted-sprite-bounds.test.ts`, `production-client-bootstrap.test.ts`, `production-client-bootstrap.ts`, `production-deploy.test.ts`, `production-install.test.ts`, `production-revision.test.ts`, `resolve-production-revision.sh`, `room-sync-yatu.mjs`, `room-ui-flow.mjs`, `sdk-agent-15v15.ts`, `sdk-agent-driver-boundary.test.ts`, `sdk-agent-planner-boundary.test.ts`, `sdk-agent-player.ts`, `sdk-effect-proof.ts`, `sdk-savegame.ts`, `sdk-smoke.ts`, `ship-combat-review.ts`, `six-player-focused-instrumentation.ts`, `six-player-tick-probe.test.ts`, `six-player-tick-probe.ts`, `yatu-player-loop.mjs`
