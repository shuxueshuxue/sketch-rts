# V5 Hybrid Gauntlet AI Benchmark

This spec starts the next AI lane after both prerequisite gates pass:

- V3 race-aware AI beats frozen production Grove V2 at or above 90/100 on 50 rich-score maps.
- V4-TR tower/worker/mercenary AI beats V3 random race at or above 90/100 on 50 rich-score maps.

## Product Goal

Build `v5`, a general melee AI that can beat a two-opponent allied team made from the current strong lanes:

- opponent A: current V3 race-aware AI;
- opponent B: current V4-TR tower/worker/mercenary AI.

Required benchmark gate:

- 50 sampled rich-score maps.
- 100 total matches.
- V5 plays alone on one team.
- V3 and V4-TR play allied on the opposing team.
- Each benchmark match is a simultaneous 1v2 game. It is not a sequential gauntlet or wheel-war format.
- V5 race is seed-randomized from `grove | ember`.
- V3 race is seed-randomized from `grove | ember`.
- V4-TR remains fixed to its constrained tower/merc implementation.
- Spawn/team assignment and which opposing slot receives V3 versus V4-TR are seed-randomized but reported.
- Required pgl result: V5 wins at least 90/100.

## Constraints

V5 may use the full normal melee toolkit unless a later spec narrows it:

- workers, ordinary economy, expansions, and repairs;
- race production and tech;
- healing buildings and support units;
- neutral mercenaries and items;
- group tactics, harassment, and coordinated closeout.

V5 must not:

- weaken V3 or V4-TR to pass;
- use benchmark-only hidden resources, vision, unit stats, or special commands;
- fork simulation, command-frame, hosted play, static play, SDK execution, or benchmark execution;
- tune only a combat-only mode.

## Benchmark CLI

Add a dedicated CLI:

```bash
npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50 --workers 95
npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50 --workers 95 --dashboard
npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50 --dry-run
npm run benchmark:ai-v5-vs-hybrid -- --seed v5-hybrid-50-2026-06-09 --map-count 50 --match "cobaltVale v5 north" --details
```

Dry-run output must include:

- seed;
- selected map ids;
- match count;
- every match name;
- V5 side, race, AI version, and policy version;
- V3 side, race, AI version, and policy version;
- V4-TR side, race, AI version, and policy version;
- enough manifest detail to prove the two-opponent team is exactly `v3 + v4-tr`.
- enough manifest detail to prove V3 and V4-TR are in the same match on the same opposing team.

Execution output must include:

- total V5 wins, raw match count, and win rate;
- breakdown by V5 race;
- breakdown by V3 race;
- breakdown by opponent slot assignment;
- side-balanced per-map results;
- elapsed time, CPU time, worker count, seed, selected maps, and code revision evidence.

Dashboard execution output must write the full run through the shared `run-contract-v2` dashboard store as an `ai-specialized-benchmark` with `targetPlayerId: "v5"` and print only a compact run summary.

## Acceptance Evidence

Implementation is not complete until current evidence proves all of the following:

- Unit tests prove the planner/version contract accepts `v5`.
- Dry-run tests prove the hybrid benchmark creates 50-map / 100-match setup and reports V5, V3, and V4-TR versions explicitly.
- Benchmark tests prove V3 and V4-TR are allied opponents rather than separate evaluations.
- V5 policy tests prove it remains a normal melee AI, not a hidden anti-V3 or anti-V4-TR special case.
- Local `npm run build` passes.
- pgl benchmark evidence from the dedicated CLI shows at least 90/100 V5 wins against the hybrid `v3 + v4-tr` allied team.
- The pgl result reports seed, selected maps, worker count, wall time, CPU time, and exact code revision.

## Starting State

- V3 prerequisite evidence on 2026-06-09: five 50-map / 100-match pgl dashboard runs scored `90/100`, `93/100`, `91/100`, `91/100`, and `92/100` against frozen production Grove V2.
- V4-TR prerequisite evidence on 2026-06-09: four 50-map / 100-match pgl dashboard runs scored `96/100`, `96/100`, `97/100`, and `96/100` against V3 random race.
- The first V5 task is benchmark scaffolding and a baseline measurement. Do not tune V5 before the benchmark can prove the exact 1v2 setup.

## Current Evidence

- `2026-06-09T06-26-41-000Z-10nj074`, seed `v5-hybrid-50-2026-06-09a`, dashboard path `/home/ubuntu/sketch-rts-benchmark-main/.benchmark-dashboard`, current code revision `7daae6f` plus this worktree's uncommitted V5 scaffold.
- Result: `50/100` V5 wins over simultaneous allied `v3 + v4-tr`, below the required `90/100` gate.
- Race split: V5 Grove `21/50`, V5 Ember `29/50`; against V3 Grove `29/50`, against V3 Ember `21/50`.
- Runtime: `25,602.444 ms` wall, `716,192.229 ms` CPU.
- Zero-win side-balanced maps in this run: `ochreRidge`, `frostMeadow`, `pineTangle`, `lanternFord`, `cinderHeath`, `cobaltVale`, `hazelCircuit`, `mapleCircuit`, `verdigrisSpire`, `auricDelta`, `fernBarrow`, `plumTarn`.
- Focused verification after adding the V5 benchmark scaffold, opponent slot randomization, and summary reporting: `npx vitest run scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts scripts/ai-v5-vs-hybrid-benchmark.test.ts src/ai/policy.test.ts src/ai/planner-context.test.ts src/ai/policy/production-model.test.ts src/ai/policy/tower-merc-policy.test.ts src/ai/policy/skirmish-tactics.test.ts src/ai/benchmark/control.test.ts scripts/ai-playtest.test.ts && npm run build` passed with current focused coverage.

Interpretation:

- The benchmark now proves the requested same-match 1v2 setup.
- The current `v5` policy has early V5-specific economy/expansion/contested-natural slices, but it is still far below the hybrid 1v2 target.
- Next work must diagnose repeated V5 losses from exact match detail and change V5 behavior with tests before rerunning 50-map pgl benchmarks.

### 2026-06-09 Current Baseline

- Prerequisite gates before this baseline:
  - V3 vs frozen production V2 latest audit: `v3-frozen-current-audit-50-2026-06-09f`, run `2026-06-09T22-19-00-161Z-1uiid6l`, workers `95`, V3 total `95/100`.
  - V4-TR vs current V3 latest audits: `v4-tr-current-audit-50-2026-06-09b/c/d`, runs `2026-06-09T22-17-44-852Z-13ncqxg`, `2026-06-09T22-18-18-905Z-13xccmf`, and `2026-06-09T22-18-31-996Z-133djji`, workers `95`, V4-TR totals `91/100`, `94/100`, and `92/100`.
- V5 current hybrid baseline: `v5-hybrid-current-audit-50-2026-06-09a`, run `2026-06-09T22-22-16-423Z-1w3a4ra`, workers `95`, wall time `21.80s`, CPU time `878988.859ms`, V5 total `46/100`.
- Race split from that run:
  - V5 Grove vs V3 Ember: `7/24`.
  - V5 Grove vs V3 Grove: `10/26`.
  - V5 Ember vs V3 Grove: `20/24`.
  - V5 Ember vs V3 Ember: `9/26`.
- Zero-win maps in that run: `yarrowFen`, `cobaltVale`, `ironMoss`, `ochreRidge`, `reedBasin`, `russetBrook`, `obsidianBrook`, `bluebellHeath`, `tealFissure`, `lanternFord`, `plumTarn`, `briarToll`.
- Exact `yarrowFen v5 south` showed a fast Grove V5 loss: V5 expanded around 256s but had no durable tower/healing position when V3 Ember and V4-TR mercenary pressure converged, then died around 365s. A near-tower-gold reserve hypothesis was tested with a RED policy test and a temporary base-defense reserve helper, but the exact replay still lost at 357s; that hypothesis was reverted because it added complexity without flipping the real failure.
- Fresh verification after reverting that failed V5 hypothesis: `npx vitest run src/ai/policy.test.ts src/ai/policy/skirmish-tactics.test.ts src/ai/policy/tower-merc-policy.test.ts scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts scripts/ai-v5-vs-hybrid-benchmark.test.ts src/ai/benchmark/control.test.ts && npm run build` passed with `393` tests.
- Follow-up TDD coverage now verifies V4-TR exact benchmark replay flags are present in the playtest command manifest and V5 execution summaries include `byOpponentOrder` for the simultaneous `v3,v4-tr` versus `v4-tr,v3` opponent-slot split.

## Non-Goals

- Do not close or regress the V3 and V4-TR gates while building V5.
- Do not add map-specific exemptions.
- Do not introduce a second gameplay implementation.
- Do not count local full benchmark evidence as acceptance evidence.
