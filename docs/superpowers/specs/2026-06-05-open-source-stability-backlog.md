# Open Source Stability Backlog

## Goal

Before the public open-source release, Sketch RTS needs a short, testable backlog for player-facing control polish, simulation correctness, repair balance, and stronger late-game AI. These items are independent enough to ship as separate PRs, but they share one release bar: no visible command bugs, no misleading effects, no free neutral exploits, and v2 must keep scaling into late economy and tech.

## Issues

### 1. Shift Queued Commands

GitHub issue: [#12](https://github.com/shuxueshuxue/sketch-rts/issues/12)

Add ordinary RTS-style queued commands. Holding Shift while issuing a supported command appends it to the selected unit command queue instead of replacing the current order.

Required surfaces:

- Right-click move/gather/repair/attack-style contextual commands.
- Left-click attack or attack-move style commands from command mode.
- Selection must not accidentally clear queued orders; Shift affects command issuance, not unit selection semantics.
- The shared command-frame path must carry queued commands in both local/static and room/server play.

Acceptance evidence:

- Unit/integration tests prove queued commands execute in order.
- Frontend YATU proves Shift-right-click queues at least two visible commands and the unit follows them sequentially.
- Room/server mode uses the same command-frame path; no single-player-only implementation.

### 2. Remove Upgrade Pop Star

GitHub issue: [#13](https://github.com/shuxueshuxue/sketch-rts/issues/13)

Remove the temporary star burst that appears when a unit upgrades or levels if it can be confused with permanent unit-level stars. Keep the permanent level/star indicators attached to units.

Acceptance evidence:

- Renderer/unit-effect test proves upgrade completion no longer emits the transient star effect.
- Visual/YATU proof confirms permanent level stars still render on leveled units.

### 3. Double-Click Select Same Type

GitHub issue: [#14](https://github.com/shuxueshuxue/sketch-rts/issues/14)

Double-clicking a friendly unit selects nearby same-kind friendly units, matching common RTS selection behavior.

Rules:

- Only same owner and same unit kind.
- Apply within a bounded screen/world radius suitable for ordinary army selection.
- Do not select enemy, neutral, buildings, or units outside the radius.
- Preserve current single-click and drag-select behavior.

Acceptance evidence:

- Client selection tests cover double-click same-kind selection and non-selection cases.
- Playwright CLI YATU double-clicks a worker or footman and verifies the visible selection count.

### 4. Repair Rate And Animation

GitHub issue: [#15](https://github.com/shuxueshuxue/sketch-rts/issues/15)

Repair should be slower and less bursty. Gold drain should match the new repair rate, and the worker hammer animation must have a fixed cadence comparable to initial construction instead of firing every tick or scaling with repair speed.

Acceptance evidence:

- Simulation tests prove repair HP/sec and gold/sec are reduced to the chosen constants.
- Repair cannot silently hide insufficient-gold failures.
- Client/render tests or YATU prove repair hammer cadence is fixed and not per-tick.

### 5. AI Late-Tech Composition

GitHub issue: [#16](https://github.com/shuxueshuxue/sketch-rts/issues/16)

V2 should deliberately reach late-tech unit mixes in appropriate longer games, including priests, witches/curse, summoners if useful, and knights. This must be a real strategic extension, not a benchmark-only lane.

Acceptance evidence:

- Focused late-game AI scenarios prove v2 builds the required tech structures and trains advanced units when economy and army state justify it.
- Benchmark details report late-tech unit counts or command stats.
- The change does not reduce the 1v1 control gate below 90%.

### 6. Neutral Aggro On Ranged Damage

GitHub issue: [#17](https://github.com/shuxueshuxue/sketch-rts/issues/17)

Damaging a neutral unit must aggro that unit even when the attacker is outside ordinary neutral acquisition range. That aggro must trigger the existing nearby-neutral assist/call-for-help chain so ranged units cannot clear camps for free.

Acceptance evidence:

- Simulation tests cover long-range archer damage causing the damaged neutral to attack or chase.
- Nearby camp allies join through the assist chain.
- Target commitment is stable enough to avoid per-damage twitching.

### 7. AI Third And Fourth Expansions

GitHub issue: [#18](https://github.com/shuxueshuxue/sketch-rts/issues/18)

V2 must keep expanding into third and fourth mining bases in longer games when it has the army, worker base, and map state to support them. Two-base stalling should be treated as a late-game economy bug.

Acceptance evidence:

- Focused late-game scenarios prove v2 starts third and fourth town halls under controlled map states.
- Benchmark/details expose first/third/fourth expansion timing.
- 1v1 control remains at least 90%, and 1v2/probe lanes should improve or remain explainably unchanged.

## PR Strategy

Create one issue and one implementation PR per item. Merge each PR only after its own automated checks pass. Use pgl for full AI benchmarks and long sweeps. UI and simulation changes still require YATU through Playwright CLI for player-visible behavior.

For release readiness, the final integration branch must run:

- `npm test -- --run`
- `npm run build`
- relevant Playwright CLI YATU proofs for UI changes
- pgl 1v1 control benchmark with at least 90% success
- pgl dashboard benchmark evidence written to the live dashboard store

## Current Status

Created as release backlog on 2026-06-05. Implementation PRs are pending.
