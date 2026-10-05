# Humanized AI behavior

V5 keeps a shooter core, V7 uses an adaptable combined force, and V8 favors melee with healing and curses. Decisions use terrain, forces and orders, never an opponent version or a map identifier. Support roles are bounded by army size and battlefield need.

## Combat ownership

`shared/combat-target.ts` scores reachable threats, distance, remaining health and weapons with a switching margin. Simulation uses it for automatic acquisition, attack-move, leashed guard attacks, neutral acquisition and damage responses. A living, reachable target from a human's explicit attack remains commanded; move, cast, boarding and worker jobs are preserved. Attack-move retains its destination. Neutral responses retain camp leashes. Pending lethal projectiles prevent duplicate commitments.

AI may reconsider its own explicit attacks through `policy/engagements.ts`. The same score is constrained by mission leashes, local strength and siege screens. A combat engagement owns its fighters for that think, so a later strategic script cannot immediately send them back to the old objective. Protected artillery may keep shooting its objective; direct threats can interrupt it. This applies to unit and structure targets alike.

## Roles and cooperation

| Element | Use |
| --- | --- |
| Footmen, lancers, ravagers, runners | Frontage, cavalry response, flanking and raids; V5 replenishes a small screen under melee pressure |
| Archers, spark archers | V5 shooter core, stationary aiming and survival micro |
| Horse archers | V5 mobile support; V7 bounded response to a predominantly melee opponent |
| Raiders, knights | Raids, exposed back-line pursuit and charges |
| Priests, witches, summoners; acolytes, hexers, callers | Healing, curse selection and summons behind a screen; V5 Ember support no longer stops at one acolyte |
| Golems, wardens | Bounded screens for support-heavy armies; wardens also respond to ranged opposition |
| Chieftains, revenants | Ember doctrine's later melee roles |
| Ram, ballista, catapult, organ gun | Existing force/fortification-driven procurement, supplemented by protected engagement decisions |
| Mercenary, contract archer, field medic | V5 camp control and bounded hiring |
| Transport, carrier | Settlement, assault, evacuation and relocation; capacity chosen for the expedition |
| Warship, cutter, fire ship, bombard ship | Fleet combat and coastal fire support; loaded ferries receive distributed escorts |
| Aiming and melee stances | Prepare an approaching fight from a defensive post; brace a caster screen, shock an exposed back line, return to pursuit after contact |
| Shops and equipment | V5/V7/V8 inherit safe single-unit shopping with reserved gold and danger cancellation; scrolls serve armies, boots serve mobile melee, rings serve wounded veterans, ivory towers support a local fight |
| Allied rescue, base trade, camps, tower rush, expansions | Existing terrain- and force-driven missions retain priority over local support tasks |

Escorts cover the landing coast while a loaded ferry waits to depart, accompany it at sea and cover its return. The mainland retains defenders and the expedition's engineer slots. Economic purchases share the remaining gold; defense releases overseas savings, and doctrine/support procurement cannot double-book a producer.

## Verification and limits

Local scenes exercise automatic and neutral retargeting, human command preservation, target stability, V5/V7/V8 full-stack responses, siege screens, composition roles, pre-aiming, stance recovery, convoy protection and budgets.

Five 10-minute development observations compare main with the change on a duel, teams, FFA and two seeded generated maps. Both produce no rejected commands in the final run. Observed landings change from 18 to 20 on brokenSea and 16 to 21 on generated island starts. These are observations, not victory rates or exhaustive coverage: all five games remain unfinished at ten minutes, some armies still hold for long periods, and the sample does not naturally produce every unit or shopping opportunity. Longer strategy and deadlock investigation remains necessary; the table records executable roles, not a claim that every combination is solved.
