# V6 Design Notes: What AMAI Does, and What V6 Should Do

Source: [SMUnlimited/AMAI](https://github.com/SMUnlimited/AMAI), the Warcraft III melee AI. The files cited below were read directly:

- `races.eai`
- `common.eai`
- `Jobs/RETREAT_CONTROL.eai`
- `Jobs/HARASS.eai`
- `TFT/Human/Strategy.txt`
- `TFT/Human/BuildSequence.ai`

Our game has no heroes, mana or tiers. Everything else maps closely.

## 1. A strategy is a phased build sequence, not a unit mix

`BuildSequence.ai` gives each strategy a per-tier list of `BuildUnit(count, kind, priority)` targets. The builder re-reads the list every loop. It walks it by priority and buys whatever is missing.

The caster strategy (`build_sequence_MassSp`) builds **no casters in tier 1**:

- **Tier 1:** a reactive front of 16 food of footmen and riflemen. The split comes from enemy armor types via `SetBuildReact`. It also builds a front tower and techs up.
- **Tier 2:** 10 sorceresses and 10 priests.
- **Tier 3:** 22 and 19.

The normal strategy's tier 1 is 8 footmen (priority 65), 3 riflemen (55), an expansion (53), a front tower (45), 4 more riflemen (43), and the tech (42).

Tier gates (`SetTierBlock`) hold the next tier until 75% of the requested units exist or food reaches 60.

What went wrong in V6: it trained summoners from the first minute. Summoners are expensive, weak alone, and their value is spirits that arrive 40s apart. V6 died in 79 of 82 lost games to the first combined push, between minute 5 and minute 10. That is exactly the window where AMAI fields a cheap front and a tower.

**V6 should have three phases:**

- **Phase 1:** a cheap melee front sized to the enemy's composition, a front tower, and the natural expansion.
- **Phase 2:** the caster building and a summoner mass behind that front.
- **Phase 3:** a third base and the siege piece (golems).

The next phase opens when the current phase's army is about 75% built.

## 2. Target counts and priorities; the builder saves

This part has already carried over. `OneBuildLoopAM` walks the queue top-down, stops at the first item it cannot afford (that is how it saves), and ages the priority of anything left waiting.

V6's executor does the first two but not the ageing. Without ageing, a low-priority item can starve forever behind a steady stream of cheap higher ones. We saw exactly that with summoners behind workers.

## 3. The attack thread: heal, wait for strength, pick a target, go

`attack_sequence_all` (`races.eai:594-651`) loops through four steps:

1. `HealArmy`. Pull home until army health is above 75%, or at most three rounds of trying.
2. Wait until `GetOwnStrength() >= minimum_attack_strength`, a per-profile number.
3. Form the group.
4. Run one attack.

The attack target comes from the cascade in `SingleMeleeAttackAM`, in this order:

1. Defend a threatened town.
2. Commander orders.
3. Special openings.
4. Clear the creeps on the next expansion.
5. Contest an enemy expansion.
6. Attack a player that passes `IsTargetGood`.
7. Otherwise creep.

`IsTargetGood` (`common.eai:13602`) compares:

> the whole target player's strength + 4 × the towers near the target (×1 with siege units) ≤ own strength + aggression bonuses

Two points differ from what V6 does:

- **V6 attacks as soon as its strength clears the target's local defenders.** AMAI compares against the target *player's* whole army. It also first waits for a minimum strength and a healed army.
- **V6's towers count 2.5 against V6.** AMAI counts towers 4× unless it has siege. Our opponents build towers, and V6 has no siege until phase 3.

## 4. Retreat: local strength, two thresholds, and home first

Every 2s, `RETREAT_CONTROL` sums enemy and creep strength against allied strength around the battle. It then compares against two thresholds, both scaled by aggression (`ApplyFleeStrengthModifier`):

- Above the first, units may flee.
- Above the second, the whole group goes home.

A threatened town also breaks an attack.

V6 has the single-threshold version. It needs the second threshold and the home-threat break.

## 5. Harass: small declared groups with clear abort rules

A strategy declares its harass groups, e.g. `AddHarass(2, 4, uFOOTMAN)`. `HARASS.eai` targets peons, an expansion or the main hall. It aborts when:

- the group drops to its flee number;
- a tower is seen;
- its strength falls to a fraction of its starting strength;
- local enemy strength passes a limit;
- or home is threatened.

Wounded harassers go home one by one.

V6's raid has most of these. It is missing the tower abort, the start-strength fraction, and the per-unit wounded return.

## 6. Creeping and items

When no attack target passes the gate, the army creeps the strongest camp it can beat. After a fight it lingers about 8 seconds so the items that drop are picked up. Clearing the camp on the next expansion comes before any other camp.

V6 does the camp choice. It does not wait for drops.

## Plan

Rebuild V6's modules in this order. Each module is shaped with small scenario tests first, then checked against watched games, and only then benchmarked.

1. **Phased strategies:** phase 1 front, tower and expansion; phase 2 casters; phase 3 siege and third base. Add the phase gates, and priority ageing in the executor.
2. **Attack thread:** heal first, a minimum strength per personality, the whole-player gate, and towers at 4× without siege.
3. **Retreat:** two thresholds, and a home-threat break.
4. **Harass:** the tower abort, start-strength fraction, and per-unit wounded return.
5. **Creeping:** wait for drops after the fight.

## What the games said

The phased rewrite followed this plan and first scored 154 of 1000 tune games; the design before it (arch4) scored 478. Watching the same games under both (chalkFen v6 north, mallowRun v6 south, seed v5-hybrid-50-2026-06-12) showed which AMAI rules transfer and which do not.

**Did not transfer:**

- **The whole-player attack gate.** Counting the target owner's entire army (plus a minimum strength and spirits up) meant V6 never punished an opponent who had just broken its army on V6's towers. arch4's gate, every enemy army within 1800 of the target hall, won three times as often. What does transfer is judging the army *on arrival*: spirits live 60s and a march across the map takes most of that, so an attack counts each summoner's steady state (duration / cooldown = 1.5 spirits), not the spirits up right now.
- **Towers at 2.5 (AMAI: 4×).** A tower here has no armor: 200 hp and 16 damage per 1.5s. By hit points times damage it is one footman, so it counts 1.3. At 2.5 V6 marched out of tower range into fights "its towers would win", and lost twenty spirits to archers.
- **Workers only for halls already rising.** AMAI pre-queues peons for the next base. Without that, V6 sat on six workers until minute six and the natural waited on gold six workers could not bring in.
- **Two early towers and capped caster counts.** Each cost the natural or the army. One tower, and caster targets high enough that production never idles.
- **Personality knobs as risk thresholds.** Setting every personality to steady's numbers raised the tune score from 309 to 401. Less aggression, an extra tower and greedy bases each cost 10–15 wins per 100 on the first seed. Personalities should vary style (raids, timing, siege), not how much risk V6 takes.

**Did transfer, with changes:**

- **Defense.** An army 1300 away is not an attack; enemies within 750 of a building are. V6 fights in the open only with a 1.15 edge; otherwise it guards the hall under its towers and fights whatever walks into their reach. Holding and guarding keep the army on a short leash (450), so spirits stop chasing retreating raiders past the towers.
- **The natural outranks the phase's army**, and a goal keeps its waiting time through a moment's absence (resetting it on every flicker left the natural at the bottom all game).
- **Harass aborts** (tower seen, half the starting strength lost, a raider below a third goes home alone), as in `HARASS.eai`.
- **A held army is not free.** An army that has stood at its rally for 90s attacks when it merely matches the defenders. One game held an even army for sixteen minutes while its starving opponents rebuilt thirty archers, and ran out of time.
- **An attack is a group.** The units that set out, plus spirits and stragglers that reach them; anything trained afterwards waits at the rally. The group comes home when it has lost half its starting strength (AMAI's harass rule, applied to attacks), and the army regroups for 30s before it may set out again. Before this, V6 walked every new unit across the map alone and fed 5000 gold into a base that lost 115. This was the largest single gain of the day: 380 to 447.

Tune scores along the way (1000 games each): phased first cut 154; arch4's workers, gate, one tower and caster caps 309; personalities neutral 401; three style-only personalities, arrival strength and the idle-army attack 380; attack groups with regroup 447. By race, ember wins 52% and grove 37%; grove-spirit-host (33%) is the weakest strategy.

## What hand play said (2026-09-26)

Playing V6 by hand on chalkFen (V6 north, grove, seed v5-hybrid-50-2026-06-12), step by step with replays from saved
orders, won at 1322s the game the AI lost at 936s. What won it:

- **Summoners and nothing in front of them.** Sanctum first, summoners from 45s, the natural once the spirits had cleared
  its camp (185s), a second sanctum at 420s. No early tower and no melee front.
- **Every new enemy hall killed while it was young.** By 700s both opponents were on one base and six workers.
- **Hit one army, then leave before the other comes.** At 780s the whole army wiped V5's fourteen archers at V5's hall and
  walked away; the same attack pressed on lost everything to V3's army fifteen seconds later.
- **Forward towers, then the counterattack.** V3 attacked into three towers and fresh spirits and lost two thirds of its
  army; V6 went straight to V3's hall and ended V3 at 1300s.

Carried into the AI, each change judged on the 1000 tune games (baseline 458 with heavy armor in the sim):

| Change | Tune | Note |
|---|---|---|
| Caster hosts open like the hand game (no tower, no front); halls on dry mines do not count as bases | 762 | spirit host 31% → 92%, pyre host 49% → 95% |
| Raider and runner hosts on the same caster core, their raiding party beside it | 876 | runner 55% → 86%, raider 51% → 73% |
| Strike and fall back (far armies at half, break off when another army closes in); creep only on V6's side | 886 | timeouts 48 → 17 |
| An enemy expansion is judged only by the units at it | 900 | |

Tried and not kept: four heavies (knights, cinder revenants) in every late phase, 864.
