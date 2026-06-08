# V3 Race-Aware AI And Frozen Production V2 Benchmark

This spec is the durable checkpoint for the next AI lane: freeze the last Alibaba production V2 as the benchmark opponent, build race-aware V3 policies, make Ember mechanically distinct from Grove, and prove V3 can beat the frozen production Grove V2 at scale.

GitHub issue: [#140 Build race-aware V3 AI against frozen production Grove V2](https://github.com/shuxueshuxue/sketch-rts/issues/140)

## Baseline

- Frozen production baseline: Alibaba `/opt/sketch-rts/.deployed-revision` was verified as commit `2521715` (`Stop disconnected lockstep rooms from background ticking`) on 2026-06-08.
- `v2-prod` means the AI behavior from that production revision.
- `v2-prod` is always Grove. It does not randomly select race and does not receive later catalog, policy, or behavior improvements.
- Current `main` after `2521715` contains the candidate improvements that should become V3, not a mutation of the frozen production baseline.

## Product Goal

Create race-aware V3 AI that can beat frozen production Grove V2 in a 100-game benchmark:

- 50 sampled rich-score maps.
- Both side directions for each map: V3 north / V2-prod south and V3 south / V2-prod north.
- V3 race is seed-randomized per side-balanced match from `grove | ember`.
- V2-prod race is fixed to `grove`.
- Required gate: V3 total win rate must be at least 90%.
- The report must also show win rates by V3 race and matchup. A passing total that hides a weak race is not enough evidence for race-aware V3 quality.

## Version Contract

The AI version surface should support:

- `v2-prod`: frozen production Grove V2 benchmark opponent.
- `v3`: race-aware public challenger version; routes by player race.
- `v3-grove`: Grove-specific V3 policy.
- `v3-ember`: Ember-specific V3 policy.

The game simulation must not fork. Static play, hosted play, SDK runs, and benchmark runs must keep using the same simulation and command-frame gameplay core. Version differences belong in AI policy/planner selection and benchmark setup, not in separate gameplay implementations.

## Ember Must Not Be A Reskin

Ember currently has separate unit and building names, but its support skills mostly reuse Grove primitives under Ember labels. V3 Ember must become mechanically distinct.

Required direction:

- Add a real Ember combat mechanic such as `scorch`.
- `scorch` should be represented as ordinary simulation state and world effects, not as an AI-only hidden score.
- Ember units should interact with `scorch` differently:
  - `sparkArcher` applies ranged burn pressure.
  - `emberRavager` and `cinderRunner` convert burn windows into melee chase or burst opportunities.
  - `ashHexer` should interact with burned targets instead of being only a renamed witch curse.
  - `pyreCaller` should create a pressure/summon behavior that is tactically different from Grove summoner.
- Ember raw unit cost efficiency must not simply exceed Grove analogues. Ember should win through timing, pressure, abilities, and AI control.
- UI labels/tooltips/effects should make the new mechanic visible to players.

## Benchmark CLI

Add a dedicated CLI with dry-run and execution modes, for example:

```bash
npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50 --workers 95
npm run benchmark:ai-v3-vs-prod-v2 -- --seed v3-prod-50-2026-06-08 --map-count 50 --dry-run
```

Dry-run output must include:

- seed;
- selected map ids;
- match count;
- every match name;
- each agent's team, race, AI version, and policy version;
- enough manifest detail to prove V2-prod is fixed Grove and only V3 race is randomized.

Execution output must include:

- total V3 wins, raw match count, and win rate;
- breakdown by V3 race;
- breakdown by matchup;
- side-balanced per-map results;
- elapsed time, CPU time, worker count, and host-qualified evidence.

Full 50-map/100-game benchmark runs belong on `pgl`. Local runs may only be dry-run, narrow unit tests, build checks, or small exact repros.

## Acceptance Evidence

Implementation is not complete until current evidence proves all of the following:

- Unit tests prove the AI planner/benchmark version contract accepts `v2-prod`, `v3`, `v3-grove`, and `v3-ember`, while the live script registry does not let `v2-prod` silently alias current V2.
- Dry-run tests prove V2-prod is Grove-only and V3 is seed-randomized across Grove/Ember.
- Simulation/catalog tests prove Ember's new mechanic is real shared game state, not AI-only bookkeeping.
- AI policy tests prove V3 Ember deliberately uses the mechanic in planning.
- UI/tooltip/effect tests prove players can see and understand the new Ember mechanic.
- Local `npm run build` passes.
- pgl benchmark evidence from the dedicated CLI shows at least 90/100 V3 wins against frozen production Grove V2.
- The pgl result reports seed, selected maps, worker count, wall time, CPU time, and the exact code revision used.

## Current Status

- `v2-prod` is no longer only a benchmark/version label. It dispatches through `src/ai/policy-v2prod/`, a vendored snapshot of the 2026-06-08 production policy subtree from commit `2521715`.
- The frozen policy snapshot shares the current gameplay/simulation/catalog core. This preserves one world implementation while freezing the Grove production AI brain.
- The live policy registry intentionally excludes `v2-prod`; direct live policy calls with `v2-prod` fail loudly. `v2-prod` must enter through planner context so benchmark/runtime paths use the frozen dispatch seam.
- Focused tests prove the frozen subtree cannot import live `src/ai/policy/**` modules.
- Dry-run manifests prove V2-prod is Grove-only and that V3 race selection is randomized.
- First pgl benchmark evidence from branch `codex/v3-race-ai` commit `a6ac35e`: seed `v3-frozen-50-2026-06-08`, 50 maps / 100 matches, workers `95`, wall time `14.82s`, CPU time `724378.129ms`, remote result file `/home/ubuntu/sketch-rts-v3-race-ai-bench/.benchmark-runs/v3-frozen-50-2026-06-08-20260608T024752Z.json`.
- That first result does not pass: V3 total `62/100`, Grove V3 `38/50`, Ember V3 `24/50`.
- Local TDD slice after that benchmark adds shared `scorch` simulation state: `sparkArcher` applies scorch, `emberRavager` and `cinderRunner` gain damage into scorched targets, `ashCurse` applies a harsher multiplier to scorched targets, tooltips/effects expose the mechanic, and the spell planner prefers scorched ash-curse targets.
- pgl stdout benchmark evidence from branch `codex/v3-race-ai` commit `4b90778`: seed `v3-frozen-50-2026-06-08`, 50 maps / 100 matches, workers `95`, wall time `14.94s`, CPU time `778932.628ms`. This result does not pass: V3 total `69/100`, Grove V3 `38/50`, Ember V3 `31/50`.
- A broad attempt to block controlled mercenary hires before the first expansion hall (`7c04d61`) was pgl-tested and reverted. It dropped the same seed to `48/100` and Grove V3 to `18/50`, so controlled mercenary conversion is not safe to suppress globally.
- Shared combat tech is now available from Ember Forge as well as Grove Barracks, but V3 Ember does not use Grove's early two-fighter weapon timing. pgl negative probe `b6f319f` showed that letting Ember take that early timing dropped the same seed to `58/100` (`ember 20/50`), so early Ember tech is a stopline.
- Routine first-healing-well spending before the first expansion bank was tightened: critical defenders can still force the first well, but ordinary wounded groups must pass the expansion reserve gates. pgl evidence from current head `57a84e4`: seed `v3-frozen-50-2026-06-08`, 50 maps / 100 matches, workers `95`, wall time `14.57s`, CPU time `717037.509ms`, V3 total `70/100`, Grove V3 `40/50`, Ember V3 `30/50`.
- A second-spark-Archer-before-support probe (`f7fcab6`) was pgl-tested and reverted. It dropped the same seed to `63/100` and Ember V3 to `23/50`, so forcing more early scorch density through cinder-spire training is not safe.
- An attack-wave yield probe for committed expansion-denial squads (`5476afd`) was pgl-tested and reverted. It fixed the local objective-thrash symptom but dropped the same seed to `62/100` (`Grove 36/50`, `Ember 26/50`), so global attack-wave suppression around enemy expansions is not safe.
- Repeated Ember production-plan slot probes (`51ee410`, then delayed by `be58fe4`) were pgl-tested and reverted. Counting repeated `emberForge` / `cinderSpire` slots at the 7-unit gate dropped the same seed to `69/100`; delaying repeated slots to 10 units dropped it further to `65/100` (`Ember 25/50`). The current economy/expansion timing cannot absorb extra Ember production-shell spending as a standalone fix.
- Routine first healing wells are now delayed while the natural is still creep-guarded unless there is real enemy pressure or a critical defender. pgl evidence from `7ab3af0`: seed `v3-frozen-50-2026-06-08`, 50 maps / 100 matches, workers `95`, wall time `13.77s`, CPU time `714185.42ms`, V3 total `71/100`, Grove V3 `41/50`, Ember V3 `30/50`.
- A first-healing-well main-anchor probe (`8a13ce0`) was pgl-tested and reverted. It improved the focused `runeMeadow v3 south` loss locally by keeping V3 to one moon well, raising unit training gold from `1385` to `1685`, and raising enemy kills from `9` to `15`, but the full same-seed benchmark dropped to `69/100` (`Grove 39/50`, `Ember 30/50`). Do not treat far-cluster first-well anchoring as an isolated fix without a stronger attack/defense follow-up.
- An Ember mobile-healing expansion-bank probe (`83a0042`) was pgl-tested and reverted. It skipped first shrine spending when an `emberAcolyte` was already present for critical natural wounds, but the same-seed benchmark stayed at `71/100` and Ember stayed `30/50`; the extra policy branch did not buy progress toward the gate.
- Remaining stoplines: continue raising V3 from `71/100` to at least `90/100` on pgl; next investigation should focus on Ember's 30/50 lane and the remaining Grove-side expansion/economy losses.

## Non-Goals

- Do not weaken frozen V2-prod to make V3 pass.
- Do not randomize V2-prod race.
- Do not create a second gameplay engine for frozen V2-prod.
- Do not tune only a combat-only AI. The improvement must transfer to normal melee games.
- Do not count local full benchmark evidence as acceptance evidence.
