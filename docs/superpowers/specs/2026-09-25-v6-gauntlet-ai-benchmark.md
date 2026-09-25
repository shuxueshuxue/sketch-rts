# V6 Gauntlet AI Benchmark

## Product Goal

Build `v6`, a melee AI that beats an allied team of V3 and the shooter V5 in simultaneous 1v2 games, without ever
training or hiring a shooter.

Benchmark gate (`npm run benchmark:ai-v6-gauntlet -- --seed <seed> --map-count 50`):

- 50 sampled rich-score maps, both sides of each map: 100 matches per seed.
- V6 plays alone. V3 and V5 play allied on the other team.
- V6 race and V5 race are seed-randomized from `grove | ember`. V3 race uses the same draw as the V5 benchmark.
- Which opposing slot gets V3 or V5 is seed-randomized.
- Target: V6 wins at least 95% of matches, on seeds it was not developed on.

## Constraints

- No shooters: V6 never trains or hires an `archer`, `sparkArcher` or `contractArcher`. Casters (priest, witch, summoner,
  ember acolyte, ash hexer, pyre caller) and towers are allowed.
- Every benchmark game is checked. The `unitRosterStats` tracker records each side's train and hire orders by unit kind,
  plus its peak count of each kind alive. The summary lists every match where V6 ordered or fielded a shooter under
  `shooterViolations`. That list must be empty.
- V5 plays as the shooter V5 even when it has only one opponent: its shooter production plan, its extra shooter
  buildings and its range and speed research no longer wait for a second opponent.

## Design

V6 runs V5's whole playbook (economy, expansions, camps, towers, army scripts) with three changes.

1. **Summoner core.** Grove builds only sanctums and trains summoners. Ember builds only cinder spires and trains pyre
   callers. A second town hall raises this to three caster buildings.
2. **Standing spirits.** A summon costs only the caster's time: a spirit lasts 45s and the spell is back in 11s. Each
   summoner therefore casts whenever it can and keeps about four spirits up, with no gold or supply cost. The shared
   rule casts only when an enemy is within 240 and no spirit is nearby. V6 aims each summon toward the fight, curses the
   hardest hitter in reach, and keeps its spirits fighting instead of walking home wounded.
3. **Caster screen.** The `casterScreen` script claims the summoners. It is the only script whose move and attack orders
   reach them. A summoner stands behind its spirits, on the side away from the enemy and out of reach of enemy shooters
   and towers. With no spirits left, it falls back toward home.

## Evidence

All numbers below are V6 wins out of the matches played.

| Step | Tune (10 seeds) | Fresh (10 seeds) | Final (5 seeds) |
|---|---|---|---|
| V5's playbook minus shooters | 6/1000 | | |
| + summoner core, standing spirits | 809/1000 | | |
| + caster screen | 994/1000 | 997/1000 | 497/500 |

**Where the baseline lost.** The fight arena captured V6's worst 30s window in each tune game: 657 unique fights. 534 of
them were within 800 of V6's own town hall, in minutes 4 to 8. The median enemy army was worth 1612 gold against V6's 620.

**Compositions at equal gold, replayed on those fights.** Trade is enemy value lost per value V6 lost. Warm means each
summoner starts with three spirits already up.

| Composition | Trade | Fights won (of 657) |
|---|---|---|
| Any melee (footman to golem, ravager, runner, mercenary) | 0.22-0.42 | 30-85 |
| Casters under the shared summon rule | 0.22-0.33 | 30-55 |
| Archers (forbidden, for reference) | 0.92 | 233 |
| Summoners, standing spirits, cold start | 0.78 | 227 |
| Summoners, warm | 2.60 | 442 |
| Pyre callers, warm | 2.67 | 431 |
| Summoners plus priests, warm | 1.51 | 337 |
| Melee plus summoners, warm | 0.58-0.97 | 163-264 |

**Why the summoner core alone stalled at 81%.** Traced over the lost games, 777 summoners died. For 587 of them the last
order was the shared skirmish script walking a wounded summoner home. 569 died more than 350 away from their own spirits,
and 734 had enemy shooters nearby.

## Balance Note

Most of V6's edge comes from the summon economy: a 150-gold summoner (2 supply) keeps about four free, supply-less 85-hp
spirits alive. The shared AI casts summons conservatively, so V3 and V5 never use this.

If this should count as a balance bug rather than play, the direct levers are:

- cap the active spirits per summoner;
- bring the spirit duration closer to the cooldown;
- give spirits supply.

Any of these changes the V6 result, so re-run this benchmark after changing it.

The summon was rebalanced on 2026-09-25 (spirits last 60s, cooldown 40s, summoners 180 gold) and shooters lost 15% of
their health; knights and golems got heavy armor. Under those rules V6 was rebuilt: on 2026-09-26 it wins 955/1000 tune, 959/1000 fresh and 471/500 final games
(2385/2500, 95.4%); see the design notes for how.
