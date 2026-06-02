# AI Spec

This document is the durable spec for the built-in RTS AI, SDK benchmark loop, and AI debugging surface.

The target is not a clever one-off script. The target is an AI stack that can keep improving under benchmark pressure without corrupting the stable baseline. V1 should remain boring and stable. V2 can experiment, but the benchmark must keep it honest.

## Goals

- V2 must eventually pass the standard benchmark bundle at 100%.
- Every scored `1v2` map must include a same-map `1v1 score control`, so V2 cannot gain multi-enemy tricks while becoming unable to beat V1 on the same terrain.
- The stable map pool is 64 maps, selected for quality, manual design, testing coverage, and lower flakiness.
- Each regular benchmark run randomly samples 18 maps from the 64-map pool. A supplied seed may reproduce a run, but ordinary benchmark runs must not reuse a fixed seed. The 18 maps are allocated as 12 paired `1v2 score` / `1v1 score control` maps, 3 `1v3 probe` maps, and 3 `2v3 probe` maps. The target is 100% pass across all melee and combat evaluations.
- The 64-map pool must be normal 1v1-capable RTS terrain, not neutral-camp spam. A rich scoring map should have bounded neutral density: enough guarded mines, mercenary camps, green/orange/red rewards, and item routes to test objective control, but not so many free wild camps that 1v1 becomes a creep-economy minigame before player interaction.
- Benchmark evaluations must carry tags. The current macro-game benchmark tag is `melee`. A new `combat` tag covers small-map pure micro scenarios.
- Benchmark output must record real elapsed time and CPU time. CPU-heavy benchmark work and the dashboard should run on the PGL server.
- The benchmark/dashboard tooling is part of the game repository and SDK, but it is independent from the game frontend.
- The dashboard reads benchmark reports from a shared folder and auto-refreshes when reports change.

## Non-Goals

- Do not turn V1 into a moving target. V1 exists as a benchmark anchor.
- Do not hide bad results by filtering broken games out of the dashboard.
- Do not patch around SDK friction from the AI layer. If the SDK API is wrong, fix the SDK.
- Do not implement vague "recovery" heuristics that infer historical intent from current orders. Empty memory is just the start of new memory growth, not a special recovery mode.
- Do not let AI scripts bypass the SDK to express intent or parse low-level simulation state. If the SDK cannot express or read something the AI needs, improve the SDK and dogfood it.
- Do not add fallback, compatibility, or old-contract migration paths during this early development phase. There are no live players to protect yet. When a save/schema/command contract changes, update the current data and tests to the new contract and fail loudly on old shapes.

## Layering

The intended dependency direction is:

```text
benchmark package -> SDK -> simulation
AI package -> SDK -> simulation
dashboard -> benchmark report files
```

The simulation should stay deterministic and low-level. It should not know about benchmark policy, dashboard details, high-level AI jobs, or long-term AI memory.

The SDK is the reusable control surface. It owns game-loop orchestration, benchmark execution, composable trackers, report writing, snapshot query APIs, command/intent helpers, unit/base/objective selection, and command-frame plumbing.

The AI should be an independent upper package, not a `shared` module and not an SDK module. It owns logic, judgment, strategy, jobs, memory interpretation, and tactical choices. It dogfoods SDK snapshot queries, trackers, command helpers, and benchmark surfaces. SDK and shared modules must not re-export AI policy/runtime APIs; those are direct imports from `src/ai` by AI-aware consumers.

The benchmark package is a higher-level SDK package. It selects maps, runs match matrices, records reports/logs, and writes them into the shared benchmark folder.

The dashboard is a separate frontend debugger. It reads report files; benchmark jobs do not need to push data into it directly.

## Benchmark Tags

Benchmark reports classify evaluations with tags:

- `melee`: full RTS macro games on stable rich maps. This is the current standard benchmark family.
- `combat`: small-map mixed-army micro scenarios. These isolate combat control from economy, expansion, and long map routing.

Tags must be first-class report/dashboard data, not inferred from evaluation names.

`combat` is a benchmark pressure shape, not a separate AI identity. It must exercise the same composable tactical modules that regular `melee` games use: item use, spell use, focus fire, kiting, wounded pullback, target choice, memory claims, and attack-wave commitment. The scenario may parameterize the environment by removing economy and using combat-elimination victory, but it must not replace V2 with an isolated "combat-only AI" that cannot transfer back into real RTS games.

The initial `combat` targets are:

- `15v20 mixed combat`: V2 controls 15 units plus key item loadouts against V1 controlling 20 units.
- `10v12 mixed combat`: V2 controls 10 units plus key item loadouts against V1 controlling 12 units.

Each combat target runs 5 matches in every ordinary benchmark run, not 1. These are fixed pressure shapes inside the run, while the melee maps remain randomly sampled. The 5 combat matches must vary unit mix and positioning. The starting recipe set should cover:

- early mixed army
- late/heavy army
- ranged-heavy or caster-heavy army, including real spell users
- healer/frontline coordination
- ranged spread positioning
- late/heavy or high-star combat pressure

Combat setup rules:

- Use a very small map or scenario where both armies are near enough that the objective is clear.
- Both sides' objective is to eliminate all enemy combat units.
- V2 and V1 both receive combat-specific policy parameters. V1 must not stand still; it should attack-move or otherwise actively engage from the opening frame.
- Combat-specific policy parameters are scenario context, not a new script stack. V2 and V1 should keep using their normal versioned AI stack unless a future SDK composition API explicitly disables whole categories like economy for scenario setup while preserving the same tactical modules.
- V2 and V1 must use the same ordered unit-composition recipe in a given combat match. V1 has more bodies by continuing the same recipe, but not a different army identity. If the V2 recipe is ranged-heavy, V1 is also ranged-heavy; if V2 is caster-heavy, V1 is also caster-heavy.
- Include mixed unit composition and key item ratios. Both sides should have usable items where appropriate, including V1, and both sides' combat policy must be able to use those items. The point is micro quality: focus fire, kiting, wounded-unit pullback, item use, spell timing, and target choice.
- Combat evaluations are not a replacement for `melee`; they are a separate pressure lane that exposes micro failures faster.
- The first concrete combat map is `combatArena`: a real small map, not a 4096 map with close spawn positions pretending to be small.
- Dashboard reports keep melee summaries (`scoreSummary`, `scoreControlSummary`, `probeSummaries`) separate from `combatSummaries`.
- The benchmark pass gate includes combat summaries. A successful melee bundle with failing combat is still a failed benchmark.

## Project Structure

The root should stay simple. Richness belongs under focused subdirectories.

Target shape:

```text
src/
  ai/                  AI logic, strategy, jobs, memory interpretation
  sdk/                 reusable game-loop, snapshot-query, tracker, command, benchmark APIs
  shared/              simulation, catalog, map data, room/save/replay primitives
  client/              game UI split by controls/rendering/state modules
  server/              HTTP/WebSocket hosting and room orchestration
  benchmark-dashboard/ standalone benchmark debugger frontend
```

Rules:

- Do not create broad "god files". A file growing past roughly 800-1000 lines is a warning that it needs submodules.
- Prefer rich subtrees over root clutter. For example, grow `src/ai/jobs/*`, `src/ai/memory/*`, `src/sdk/snapshot/*`, `src/sdk/commands/*`, `src/sdk/benchmark/*`, and `src/client/*` modules instead of dumping everything into one file.
- File names should describe responsibility, not implementation accidents. `ai-runtime` inside SDK is a smell because snapshot parsing and command-frame plumbing are SDK concerns, while AI think scheduling and memory/job interpretation are AI concerns.
- Do not add bridge re-export files between SDK/shared and AI. Consumers that know about AI should import `src/ai` directly; consumers that do not know about AI should stay AI-free.
- Splitting must preserve behavior. Move code behind tests first, then change internals.
- Current large-file debt to pay down: split `src/ai/policy/core.ts` into policy modules/jobs, split `src/client/main.ts` into UI/render/input modules, and split `src/shared/sim.ts` into simulation subsystems.

## SDK Dogfooding

The built-in AI is a first-class SDK user. It should be written on top of SDK-level APIs, not by reaching around the SDK into low-level simulation details.

SDK responsibilities for AI:

- Select units, bases, resources, neutral camps, enemy groups, rally points, and other game objects through stable query APIs.
- Parse snapshots into queryable views: players, teams, bases, mines, armies, neutral camps, items, threats, income, spending, upgrades, and visible objectives.
- Provide command builders or intent helpers for common RTS actions: mine, build, train, research, move, attack-move, focus fire, hire, pickup/use item, retreat, expand, harass, and creep.
- Provide command-frame infrastructure: gather commands, arbitrate basic command conflicts, issue commands, and expose before/after hooks.
- Provide reusable trackers for benchmark reports and AI decisions, so the dashboard and policy inspect the same facts.
- Keep raw simulation structures available as the source-of-truth payload, but make ordinary AI logic dogfood SDK queries instead of ad hoc scanning.

AI responsibilities:

- Decide what matters, not how to enumerate every low-level object.
- Choose strategic intent, job transitions, priorities, and tactical commitments.
- Read and write AI memory as strategy state.
- Ask the SDK for views such as "my combat units", "nearest safe moon well", "enemy worker line", "neutral camps worth clearing", or "bases under threat".
- Emit SDK-level intents/commands, not hand-built low-level simulation mutations.

If an AI behavior needs information that only the simulation currently exposes, that is an SDK gap. Fix the SDK surface first, then implement the AI behavior through it. Do not let convenience imports from `shared` or low-level array scans become the AI architecture.

Warning smell: if AI code is personally selecting units by scanning raw `snapshot.units`, personally finding bases by scanning raw `snapshot.buildings`, or personally clustering neutral camps from raw units, the SDK surface is probably missing a primitive.

## AMAI Lessons To Borrow

AMAI is useful mainly because its AI is not a stateless pile of tick-local checks. The pieces to borrow are structural:

- A job queue with named long-running jobs, frequencies, and persistent parameters.
- Unit ownership by jobs. For example, units sent to buy neutral mercenaries are placed in a dedicated group and excluded from ordinary army tracking.
- Shared perception jobs. Army tracking, town tracking, strength updates, retreat state, and neutral control are computed once and reused.
- Strategy parameters that survive across ticks, instead of rediscovering every intention from scratch.
- Explicit retreat/flee state that can end cleanly when the army returns home or a condition changes.
- Neutral/mercenary handling as a task with timeout, assigned unit, enemy interruption checks, and cleanup.

Useful AMAI reference points:

- `/Users/lexicalmathical/share/ops/refs/AMAI/Jobs.txt`
- `/Users/lexicalmathical/share/ops/refs/AMAI/Jobs/BUY_NEUTRAL.eai`
- `/Users/lexicalmathical/share/ops/refs/AMAI/Jobs/ARMY_TRACK.eai`
- `/Users/lexicalmathical/share/ops/refs/AMAI/Jobs/RETREAT_CONTROL.eai`
- `/Users/lexicalmathical/share/ops/refs/AMAI/TFT/Elf/Strategy.txt`
- `/Users/lexicalmathical/share/ops/refs/AMAI/TFT/Elf/Settings.txt`

We should not copy AMAI's scripting style. We should copy the idea that long-running intent, unit assignment, and shared perception are first-class state.

## AI Runtime State

The AI receives a fresh game snapshot every think frame. In addition, it should always receive a companion state object. The companion state object is pluggable at the SDK boundary, but normalized before policy code runs.

```ts
type AiPolicyMemory = {
  jobs: AiJobState[];
  unitClaims: Record<string, AiUnitClaim>;
  strategicPlan?: AiStrategicPlan;
  perception?: AiSharedPerception;
};
```

This object is dynamically pluggable from outside, but mandatory inside the policy:

- Scripts can always read and write memory.
- If the caller supplies an existing memory object, scripts continue from that memory.
- If the caller supplies a new empty memory object, scripts start from empty state and naturally write new long-running state from current decisions.
- If the caller supplies no memory pointer, the SDK creates a new empty memory object before invoking policy code.
- Swapping or clearing memory does not create a "lost memory" branch. The policy simply sees the memory it was given and continues.
- There is no historical recovery mode. Memory must not guess hidden history from current orders.

Memory records explicit AI decisions only. For example, if the mercenary job assigns `unit-a` to `camp-3`, that claim can be stored. If memory was just replaced with an empty object and `unit-a` happens to be attack-moving near `camp-3`, that is not proof that the unit was assigned to the mercenary job. The current-frame policy may still choose the nearest useful unit for a camp again; that new decision then becomes new memory.

The SDK/runtime can own one memory object per controlled player, but that ownership is an adapter choice. A test, benchmark, or custom SDK loop may pass an existing memory, a fresh empty memory, or no external memory pointer. The simulation does not own it.

The SDK API should expose this as a pluggable state provider, not as a hidden singleton. The provider boundary may return `undefined`, but the SDK must normalize that to a created empty memory before policy execution:

```ts
type AiMemoryProvider = {
  get(owner: PlayerId): AiPolicyMemory | undefined;
  set?(owner: PlayerId, memory: AiPolicyMemory): void;
};
```

An SDK loop can use an ephemeral in-memory provider for ordinary benchmarks, a durable provider for long-running experiments, or no external provider at all. In all cases, policy code receives a real `AiPolicyMemory` object.

## Neutral Aggro

Neutral aggro is a simulation contract, not an AI workaround.

The model needs two separate ranges:

- acquisition range: neutral units automatically notice nearby enemies during ordinary idle/leash behavior;
- assist/call-for-help range: when a neutral unit is damaged, nearby allied neutral units join the fight even if the attacker is outside their ordinary acquisition range.

Damage-triggered aggro must handle the archer case: if an archer attacks a neutral from outside ordinary neutral acquisition range, the damaged neutral must aggro and call nearby neutral allies. Nearby camp allies should not stand beside the fight doing nothing merely because they did not personally acquire the archer.

Assist must be stable. Being attacked can create or refresh a target/assist state, but the camp must not retarget on every damage tick in a way that causes units to twitch between targets. A neutral should keep its current valid target for a short commitment window unless the target dies, leaves leash bounds, or a stronger explicit rule invalidates the target.

Leash still matters. Called allies should help inside the camp's defendable area, then return home once the fight is over or the target leaves the leash. Assist should make camps coherent, not turn one arrow into permanent map-wide pursuit.

## Static Defense, Tech, And Repair

Static defense is a simulation balance contract, not an AI excuse to ignore worker-line threats. A guarded main should still need army response, but a completed tower near the worker line should make one-ranged-unit harassment expensive instead of free.

Defense tower target shape:

- Towers should have longer range than ordinary ranged units, including mercenary archers, so they can protect the worker line by position instead of being outranged.
- Tower attack should be materially stronger than the current soft-warning-post model, but not become an army replacement.
- Tower hit points may be slightly lower if attack is raised. Balance should compare value by cost, effective hit points, attack, range, immobility, build time, and repairability.
- A reasonable target is that pre-upgrade tower value is below a contract archer on raw `hp * attack` cost efficiency, but wins on range and static-zone control. It should not beat mobile army value in open-field fights.

Building tech:

- Add a building durability upgrade, researched from a building UI surface such as the town hall.
- The upgrade should be expensive enough to be a deliberate tech choice, not an automatic opener.
- Once researched, it increases all owned building max HP by 20%.
- It does not increase tower attack.
- The UI must expose the research option through the ordinary research controls, not through a hidden AI-only path.

Technology applicability:

- Barracks combat upgrades apply only to ordinary trainable combat units that explicitly belong to the affected unit list.
- Mercenary units do not receive barracks combat upgrades.
- Buildings do not receive barracks combat upgrades.
- Buildings receive only building-specific tech effects such as the building durability upgrade.
- Summoned units should follow their own explicit simulation rule; they must not accidentally inherit permanent army or mercenary upgrade paths unless the catalog says so.

Repair:

- Workers should be able to repair damaged friendly buildings.
- Repair is a real command/simulation system, not just passive regeneration.
- A worker near a damaged friendly building may auto-repair only when the player has enough gold and the worker is not already committed to a higher-priority command.
- Repair spends gold over time and restores building HP over time.
- Repair cost ratio should be based on a Warcraft-III-like model: repairing from 0 to full should cost a meaningful fraction of the building's construction cost, not the full cost and not free. The exact ratio should be chosen and tested in simulation balance, then surfaced to the SDK.
- Repair should stop loudly when the building is full HP, destroyed, unaffordable, or unsafe enough that the worker should flee.
- AI repair/heal/resupply jobs should use SDK repair intents and memory claims. The AI should not hand-roll raw building HP mutation.

## Jobs

V2 should move toward named jobs instead of scattered one-frame scripts fighting over the same units.

Initial job categories:

- `armyTrack`: groups own/enemy armies, strength, center, direction, and future position.
- `townTrack`: tracks bases, expansions, mining state, threatened towns, and base value.
- `economyPlan`: workers, saturation, production, tech, expansion timing, and reserve intent.
- `mercenary`: assigned unit or squad, camp target, timeout, retreat/cancel condition, hire condition.
- `creep`: assigned squad, camp target, required strength, interrupt condition, completion condition.
- `expand`: desired mine, clear/build/mine state, builder, reserve intent.
- `attackWave`: committed target owner/objective, wave members, abort/retreat rules.
- `harass`: target worker line, assigned group, enemy-main-army avoidance, exit rule, timeout, regroup/retarget rule, item use rule.
- `retreat`: home/rally target, participating units, end condition.
- `repairHealResupply`: wounded unit handling, home/moon-well target, worker repair, heal threshold, timeout, and return-to-duty condition.

Jobs must have explicit lifecycle:

- create
- assign units/resources
- issue commands
- update
- complete
- cancel
- expire

The first useful slice is not a full job framework. The first useful slice is explicit unit claims for mercenary and expansion/creep tasks, so later tactical scripts stop stealing those units without knowing why they were assigned.

## Unit Claims

Unit claims are the smallest useful form of long-term task state.

```ts
type AiUnitClaim = {
  kind: "mercenary" | "creep" | "expansion" | "attack" | "harass" | "retreat";
  targetId: string;
  x: number;
  y: number;
  sinceTick: number;
  expiresTick: number;
};
```

Rules:

- Claims are written only by scripts/jobs that intentionally assign units.
- Claims expire loudly and are pruned when the unit dies, changes owner, or the target disappears.
- Higher-priority survival/defense commands may override claims.
- Ordinary objective control and attack-wave logic should not casually steal claimed units.
- Healing/resupply claims must end when the unit is healthy enough, the moon well/home target is unsafe, or a timeout expires. They must not strand units at home forever.
- Harass claims must end when the raiding group is threatened by the enemy main army, the target worker line is exhausted, the timeout expires, or the group should regroup/retarget.
- A claim is not a command. It is a coordination fact used by future scripts.

This gives us AMAI-style "unit belongs to this job" behavior without importing AMAI's whole architecture at once.

## Shared Perception

Several current V2 mistakes come from every script looking at a slightly different world. V2 should grow shared perception as reusable SDK/AI trackers:

- own army groups, enemy army groups, neutral camp groups
- group strength, count, center, direction, and projected future point
- main army identity
- local control around objectives
- threatened own/enemy bases
- expansion candidates and guarded natural status
- creep camp value, risk, and current claim state
- total enemy pressure near each base

These trackers should be composable. A benchmark run, a small theater test, or a custom SDK loop should be able to enable the same trackers and record their outputs.

## Tactical Surface

The AI should explicitly explore the following tactics over time:

- item pickup and item use
- ranged kiting micro
- mixed unit composition
- memory-backed low-health pullback to home/moon wells with explicit return-to-duty thresholds
- moon well supply/healing behavior
- memory-backed early small-squad worker harassment that avoids the enemy main army, pressures workers, and has an explicit escape/regroup condition
- enemy expansion harassment, especially after item or mercenary pickup
- concentrating superior force against small enemy groups
- creep-jacking: interrupting enemy large camps and fighting with neutral pressure
- tower rush
- feints that split enemy force
- stealing base locations
- base trade
- chaotic multi-expansion play
- turtling to later tech
- growing high-level carry units
- later-game caster-heavy compositions, including priests, summoners, and witches, so V2 has more healing, summons, curse timing, and micro surface than pure barracks/stables mass

These tactics should enter as jobs, policy modules, or memory-backed scripts. They should not become unrelated one-frame condition piles.

V2 strategy must be parameterizable. In normal benchmark runs, at least half of the V2 melee games should disable worker harassment, covering both early harassment and worker-pressure scripts. This prevents one strong opening from becoming the whole AI identity. The disabled variant must remain a real strategy, not a crippled AI.

AMAI should be used as an architectural and strategic reference, especially its script organization, strategy variety, and mode-specific behavior. Borrow ideas and structure, not brittle one-off Warcraft constants.

## Economy Rules

- A gold mine saturates at 5 workers. More than 5 workers on one mine should not be treated as more income.
- Economy logic should distinguish mine income from creep/neutral income.
- Spending should distinguish unit training from building construction.
- Expansion timing is a strategic state, not just "current gold >= town hall cost".
- In multi-enemy benchmark lanes, being globally outpowered is normal. The question is whether a local action improves survival, economy, tech, or army value.
- Summoned units are temporary simulation entities. A summon must have a clear lifetime, expire without counting as a combat loss, and never become free permanent army supply.

## Benchmark Report Requirements

Each benchmark report contains a list of evaluations. Each evaluation contains time, game count, elapsed time, CPU time, and expandable games.

Each game setup records:

- map
- map size
- gold mine count
- neutral camp distribution
- mercenary camp details
- item distribution
- player config
- AI version
- race

Each game result records per player:

- AI version
- first expansion mining time in game seconds, not ticks
- upgrade time for each tech level
- unit count by star level
- first fight with enemy
- first attack on enemy expansion
- first own expansion attacked
- total base count, including initial base
- neutral units killed
- enemy units killed
- own units lost
- units killed by neutral
- defense tower count
- moon well count
- item pickup count
- item use count
- peak population
- final population
- final building count
- total income
- mine income
- creep income
- total gold spent
- unit training gold spent
- building construction gold spent

These tracker fields are not optional dashboard decoration. They are fixed benchmark instrumentation and should be available through SDK report APIs.

## Dashboard Requirements

The benchmark dashboard is a separate frontend debugger supported by the SDK.

Requirements:

- Reads benchmark reports from a shared folder.
- Auto-refreshes when files change.
- Shows a bounded, scrollable run list.
- Uses a two-level nested structure: run list -> game list -> expandable game detail.
- Shows setup and result data without hiding `none` values that indicate missing events.
- Makes suspicious wins obvious, especially wins with no first fight or 1v1 controls where the opponent died to neutrals.
- Shows elapsed time and CPU time for each run.

The dashboard should help expose broken trackers and fake wins. It should not make bad data look clean.

## V1 Stability

V1 is the benchmark control. Avoid modifying V1 unless:

- the simulation contract changed and V1 must compile;
- the SDK command API changed and V1 must adapt mechanically;
- a shared bug affects both V1 and V2 and the fix is below AI policy level.

V2-specific experiments should be gated by version, separate script selection, or explicit policy modules.

Changing the sampled map mix is often safer than changing V1. The same-map 1v1 score controls must remain meaningful: real 1v1 games on scored terrain, no opponent self-death masquerading as AI strength.

## Validation

Every meaningful AI change needs:

- a small deterministic test proving the intended local behavior;
- the same-map paired 1v1 score control signal;
- the standard sampled benchmark bundle: 12 paired `1v2 score` / `1v1 score control` maps, 3 `1v3 probe` maps, and 3 `2v3 probe` maps;
- the tagged combat bundle: 5 `15v20 mixed combat` matches and 5 `10v12 mixed combat` matches;
- dashboard inspection for suspicious wins/losses;
- comparison against the latest known baseline.

Benchmark failure is a useful constraint, not an inconvenience. If a local tactical idea improves a unit test but tanks the benchmark, the idea is incomplete.

## First Implementation Slices

1. Keep `src/ai` as the only package boundary for built-in policy and runtime logic.
2. Make SDK/runtime consume AI through the upper AI package boundary rather than treating policy as shared simulation code.
3. Add `AiPolicyMemory` to SDK AI runtime calls as a normalized policy input.
4. Add a pluggable SDK memory provider/store so game loops can run with fresh ephemeral memory, supplied in-memory state, or durable-memory AI without changing policy code.
5. Add explicit unit claims for mercenary and expansion/creep tasks.
6. Make objective control and attack-wave respect active claims, while allowing urgent defense/survival to override.
7. Migrate AI snapshot reads onto SDK snapshot-query/tracker APIs.
8. Add report fields for claim/job state in debug logs, not as required dashboard columns yet.
9. Promote repeated per-frame calculations into shared perception trackers.
10. Turn mercenary, expansion, creep, retreat, harass, repair/heal/resupply, and attack-wave behavior into named long-running jobs.

Each slice must be benchmarked before it becomes the new baseline.
