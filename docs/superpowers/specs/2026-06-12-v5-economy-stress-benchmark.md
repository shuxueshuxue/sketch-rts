# V5 Economy Stress Benchmarks

## Purpose

These are V5 research benchmarks, not standard release gates. They isolate whether V5 can convert map resources into army advantage without adding map-id-specific scripts or reward-hacking behavior.

Standard V3/V4/V5 benchmark scores remain separate. Any AI improvement discovered here must be general enough to survive the ordinary 50-map V5 hybrid gate.

## Anti-Cheat Constraint

Do not branch V5 policy on `goldGrid` or `mercPocket`. The maps can expose a skill gap, but the AI response must be expressed through reusable economic and tactical primitives:

- expansion timing and saturation
- expansion defense and regrouping
- enemy expansion harassment
- opportunistic attacks while enemies are creeping
- route and neutral-camp risk estimation
- mercenary hiring and integration into the main army

Acceptable implementation examples:

- when outnumbered by several enemy economies, value a safe nearby second or third mine higher
- when a controlled mercenary camp is nearby and stocked, hire if that unit fills a real army role
- when an opponent's expansion is under-defended, redirect a real combat group to deny it

Rejected implementation examples:

- `if (mapId === "goldGrid") build four town halls`
- `if (mapId === "mercPocket") send a worker to these exact camp ids`
- hard-coded seat indexes, hard-coded player ids beyond normal team/opponent discovery, or benchmark-name-specific build orders

## goldGrid

`goldGrid` is a 4096x4096 non-score map with a 4x4 grid of gold mines.

The benchmark samples 6 of the 16 grid points by seed. One sampled point is assigned to V5, and the remaining five are assigned to five independent V3 opponents on the same enemy team. V5's own position is also random among the sampled points. V5 must win by using fast expansion, map control, and group-army conversion to defeat the opponents one by one.

Initial town halls are placed near their assigned mines but offset away from the map center, so adjacent grid points do not turn the research benchmark into an immediate base-rush spawn. This keeps the test focused on economy conversion instead of accidental start-location contact.

This benchmark measures whether V5 can:

- expand beyond the first natural when many mines are available
- avoid feeding small groups while expanding
- defend its mining bases
- attack or deny enemy mines
- preserve enough army mass to convert economic advantage

The intended winning style is a general economic snowball: secure multiple mines, protect the mining surface, trade only with grouped armies, and collapse isolated V3 economies before five opponents can combine into one decisive army.

## mercPocket

`mercPocket` is a non-score map where V5 starts near three unguarded mercenary camps. V5 fights three independent V3 opponents.

The three camps are placed near V5's randomized starting seat. They are intentionally unguarded and stocked with frontline, ranged, and healing roles. V5 fights three independent V3 opponents on the same enemy team.

The map tests whether V5 can convert early local hire access into army tempo without special casing the map. The expected generic behavior is to hire efficiently, add those units to normal army control, and use the early advantage to expand, deny an exposed economy, or take a favorable first fight before V3s stabilize.

The intended winning style is a reusable mercenary tempo opening: control local neutral value, turn it into a mixed army, avoid splitting the first hired force into low-value errands, and transition into normal economy plus production instead of depending on infinite camp access.

## Benchmark Shape

The combined script is `benchmark:ai-v5-economy-stress`.

- `goldGrid v5 1v5 expansion stress`
- `mercPocket v5 1v3 mercenary stress`

Both evaluations are seeded and reproducible. `--sample-count` controls how many random openings each evaluation runs.

The research pass target is `90%` on each map family without reducing ordinary V5 hybrid benchmark quality. Any candidate change must also rerun the standard V5 hybrid gate to prove it did not overfit the stress maps.

## Initial Baseline

Seed `v5-economy-stress-2026-06-12a` with 10 samples per evaluation currently scores 2/20:

- `goldGrid v5 1v5 expansion stress`: 0/10
- `mercPocket v5 1v3 mercenary stress`: 2/10

## Current Measured State

After the configured-opponent severe-gate fix, seed `v5-economy-stress-2026-06-12a` scores:

- 10 samples per evaluation: 4/20
  - `goldGrid v5 1v5 expansion stress`: 0/10
  - `mercPocket v5 1v3 mercenary stress`: 4/10
- 50 samples per evaluation: 10/100
  - `goldGrid v5 1v5 expansion stress`: 0/50
  - `mercPocket v5 1v3 mercenary stress`: 10/50

The standard V5 hybrid gate remained 76/100 on seed `v5-hybrid-50-2026-06-12` with 50 maps, dashboard run `2026-06-12T21-21-26-341Z-19f6w4l`.

Observed generic improvements so far:

- severe multi-opponent openings can build first core production while a non-core opening building is still incomplete
- controlled combat mercenaries can spend through the first-production reserve when V5 is badly outnumbered
- early V5 training protects the first two combat units from being delayed by routine worker production
- severe multi-opponent pressure gates that describe the configured matchup size use configured team opponents, not only currently active owners, so eliminating one early opponent does not silently drop a 1v3+ opening into 1v2 economy arbitration

## Rejected Hypotheses

These were tested on seed `v5-economy-stress-2026-06-12a` with 10 samples per evaluation and then reverted because they did not improve the stress score:

- Seeding a fourth worker before the first trained combat unit in a severe two-mine opening kept the combined score at 2/20 and made the inspected `goldGrid` sample die earlier.
- Letting the economic catch-up tower yield its utility bank to missing ranged production kept the combined score at 2/20 and made the inspected `goldGrid` sample die earlier. The tower was buying survival time.
- Letting missing production yield to the first affordable trained combat unit changed `mercPocket` command traces, but the score stayed 2/20; inspected failed samples produced more training but died earlier or killed less. The special-map bottleneck is not simply "train before tech building."
- Lowering the five-enemy two-base third-expansion combat gate from 5 to 3, then protecting that bank against combat training, kept the combined score at 2/20 and made several `goldGrid` samples die earlier. V5 still did not complete a third base because survival utility spending consumed the bank; simply starving army production for a third is negative.
- Letting a severe two-base opening train a fourth worker immediately after the first combat pair kept the combined score at 2/20. The root observation is still valid (`goldGrid` often runs two bases with only three workers), but this narrow arbitration change was too small to create a win and was reverted.
- Forcing the `mercPocket` opening to transition from a controlled extra combat-merc hire into affordable core Ember training dropped the combined score from 2/20 to 1/20. The failing samples do show `train=0`, but the local mercenary conversion is still carrying more value than this early core-training transition.
- Adding a very-late V5 worker/remnant closeout against exposed crippled buildings passed its focused unit test but dropped the standard V5 hybrid score from 76/100 to 75/100 on seed `v5-hybrid-50-2026-06-12`; exact `celadonPass v5 north` still timed out because the real state had only two workers, two combat units, live enemy combat, and tower coverage rather than a clean wounded-building closeout.
- Forcing the five-enemy two-base opening to bank a third town hall ahead of sustained training, emergency towers, routine towers, and distant main-pressure pauses moved the inspected `goldGrid` third hall from roughly 365s to 228.75s, but the combined stress score stayed 2/20. Earlier third-base timing alone is not enough; the army still collapses before the economy converts.
- Holding 75-99 gold for sustained two-mine combat production instead of training another worker fixed the inspected failure shape where `goldGrid` had 10+ workers and only two fighters, but the combined stress score stayed 2/20. The bottleneck is larger than this narrow bank arbitration.
- Capping the first-production-reserve exception at two controlled combat mercenaries, so the third early `mercPocket` hire would yield to barracks/forge money, dropped the combined score from 2/20 to 1/20. The third early combat merc is carrying more survival value than the delayed core production in this opening.
- Letting severe five-enemy two-mine V5 build a second core production line before the normal ranged/stables tech chain kept the combined score at 2/20 and left `goldGrid` at 0/10. The single-line vs multi-line diagnosis is not enough without a broader survival or target-elimination change.
- Letting V5 worker pressure write the chosen raid owner into strategic focus only in 3+ opponent games passed the focused policy boundary tests, but dropped the combined stress score from 2/20 to 1/20. The target-spread diagnosis is real in traces, but bluntly binding global focus to the worker raid hurts `mercPocket` conversion rather than fixing closeout.
- Lowering the severe-economy sustained-combat floor so a two-base single production line banks the sixth body for the next production building passed focused policy tests, but the combined stress score stayed 2/20. Production capacity is late, but this narrow bank timing does not change the outcome.
- Extending the V5 no-defense-line worker evacuation distance from the existing base-edge retreat to a deeper 520px retreat did not improve the 10-sample stress score once configured-opponent severe gates were fixed. The underlying sample still lost workers because repeated threat-center updates made retreat points flip across the fight.
- Adding a configured-1v5 two-base worker floor before sustained combat passed a focused policy test, but both 10-sample and 50-sample stress runs stayed unchanged (`goldGrid` remained 0 wins). GoldGrid needs a larger economy-conversion change than merely training the fourth/fifth worker earlier.
