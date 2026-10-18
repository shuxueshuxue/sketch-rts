# Boarding run-in: measured, then dropped (2026-10-18)

The plan: a ship sent to board from far off sails in under canvas before switching to the precise docking. It was
meant to shorten the home pirate battle's silent close (about 38 s) and the slow sideways creep of boarding in matches.
These measurements ruled it out; the cause is in sailing navigation. This branch keeps the record for a navigation
project. No PR.

## Measurement
Two ships of the line on open water. The boarder starts at the given offset from the target ship's centre, both on
heading 0, wind 36 from one beam or the other, with one footman on the boarder's deck. The time is from the
`boardShip` order to the bridge being `ready`. Probe: `run-in-timing.test.ts.txt` (a vitest file for `src/shared`).

| Start (out, along) | Wind | Main | Staging astern of the berth | Far-only (`far-only-variant.diff`) |
| --- | --- | --- | --- | --- |
| 400, 0 | +beam | 40.6 s | 64.8 s | 40.6 s |
| 600, 0 | +beam | 96.7 s | 85.0 s | 96.7 s |
| 400, -400 | +beam | 37.5 s | 42.8 s | 37.5 s |
| 800, -800 | +beam | never (180 s) | 102.8 s | 159.8 s |
| 300, +300 | +beam | 47.0 s | 76.1 s | 47.0 s |
| 400, 0 | -beam | 40.6 s | 73.7 s | 40.6 s |
| 600, 0 | -beam | 73.0 s | 78.3 s | 73.0 s |
| 400, -400 | -beam | 37.0 s | 42.2 s | 37.0 s |
| 800, -800 | -beam | 116.8 s | 68.0 s | 104.8 s |
| 300, +300 | -beam | 47.0 s | 76.3 s | 47.0 s |

The two variants:
- **Staging astern of the berth:** sail an ordinary course to a point half a length astern of the berth, on its line,
  unless already lined up in the corridor astern of it; then dock. A ship abreast of or ahead of the berth has to sail
  backwards first, so most starts get slower.
- **Far-only:** when more than 1.5 lengths from the berth, sail straight toward it and stop a length short; then dock.
  It is identical to main up close and helps only far starts.

## Cause
Neither variant reaches the moderate abeam case (400-600 out), which is what both the home scene and match boarding
mostly look like. Two sailing navigation rules set the time there, not the boarding code:

1. `sailToward` treats any goal within two ship lengths as a precise contact goal (`sailing.ts`, `contact` in
   `replan`), even one without a heading. That goal goes to the precise planner (`planShipRoute`, mode `precise`):
   pivot from rest, then creep at about 9 units/s. A staging point in front of the docking falls inside the same rule.
2. A ship of the line pivots from rest at about 0.13 rad/s, so 90 degrees takes about 12 s, and a precise route stops to
   pivot at its turns. From abreast a sailing hull must turn away and back again: 20 s or more before any travel.

Whoever takes this on should start from how far out a goal counts as precise contact, and whether a precise route can
make way under sail instead of creeping. Either change alters every ship's berthing (unloading and dock arrival too).
