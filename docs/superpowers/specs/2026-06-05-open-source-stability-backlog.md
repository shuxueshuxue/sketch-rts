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

### 8. Crash-Free Sim, AI, And Lockstep Architecture Audit

GitHub issue: [#20](https://github.com/shuxueshuxue/sketch-rts/issues/20)

Audit the full repository for logic paths where ordinary valid play can throw and terminate the game. The target areas are simulation command application, unit/order execution, AI policy scripts, command-frame lockstep, replay/save/SDK command paths, and client command emission.

This is not a request for broad catch/fallback guards. The goal is to make the command model, ownership model, and frame application boundary strong enough that valid game states and valid player/AI commands cannot produce crashy logic errors. Invalid commands should still fail loudly, but at the correct boundary instead of during ordinary simulation ticks.

Acceptance evidence:

- Inventory explicit throws, unsafe lookups, and invariants across sim, AI, command-frame, SDK/replay, and client command emission.
- Classify each as impossible by construction, invalid external input that should fail before sim, or valid-play crash risk requiring architecture cleanup.
- Add focused failing tests for every valid-play crash risk before changing production code.
- Prove internal AI commands and player commands enter the same validated command-frame path.
- Prove lockstep command-frame application cannot reference stale unit/building ids during ordinary gameplay, or change the command model so it cannot happen.
- Keep fail-loud behavior for truly invalid commands; do not hide errors with silent fallback.
- Run product-level YATU for a real room match after fixes, plus automated test/build verification.

### 9. Browser-Language I18n

GitHub issue: [#24](https://github.com/shuxueshuxue/sketch-rts/issues/24)

Add a small internationalization layer for browser-visible UI text. The first supported locales are English and Chinese. The client should choose the initial locale from browser language preferences: Chinese browser locales show Chinese UI; English or unknown locales show English UI.

Boundaries:

- Locale must stay out of simulation state, replay data, SDK command contracts, AI decisions, and command-frame lockstep.
- User-facing browser UI text should move into translation resources instead of ad-hoc inline strings.
- Map ids, code identifiers, replay ids, and developer-only logs do not need translation.

Acceptance evidence:

- Unit tests cover locale selection fallback and translation lookup behavior.
- Source scan or focused tests prove major browser-visible UI text is tracked by the i18n layer.
- Playwright CLI YATU runs Chinese and English browser-language sessions and verifies the UI switches.
- Existing command-frame, replay, and simulation tests still pass.

### 10. Public In-Game Chat Overlay

GitHub issue: [#25](https://github.com/shuxueshuxue/sketch-rts/issues/25)

Add a public Warcraft-style in-game chat surface. Pressing Enter opens a chat input; submitted messages appear on the left side of the game screen with sender information, then fade out. This slice does not include private chat.

Boundaries:

- Chat transport is separate from deterministic simulation commands.
- Chat must not mutate sim state, replay command frames, AI policy, or lockstep determinism.
- Multiplayer room chat and local/static play should share the same UI component; only the transport edge may differ.
- While the chat input is active, normal game hotkeys and command shortcuts must not fire accidentally.

Acceptance evidence:

- Client tests cover Enter-to-open, submit, Escape/blur behavior, and keyboard isolation while typing.
- Room/server integration tests prove public messages reach all players without entering command-frame batches.
- Playwright CLI YATU verifies two browser clients exchange chat messages during a live room match.
- Visual/YATU evidence confirms left overlay placement, sender labels, and fade-out behavior.
- Existing lockstep/replay/sim tests still pass unchanged for deterministic gameplay.

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
