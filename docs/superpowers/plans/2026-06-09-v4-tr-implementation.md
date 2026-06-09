# V4-TR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `v4-tr`, a constrained tower/worker/mercenary AI, plus a 50-map side-balanced benchmark against current V3 random race.

**Architecture:** Reuse the live planner, script runner, command-frame, simulation, benchmark runner, and dashboard store. `v4-tr` is a normal `AiScriptVersion` with its own script stack and policy branches; it must not fork gameplay rules or benchmark-only command execution.

**Tech Stack:** TypeScript, Vitest, existing SDK scene/test helpers, existing benchmark parallel runner, existing dashboard `run-contract-v2` store.

---

### Task 1: Version Contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/ai/policy/core.ts`
- Modify: `src/ai/planner-context.ts`
- Test: `src/ai/planner-context.test.ts`

- [x] Add `"v4-tr"` to `AiScriptVersion`.
- [x] Add an `AI_SCRIPT_VERSIONS["v4-tr"]` stack that excludes ordinary combat production scripts and keeps economy, construction recovery, repair, supply, defense, healing well, mercenary, expansion, items, worker defense, and limited closeout.
- [x] Keep `effectivePolicyVersion("v4-tr") === "v4-tr"` so policy code can distinguish it.
- [x] Test that `Object.keys(AI_SCRIPT_VERSIONS)` includes `v4-tr`, and that a probe script sees `options.version === "v4-tr"`.

### Task 2: No Ordinary Unit Production

**Files:**
- Modify: `src/ai/policy/production-model.ts`
- Modify: `src/ai/policy/core.ts`
- Test: `src/ai/policy/production-model.test.ts`
- Test: `src/ai/policy/training-choice.test.ts`

- [x] Add a small policy helper for tower/merc versions if the branch repeats more than twice.
- [x] Make `productionBuildingNeedKind(..., { version: "v4-tr" })` return `undefined`.
- [x] Make `planTraining` allow worker training from town halls but skip all non-worker train commands for `v4-tr`.
- [x] Test that V4-TR does not ask for barracks/range/stables/sanctum/ember production buildings.
- [x] Test that V4-TR still trains workers and never trains footman/archer/ember combat units from ordinary production buildings.

### Task 3: Tower And Mercenary Priority

**Files:**
- Modify: `src/ai/policy/base-defense-model.ts`
- Modify: `src/ai/policy/core.ts`
- Test: `src/ai/policy/base-defense-model.test.ts`
- Test: add `src/ai/policy/tower-merc-policy.test.ts` if existing files get noisy.

- [x] Let V4-TR request a main guard tower without requiring core production.
- [x] Let V4-TR build expansion towers more aggressively, with a higher tower cap tied to town halls.
- [x] Let V4-TR move workers to safe cleared mercenary camps when no combat squad exists, but avoid guarded camps until hired mercenaries exist.
- [x] Test tower build command from an early one-base V4-TR scene.
- [x] Test repair command on a damaged tower.
- [x] Test hire command when a worker/merc controls a cleared mercenary camp.

### Task 4: V4 Benchmark CLI

**Files:**
- Modify: `src/ai/benchmark/control.ts`
- Add: `scripts/ai-v4-tr-vs-v3-benchmark.ts`
- Add: `scripts/ai-v4-tr-vs-v3-benchmark.test.ts`
- Modify: `package.json`

- [x] Add `createAiV4TrVsV3BenchmarkInput`.
- [x] Generate two matches per selected map: `v4-tr north` and `v4-tr south`.
- [x] Set challenger agent to `version: "v4-tr"`, `policyVersion: "v4-tr"`, race fixed to Grove for the first implementation.
- [x] Set opponent to `version: "v3"`, `policyVersion: "v3-grove" | "v3-ember"` based on seed-randomized race.
- [x] Add normal, dry-run, details, and `--dashboard` CLI modes.
- [x] Test dry-run manifest proves side balance, fixed V4-TR, and randomized V3 race.
- [x] Test dashboard mode writes `ai-specialized-benchmark` with `targetPlayerId: "v4-tr"`.

### Task 5: Verification Loop

**Files:**
- Use modified files above.

- [x] Run focused tests for planner context, production model, training choice, tower/merc policy, and V4 CLI.
- [x] Run `npm run build`.
- [x] Run small V4 benchmark on pgl: `npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-smoke --map-count 2 --workers 4 --dashboard`.
- [x] Inspect dashboard at `http://100.115.145.109:5197/benchmark.html` and confirm the V4 run appears.
- [x] Only after smoke passes, run the 50-map/100-game pgl benchmark and iterate policy toward 90/100.
