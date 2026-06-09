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
