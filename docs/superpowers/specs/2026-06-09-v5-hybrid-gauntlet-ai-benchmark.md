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
- Commit-level pgl dashboard baseline on committed revision `0f00ef1`: `v5-commit-0f00ef1-50-2026-06-09a`, run `2026-06-09T22-51-21-777Z-1ao6p2a`, workers `95`, wall time `21.92s`, CPU time `873605.222ms`, V5 total `52/100`.
- Commit-level breakdown:
  - V5 Grove: `27/50`; V5 Ember: `25/50`.
  - Against V3 Grove: `25/50`; against V3 Ember: `27/50`.
  - Opponent order `v3,v4-tr`: `32/51`; opponent order `v4-tr,v3`: `20/49`.
  - Zero-win maps: `copperWeald`, `frostMeadow`, `duskGrove`, `ochreRidge`, `chalkFen`, `amberReach`, `ashVale`, `tealFissure`, `russetBrook`, `bluebellHeath`, `reedBasin`.

### 2026-06-10 Veteran-Core Work

- Baseline after V3/V4 dashboard split reporting: seed `v5-current-veteran-book-50-2026-06-10a`, run `2026-06-10T19-43-05-012Z-142fpel`, workers `95`, V5 total `57/100`.
- Decoupling V5 worker pressure from the main 1v2 focus target raised the same seed to `58/100`, run `2026-06-10T19-50-41-656Z-142fpel`.
- Allowing safe stopped retreaters to rejoin a stolen-first-natural punish raised the same seed to `60/100`, run `2026-06-10T20-11-46-431Z-142fpel`.
- Failure aggregation from that `60/100` run showed a strong veteran signal: V5 wins averaged `7.42` weighted star value and `3.93` starred bodies, while V5 losses averaged only `0.55` weighted star value and `0.30` starred bodies; losing opponents averaged `5.88` weighted star value.
- V5-only near-star preservation was added: a unit within 16 XP of a star and at less than half health uses the same recovery path as established veterans. Same seed result: `62/100`, run `2026-06-10T20-19-06-867Z-142fpel`; after reverting a negative detachment experiment, the retained state reproduced `62/100` in run `2026-06-10T20-26-57-229Z-142fpel`.
- Negative experiment: excluding near-star/veteran core units from V5 worker-pressure detachments dropped the same seed to `55/100`, run `2026-06-10T20-24-34-872Z-142fpel`; this was reverted.
- Negative experiment: pausing V5 neutral objectives during first-expansion conversion dropped the same seed to `54/100`, run `2026-06-10T20-33-43-708Z-142fpel`; this was reverted. Exact `amberReach v5 north` looked like a bad mercenary-objective split, but the 50-map result showed objective tempo and item/XP access were still worth more than the extra home hold.
- V5-only experience-book objective priority was added after a RED test showed V5 preferred a nearer `stormStaff` camp over a slightly farther `experienceBook` camp. Same seed stayed flat at `62/100`, run `2026-06-10T20-38-41-676Z-142fpel`; keep this under cross-seed watch because it is strategically coherent but not yet a measured score gain.
- Fresh current-seed baseline for the next veteran-core pass: seed `v5-veteran-core-50-2026-06-10b`, run `2026-06-10T20-49-04-578Z-14ygrcy`, workers `95`, V5 total `59/100`. Split was V5 Grove `32/52`, V5 Ember `27/48`, against Grove V3 `29/50`, against Ember V3 `30/50`. Failure aggregation again showed final veteran survivorship as a strong signal: V5 wins averaged `6.93` star-value and `3.73` starred bodies, while losses averaged `0.02` star-value and `0.02` starred bodies; losing opponents averaged `6.34` star-value.
- Negative experiment: exact `quietMire v5 south` showed a `315s` V5 `workerPressure` command sending a 124xp veteran ravager-led group at a V4-TR worker while V3 and V4-TR armies were converging. A narrow V5 joint-army worker-pressure yield made that exact plan return no entries, but the same 50-map seed dropped from `59/100` to `56/100`, run `2026-06-10T21-01-01-866Z-14ygrcy`; this was reverted. Do not broadly suppress V5 worker pressure around veteran units without replacing the lost tempo.
- Negative experiment: the same exact `quietMire v5 south` showed a safe 90xp cinderRunner held out of the raid by a retreat claim, so a narrow worker-pressure retreater rejoin was tested. It made the exact `315s` plan include that unit, but the same 50-map seed dropped further to `55/100`, run `2026-06-10T21-07-19-502Z-14ygrcy`; this was reverted. Rejoining retreaters into workerPressure is not the right veteran-core lever by itself.
- V5 Ember wounded-core support slice: when a V5 Ember core already has multiple wounded fighters and no healer, `cinderSpire` trains `emberAcolyte` before the first `sparkArcher`; ordinary Ember first-spire behavior is unchanged. Same new baseline seed stayed at `59/100`, run `2026-06-10T21-14-25-152Z-14ygrcy`. The older veteran-book seed improved from the retained `62/100` to `63/100`, run `2026-06-10T21-15-14-142Z-142fpel`; split was V5 Grove `27/50`, V5 Ember `36/50`, so the next gap is Grove V5.
- Neutral experiment: raising V5 Grove's late `knight` target from 2 to 4 passed the local training-choice test but did not change either audited seed: `v5-current-veteran-book-50-2026-06-10a` stayed `63/100` in run `2026-06-10T21-18-24-179Z-142fpel`, and `v5-veteran-core-50-2026-06-10b` stayed `59/100` in run `2026-06-10T21-18-59-343Z-14ygrcy`; this was reverted as no measurable gain.
- V5 direct residual-building closeout slice: in dead-economy 1v2 closeouts with no enemy army, V5 now directly attacks a nearby residual building instead of only attack-moving to its point. This targets Grove timeout cases like `wispQuarry v5 north`, where V5 had a veteran core and enemy supply was gone but residual buildings survived to 2400s. The older veteran-book seed improved from `63/100` to `64/100`, run `2026-06-10T21-27-26-053Z-142fpel`; split was V5 Grove `28/50`, V5 Ember `36/50`. The newer baseline seed stayed `59/100`, run `2026-06-10T21-28-02-113Z-14ygrcy`.
- Neutral/reverted experiment: exact `runeMeadow v5 north` showed V5 local defenders stuck under retreat claims while a high-XP V4-TR mercenary hit the main. A narrow V5 small-base pickoff test and implementation made the exact planner attack that target, but the exact match got worse: loss moved from `481.05s` to `452.2s`, and V5 enemy kills dropped from `11` to `2`. The 50-map veteran-book seed stayed flat at `64/100` in run `2026-06-10T21-45-53-916Z-142fpel`, with Grove `+1` and Ember `-1`, so this was reverted. Do not add local XP-feed targeting without preserving the existing main-defense target priority.
- Negative experiment: exact `mossglassRun v5 south` showed V5 losing two level-2 units during worker-pressure and forward fights, then dying with no stars while V3 reached `16` star-value. A narrow V5 worker-pressure detachment chooser preserved veterans when three nearby low-XP units could still raid; it flipped that exact to a V5 win at `768.05s` with V5 `10` star-value. The 50-map veteran-book seed still dropped from `64/100` to `58/100` in run `2026-06-10T22-06-10-780Z-142fpel`, with Grove falling to `25/50` and Ember to `33/50`, so this was reverted. Do not optimize worker-pressure unit selection around XP alone; the raid tempo and local force geometry are carrying more value than the protected XP in aggregate.
- Negative experiment: V5 Grove exact snapshots showed mature Grove often has sanctum/workshop online but few or no priests/heavy units. A narrow V5 Grove "first priest for wounded veteran core" reserve bypass passed its RED test, but the 50-map veteran-book seed dropped from `64/100` to `59/100` in run `2026-06-10T22-19-33-690Z-142fpel`; Grove fell to `23/50` while Ember stayed `36/50`. This was reverted. Do not force first-priest spending solely from veteran presence; it disrupts broader Grove timing more than it preserves XP.
- Negative experiment: a runner-level V5 workerPressure integrity gate dropped a `workerPressure` attack command if earlier tactical scripts had already reserved any unit from that planned detachment. The RED test reproduced the opalFen-style symptom where `focusFire` left only one late footman in a workerPressure attack. The 50-map veteran-book seed dropped from retained `64/100` to `56/100` in run `2026-06-10T22-36-56-713Z-142fpel`; Grove fell to `26/50` and Ember to `30/50`. This was reverted. Do not make workerPressure all-or-nothing after command conflict filtering; partial raids still carry enough aggregate tempo that hard integrity loses more than it saves.
- V5 cleared-natural attack-wave threshold: after the first natural no longer needs clearing, V5 1v2 ordinary `attackWave` waits for a seven-unit wave even before the second base is actively mining. This keeps the first reusable core together without suppressing workerPressure, objectiveControl, or closeout paths. The veteran-book seed stayed flat at `64/100` in run `2026-06-10T22-45-21-394Z-142fpel` with Grove rising `28 -> 30` and Ember falling `36 -> 34`; the newer veteran-core seed improved from `59/100` to `61/100` in run `2026-06-10T22-46-08-166Z-14ygrcy`, with Grove `32 -> 33` and Ember `27 -> 28`. Keep for now under continued seed watch.
- V5 unmined-first-expansion direct-chase guard: exact `wispQuarry v5 north` showed `v5MainApproachDetachmentPickoff` and other direct-target attack-wave branches turning a melee target outside the first expansion defense into a deep chase before the second mine was active. The guard keeps direct focus for close/base targets and ranged attackers actively pressuring allied assets, but excludes off-line melee chase targets until V5 has two active mining bases. Same seed `v5-merc-bank-50-2026-06-10a` improved from retained `64/100` to `65/100`, run `2026-06-11T02-18-18-150Z-ovkyak`; flips were `+2/-1` with Grove `29/49 -> 30/49` and Ember `35/51 -> 35/51`.
- Fresh focused verification after the retained veteran-core slices: `npx vitest run src/ai/policy.test.ts src/ai/planner-context.test.ts src/ai/policy/production-model.test.ts src/ai/policy/tower-merc-policy.test.ts src/ai/policy/skirmish-tactics.test.ts src/ai/policy/item-tactics.test.ts src/ai/benchmark/control.test.ts scripts/ai-v3-vs-prod-v2-benchmark.test.ts scripts/ai-v4-tr-vs-v3-benchmark.test.ts scripts/ai-v5-vs-hybrid-benchmark.test.ts scripts/ai-playtest.test.ts && npm run build` passed with `460` tests.

## Non-Goals

- Do not close or regress the V3 and V4-TR gates while building V5.
- Do not add map-specific exemptions.
- Do not introduce a second gameplay implementation.
- Do not count local full benchmark evidence as acceptance evidence.
