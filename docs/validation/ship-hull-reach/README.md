# Whole-hull reach: the home pirate battle

Frames were captured by real headless Chromium on the A100 (`pirate.mjs`, the home screen set to the fleet scene). The
admiralty ship is on the left, the pirates on the right.

1. `1-gun-duel-on-the-leg.webp`: the pirates sail the leg alongside, their guns 280 from the admiralty hull, and both
   broadsides fire. Balls are in flight between the hulls. The boarders wait on their far rail.
2. `2-bridge-out.webp`: abreast of the berth, inside both dead zones, the bridge goes out.
3. `3-fight-on-the-admiralty-deck.webp`: the boarders fight on the admiralty deck. No gun fires at a deck alongside.

## Seeds 1-20 (`pirate-seeds.test.ts.txt`, run as a vitest file in `src/client`)

| | All 20 seeds |
| --- | --- |
| Gun duel before the bridge | pirates 12 hits, admiralty 12 hits, from 4.4-4.5 s to 16.9 s |
| Gun hits on crew before / after the bridge | 0 / 0 |
| Bridge going out | 54.5-54.8 s |
| Admiralty ship taken | 94.2-94.4 s (the scene fades at 150 s at the latest) |

The seed only adds a fifth pirate on some visits, so the 20 runs fall into two outcomes. From the last broadside to the
bridge the hulls close in silence for about 38 s. That is the boarding approach's docking manoeuvre (pivot, creep
sideways at about 9 units/s, pivot back), and the next PR changes it.
