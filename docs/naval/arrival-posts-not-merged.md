# Arrival among friends' posts: tried, measured, not merged (2026-10-18)

## The stall
After #511 (hulls give way to their side's land units) the 240-game stall bench had 67 unit·min of stall@60 left,
almost all an army's casters (priest, witch, hexer) that the AI sends each to a post of its own, posts less than a body
apart. Each pressed for the rest of the game against a friend standing on, or walking to, the next post. @@@group-arrival
ends a walk only against a friend whose goal is the **very same point**, and these posts differed by fractions of a unit.

`src/shared/arrival-posts.test.ts` replays the cluster as it stood in the bench (ladder-14, v9_knight vs v9, tick 29600;
`test-fixtures/arrival-casters.json`: terrain, the town hall and towers it is packed against, the units and their
orders). On main all 7 casters are still walking after 60 s. Use it as the test for any fix.

## What was tried
- Land give-way (idle friends step aside for a walker held up): not needed. Separation already pushes idle units aside
  (a neck with an idle priest, a packed crowd: both pass on main). It did not free the recorded cluster.
- A plain move also ends against an idle friend standing on its point (this branch, 69f5df2c). It frees the cluster.
  Attack-moves are left out (scripted AI battles changed), and so are hulls (a deck walker counted its own ship).

## Acceptance (AI Lane, 240 games, base fda99ab8)
- stall@60: games ≥ 1 unit·min 13 → 3, total 67 → 43 unit·min.
- Wins 155 → 147, with **66 flipped games, mostly win ↔ loss**: archer vs v9 28 → 24, summoner vs v9 18 → 12.
- trade@15 summoner 1.26 → 1.04, archer 1.80 → 1.62 (knight 1.82 → 2.02).

## Conclusion
Not merged. The rule is a general one on plain moves: rallies and retreats end early against idle friends, and that
changes how ordinary games go far more than the stall it removes. The narrower "goal within a body" variant broke
scripted AI battles (formation slots a body apart). What is left belongs on the AI side: posts at least a body apart
(AI Lane), tested with the recorded cluster, with no change to the sim.
