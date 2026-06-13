# V4-TR Tower/Mercenary AI Benchmark

This spec is the durable checkpoint for the next AI lane after race-aware V3: build a constrained V4 tower-rush/control AI that can beat current V3 random-race AI at scale without using ordinary combat-unit production.

GitHub issue: [#146 Build constrained V4-TR tower and mercenary AI against V3 random race](https://github.com/shuxueshuxue/sketch-rts/issues/146)

## Product Goal

Create `v4-tr`, a specialized AI version that wins through workers, buildings, defense towers, repairs, expansion control, and neutral mercenaries.

Required benchmark gate:

- 50 sampled rich-score maps.
- Both side directions for each map: V4-TR north / V3 south and V4-TR south / V3 north.
- V4-TR is fixed to a single implementation lane unless a later spec explicitly adds race-specific TR variants.
- V3 opponent uses current race-aware V3 policy.
- V3 opponent race is seed-randomized per side-balanced match from `grove | ember`.
- Required gate: V4-TR total win rate must be at least 90/100.
- Full 100-game benchmark evidence must be run on pgl.

## V4-TR Constraint

V4-TR may use:

- workers;
- town halls and ordinary economy buildings;
- defense towers;
- healing buildings when they support worker/tower survival;
- repair;
- expansion buildings;
- neutral mercenary hires.

V4-TR must not use:

- ordinary trained combat units such as footmen, archers, lancers, spark archers, ravagers, runners, acolytes, priests, witches, summoners, knights, or equivalent race-unit production;
- combat-only benchmark rules;
- separate gameplay or simulation code.

The restriction belongs in AI planning and benchmark verification, not in a forked simulation rule. The same command-frame and simulation core must run V4-TR, V3, hosted play, static play, SDK runs, and benchmark runs.

## Strategy Shape

The first implementation should be minimal and inspectable:

- Worker opening:
  - keep enough workers mining to fund towers and repairs;
  - keep a builder/repair worker budget distinct from mine saturation;
  - use workers defensively when towers are incomplete or under attack.
- Tower plan:
  - secure main and natural first;
  - expand behind tower cover;
  - build forward towers only when workers can survive the trip and the target zone is useful;
  - repair damaged towers before spending the same frame on lower-value structures.
- Mercenary plan:
  - claim safe nearby camps early;
  - hire combat mercenaries as the primary mobile army substitute;
  - avoid sending the whole worker line to camp objectives.
- Attack/closeout:
  - do not perform ordinary army attack waves;
  - use mercenary squads and tower-covered worker pushes to kill expansions and production;
  - stop base trades that sacrifice the tower economy for low-value building damage.

## Version Contract

The AI version surface should support:

- `v3`: current race-aware Grove/Ember opponent.
- `v3-grove`: Grove-specific V3 policy.
- `v3-ember`: Ember-specific V3 policy.
- `v4-tr`: constrained tower/worker/mercenary challenger.

`v4-tr` must be invocable through the same planner/runtime path as other AI versions. It may use version-specific policy modules, but not a separate benchmark-only command path.

## Benchmark CLI

Add a dedicated CLI:

```bash
npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50 --workers 95
npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50 --workers 95 --dashboard
npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50 --dry-run
npm run benchmark:ai-v4-tr-vs-v3 -- --seed v4-tr-50-2026-06-09 --map-count 50 --match "cobaltVale v4-tr north" --details
```

Dry-run output must include:

- seed;
- selected map ids;
- match count;
- every match name;
- each agent's team, race, AI version, and policy version;
- enough manifest detail to prove V4-TR is fixed to `v4-tr` and V3 race is randomized.

Execution output must include:

- total V4-TR wins, raw match count, and win rate;
- breakdown by V3 race;
- side-balanced per-map results;
- elapsed time, CPU time, worker count, and code revision evidence.

Dashboard execution output must write the full run through the shared `run-contract-v2` dashboard store as an `ai-specialized-benchmark` with `targetPlayerId: "v4-tr"` and print only a compact run summary.

## Acceptance Evidence

Implementation is not complete until current evidence proves all of the following:

- Unit tests prove the planner/version contract accepts `v4-tr`.
- Dry-run tests prove V4-TR versus V3 creates 50-map side-balanced matches and randomizes only V3 race.
- Policy tests prove `v4-tr` does not issue ordinary combat-unit training commands.
- Policy tests prove `v4-tr` can build towers, repair damaged towers, expand, and hire mercenaries through the shared command planner.
- Benchmark details or tracker tests prove V4-TR does not train ordinary combat units during benchmark execution.
- Local `npm run build` passes.
- pgl benchmark evidence from the dedicated CLI shows at least 90/100 V4-TR wins against V3 random race.
- The pgl result reports seed, selected maps, worker count, wall time, CPU time, and exact code revision.

## Non-Goals

- Do not weaken V3 to make V4-TR pass.
- Do not create a combat-only V4-TR benchmark.
- Do not fork simulation or command-frame logic.
- Do not hide forbidden combat units with labels or alternate wrappers.
- Do not treat local full benchmark evidence as acceptance evidence.

## Current Status

- `v4-tr` exists as a normal `AiScriptVersion` and uses the shared planner/runtime path. Its script stack keeps economy, recovery, repair, supply, defense, healing well, mercenary, expansion, item/ability, skirmish, focus, objective, worker-defense, closeout, and attack-wave planning, while ordinary combat production is blocked in policy.
- Focused policy tests cover the core constraint and strategy surface: V4-TR does not train ordinary combat units, still trains workers, builds/repairs towers, builds healing support, expands, claims/hires mercenaries, and performs tower/worker/mercenary closeout through shared planner commands.
- The dedicated benchmark CLI exists as `npm run benchmark:ai-v4-tr-vs-v3`. Dry-run and dashboard tests prove side-balanced 50-map setup, fixed V4-TR challenger, randomized V3 race, and dashboard writes with `targetPlayerId: "v4-tr"`.
- TDD slice on 2026-06-09 fixed a real overextension bug: `towerMercWorkerOnlyPickoff` was intended as late worker-only cleanup, but without a tick gate it could pull the first mercenary squad into early worker harassment and lose the opening army. It is now restricted to late worker cleanup while retaining a positive late cleanup test.
- Current pgl dashboard evidence from branch `codex/v4-tr-benchmark` on 2026-06-09 shows the V4-TR gate passes across three 50-map / 100-match seeds using the dedicated CLI and dashboard store:
  - `v4-tr-50-2026-06-09a`: run `2026-06-09T05-55-12-257Z-1qcz9s3`, workers `32`, wall time `12.51s`, CPU time `382773.523ms`, V4-TR total `96/100`.
  - `v4-tr-50-2026-06-09b`: run `2026-06-09T05-56-15-895Z-1qmyvh2`, workers `32`, wall time `13.64s`, CPU time `383679.593ms`, V4-TR total `96/100`.
  - `v4-tr-50-2026-06-09c`: run `2026-06-09T05-58-58-485Z-1qwyh61`, workers `32`, wall time `15.30s`, CPU time `396748.528ms`, V4-TR total `97/100`.
  - `v4-tr-50-2026-06-09d`: run `2026-06-09T06-13-59-609Z-1r6y2v0`, workers `32`, wall time `15.26s`, CPU time `407181.012ms`, V4-TR total `96/100`.
- Current pgl dashboard audit after the V3 enemy-side mercenary objective fix confirms V4-TR still passes against the stronger current V3 opponent:
  - `v4-tr-current-audit-50-2026-06-09`: run `2026-06-09T20-40-50-144Z-1g49kn2`, workers `95`, wall time `19.71s`, CPU time `563550.393ms`, V4-TR total `94/100`.
  - `v4-tr-current-audit-50-2026-06-09b`: run `2026-06-09T20-40-50-080Z-13ncqxg`, workers `95`, wall time `19.68s`, CPU time `591959.732ms`, V4-TR total `92/100`.
  - `v4-tr-current-audit-50-2026-06-09c`: run `2026-06-09T20-45-20-385Z-13xccmf`, workers `95`, wall time `32.19s`, CPU time `595954.745ms`, V4-TR total `92/100`.
  - `v4-tr-current-audit-50-2026-06-09d`: run `2026-06-09T20-45-21-495Z-133djji`, workers `95`, wall time `30.49s`, CPU time `612892.311ms`, V4-TR total `91/100`.
- Enemy-base skirmish split on 2026-06-09: V2/V3 now retreat from locally outmatched dives near a live enemy base, but V4-TR keeps the old enemy-base skip because tower/merc pressure loses value if skirmish preservation pulls the merc squad home. A focused regression test first proved the broken V4 behavior by showing a live-base tower/merc squad was being assigned an `attackMove` back to its main; the kept implementation makes that command list empty for V4-TR while preserving the V3 retreat test.
- Current pgl dashboard evidence after the enemy-base skirmish split, from branch `codex/v4-tr-benchmark` local worktree with workers `95`, confirms V4-TR still meets the gate against current V3:
  - `v4-tr-current-audit-50-2026-06-09d`: run `2026-06-09T21-54-01-520Z-133djji`, wall time `27.02s`, CPU time `614331.604ms`, V4-TR total `90/100`.
- Late-closeout reliability slice on 2026-06-09: exact `glassmereFord v4-tr north` from seed `v4-tr-current-audit-50-2026-06-09b` timed out with V4-TR on two bases, huge bank, five merc/medic combat, and no plan because enemy buildings were outside the 2200 siege-tower anchor radius while route-blocking correctly prevented a weak mercenary attack wave. `planTowerMercForwardTower` now lets late two-base/high-bank V4-TR use existing town halls/towers as anchors for distant guarded mercenary-camp tower steps, with the same worker route-block check. The exact replay changed from 2400s timeout to V4-TR win at 989.75s.
- Residual melee closeout slice on 2026-06-09: follow-up pgl evidence showed the broader forward tower step fixed `marbleGrove`, `glassmereFord`, and `bluebellHeath`, but exposed `ashVale`, `copperWeald`, and `pearlBog` timeouts where enemy economy was dead and one healthy normal melee residual made `workerPressureCloseout` return no command. V4-TR now uses a tightly gated worker swarm only when the enemy has one residual combat unit, at most two buildings, at least ten healthy V4 workers are available, and the target is not a high-level melee carry. Exact replays of those three new failures now end in V4-TR wins.
- Current pgl dashboard evidence after late-closeout reliability fixes, from branch `codex/v4-tr-benchmark` local worktree with workers `95`, confirms V4-TR clears the 90/100 gate across the audited 50-map / 100-match seeds:
  - `v4-tr-current-audit-50-2026-06-09b`: run `2026-06-09T22-17-44-852Z-13ncqxg`, wall time `13.41s`, CPU time `600338.751ms`, V4-TR total `91/100`.
  - `v4-tr-current-audit-50-2026-06-09c`: run `2026-06-09T22-18-18-905Z-13xccmf`, wall time `12.91s`, CPU time `555639.444ms`, V4-TR total `94/100`.
  - `v4-tr-current-audit-50-2026-06-09d`: run `2026-06-09T22-18-31-996Z-133djji`, wall time `12.65s`, CPU time `585077.673ms`, V4-TR total `92/100`.
- Commit-level pgl dashboard evidence on committed revision `0f00ef1`: `v4-tr-commit-0f00ef1-50-2026-06-09a`, run `2026-06-09T22-50-41-943Z-1impcgi`, workers `95`, wall time `18.81s`, CPU time `597636.948ms`, V4-TR total `93/100`.
- Current pgl dashboard evidence on 2026-06-10 from branch `codex/v4-tr-benchmark`, head `9f8774a` plus local AI worktree changes: seed `v4-tr-current-audit-50-2026-06-10a`, run `2026-06-10T15-17-06-776Z-2k9qtf`, workers `95`, wall time `13.87s`, CPU time `553757.41ms`, V4-TR total `93/100`.
- Fresh local verification on 2026-06-10 for the same worktree: `npx vitest run src/ai/policy.test.ts src/ai/planner-context.test.ts src/ai/policy/production-model.test.ts src/ai/policy/tower-merc-policy.test.ts src/ai/policy/skirmish-tactics.test.ts src/ai/benchmark/control.test.ts scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts scripts/ai-playtest.test.ts` passed with `445/445`, and `npm run build` completed successfully.
- V3 veteran-core preservation was added on 2026-06-10, so the V4-TR gate was re-run against the changed current V3 opponent rather than relying on older V3 evidence.
- pgl dashboard evidence after V3 veteran-core preservation: seed `v4-tr-veteran-core-50-2026-06-10a`, run `2026-06-10T19-11-26-484Z-v8wdrz`, workers `95`, wall time `14.16s`, CPU time `562891.987ms`, V4-TR total `94/100`.
- Fresh focused verification after veteran-core preservation: `npx vitest run src/ai/policy.test.ts src/ai/planner-context.test.ts src/ai/policy/production-model.test.ts src/ai/policy/tower-merc-policy.test.ts src/ai/policy/skirmish-tactics.test.ts src/ai/benchmark/control.test.ts scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts scripts/ai-playtest.test.ts` passed with `447/447`, and `npm run build` completed successfully.
- Dashboard CLI report slice on 2026-06-10: `benchmark:ai-v4-tr-vs-v3 -- --dashboard` now prints `byV3Race`, so the compact dashboard stdout exposes whether V4-TR's score is stable against both Grove V3 and Ember V3 instead of only showing the total `primarySummary`.
- Report-layer verification for that slice: `npx vitest run scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts src/ai/benchmark/control.test.ts src/ai/benchmark/dashboard-store.test.ts` passed with `25/25`, and `npm run build` completed successfully. This was a CLI output/reporting change only; the latest pgl AI-behavior gate remains the veteran-core `94/100` run above.
- Dashboard store/API slice on 2026-06-10: specialized dashboard runs now derive `playerRaceSummaries` from `report.evaluations[].matches[].setup.players`, and both summary pages and run detail pages carry that field. The benchmark dashboard renders those player/race cells in the existing summary grid. Verification: `npx vitest run src/server/benchmark-dashboard-api.test.ts src/ai/benchmark/dashboard-store.test.ts src/benchmark-dashboard/view-model.test.ts src/benchmark-dashboard/main-template.test.ts src/benchmark-dashboard/page-size.test.ts src/benchmark-dashboard/warnings.test.ts` passed with `23/23`, and `npm run build` completed successfully.
- V3 veteran-book feed also affects V4-TR because item pickup uses the shared item-tactics module. pgl dashboard evidence after that slice: seed `v4-tr-veteran-book-50-2026-06-10a`, run `2026-06-10T19-40-48-365Z-1jfus3h`, workers `95`, wall time `13.95s`, CPU time `542366.346ms`, V4-TR total `93/100`; split was `49/50` against Grove V3 and `44/50` against Ember V3.
- Current pgl dashboard gates after the retained veteran-core and dashboard-reporting work:
  - `v4-tr-current-gate-50-2026-06-10b`: run `2026-06-10T20-45-34-986Z-1knyb2g`, workers `95`, wall time `12.81s`, CPU time `578773.351ms`, V4-TR total `90/100`; split was `49/50` against Grove V3 and `41/50` against Ember V3.
  - `v4-tr-current-gate-50-2026-06-10c`: run `2026-06-10T20-46-10-027Z-1kxxwrf`, workers `95`, wall time `12.96s`, CPU time `555880.731ms`, V4-TR total `93/100`; split was `48/50` against Grove V3 and `45/50` against Ember V3.
- Current pgl dashboard gate on 2026-06-11 from branch `codex/v4-tr-benchmark` after commit `cc421c3`:
  - `v4-tr-current-gate-50-2026-06-11a`: run `2026-06-11T10-43-16-528Z-1dqbe84`, workers `95`, wall time `12.20s`, CPU time `549395.972ms`, V4-TR total `94/100`; split `49/50` against Grove V3 and `45/50` against Ember V3.
  - `v4-tr-current-gate-50-2026-06-11b`: run `2026-06-11T10-44-54-878Z-1eka7b1`, workers `95`, wall time `11.82s`, CPU time `531335.746ms`, V4-TR total `97/100`; split `49/50` against Grove V3 and `48/50` against Ember V3.
  - `v4-tr-current-gate-50-2026-06-11c`: run `2026-06-11T10-45-08-011Z-1eaalm2`, workers `95`, wall time `12.55s`, CPU time `568956.44ms`, V4-TR total `94/100`; split `49/50` against Grove V3 and `45/50` against Ember V3.
- Active-goal pgl audit on 2026-06-11 from the current worktree:
  - `v4tr-goal-audit-50-2026-06-11a`: run `2026-06-11T16-40-49-754Z-u5bidz`, workers `95`, wall time `17.58s`, CPU time `560713.117ms`, V4-TR total `96/100`; split `50/50` against Grove V3 and `46/50` against Ember V3.
- Active-goal pgl audit on 2026-06-12 from current branch `codex/v4-tr-benchmark`, HEAD `2f7cff9` plus the local worktree:
  - `v4tr-goal-audit-50-2026-06-12a`: run `2026-06-12T07-24-47-747Z-pptje4`, workers `95`, wall time `12.15s`, CPU time `559842ms`, V4-TR total `96/100`; split `49/50` against Grove V3 and `47/50` against Ember V3.
- Fresh focused verification after the 2026-06-12 active-goal audit: `npx vitest run src/ai/policy.test.ts src/ai/planner-context.test.ts src/ai/policy/production-model.test.ts src/ai/policy/tower-merc-policy.test.ts src/ai/policy/skirmish-tactics.test.ts src/ai/policy/item-tactics.test.ts src/ai/benchmark/control.test.ts scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts scripts/ai-playtest.test.ts` passed with `471/471`, and `npm run build` completed successfully.
- Claim-scope regression audit on 2026-06-12: after restoring ordinary post-hire claim clearing for V2/V3 and keeping V5-only hire claim preservation, V4-TR still passes against the stronger current V3. Seed `v4tr-current-gate-50-2026-06-12b`, run `2026-06-12T13-03-13-405Z-mez4pn`, workers `95`, wall time `13.41s`, CPU time `540315.942ms`, V4-TR total `97/100`; split `50/50` against Grove V3 and `47/50` against Ember V3.
- Active-goal current-worktree pgl audit on 2026-06-12 after V5 economy-stress work began:
  - `v4-tr-goal-current-50-2026-06-12a`: workers `95`, wall time `12.30s`, CPU time `533541.916ms`, V4-TR total `95/100`; split `50/50` against Grove V3 and `45/50` against Ember V3.
  - `v4-tr-goal-current-50-2026-06-12b`: workers `95`, wall time `12.32s`, CPU time `542244.757ms`, V4-TR total `96/100`; split `49/50` against Grove V3 and `47/50` against Ember V3.
- Active-goal current-worktree pgl audit on 2026-06-12 after returning from V5 special-map work:
  - `v4-tr-goal-current-50-2026-06-12a`: dashboard run `2026-06-12T21-38-11-052Z-1yz1y2f`, workers `95`, wall time `12.56s`, CPU time `532637.601ms`, V4-TR total `95/100`; split `50/50` against Grove V3 and `45/50` against Ember V3.
- Remaining V4-TR stoplines are quality margin, not gate blockers. The next useful work is not broad retreat/preservation changes but specific Ember-loss and timeout clusters such as `thornedDelta`, `ochreRidge`, `lanternFord`, and `spruceCircuit`.
