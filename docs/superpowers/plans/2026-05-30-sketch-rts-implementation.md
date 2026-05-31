# Sketch RTS Implementation Ledger

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable pure-TypeScript browser RTS vertical slice with large map, economy, buildings, soldiers, neutral camps, enemy AI, drag selection, and minimap.

**Architecture:** Shared TypeScript simulation code defines all game truth. The Node server owns one match, advances a fixed tick loop, accepts WebSocket commands, and broadcasts snapshots. The Vite client renders the world with Canvas 2D and sends input commands.

**Tech Stack:** TypeScript, Vite, Express, ws, Vitest, Canvas 2D.

---

## File Structure

- `src/shared/types.ts`: public simulation data types, commands, snapshots.
- `src/shared/map.ts`: large sample map creation.
- `src/shared/sim.ts`: deterministic simulation tick, commands, economy, combat, AI.
- `src/shared/sim.test.ts`: behavior tests for core gameplay.
- `src/server/index.ts`: Express static server and WebSocket game loop.
- `src/client/main.ts`: browser input, rendering, command panel, minimap.
- `src/client/styles.css`: grass-paper RTS presentation.
- `index.html`: Vite entry.

## Current Status

The early vertical-slice plan below is complete. The live source of truth for requirements is `docs/superpowers/specs/2026-05-30-sketch-rts-design.md`; the current proof ledger is `docs/superpowers/specs/2026-05-30-sketch-rts-coverage.md`; the architecture proof narrative is `docs/architecture/sketch-rts-systems.md`.

Latest verification evidence:

- `npm run build`
- `npm test -- --run`
- `npm run test:sdk-smoke`
- `npm run test:sdk-ai-matrix`
- `npm run test:ai-matrix`
- `npm run test:e2e-brutal`
- `npm run test:yatu`

Cleanup evidence after the run: no listeners on `5173`, `5174`, `5175`, or `5176`; no Sketch RTS server, Vitest, Playwright, or YATU browser processes left running; Playwright CLI artifacts moved to `~/share/ops/sketch-rts-yatu`.

## Original Tasks

### Task 1: Project Skeleton And Red Tests

- [x] Create package/config files for Vite, TypeScript, Vitest, and the Node server.
- [x] Write failing tests in `src/shared/sim.test.ts` for mining, building, production, combat, AI attack pressure, and large map size.
- [x] Run `npm test -- --run` and verify the failure is caused by missing simulation implementation.

### Task 2: Simulation Core

- [x] Implement `types.ts`, `map.ts`, and `sim.ts` with fixed-step world updates.
- [x] Support command handling for move, attack, mine, build barracks, train worker, train soldier.
- [x] Implement simple enemy AI through the same world state primitives.
- [x] Run `npm test -- --run` and fix until the sim tests pass.

### Task 3: Server Loop

- [x] Implement an Express server that serves the Vite build in production and exposes WebSocket `/ws`.
- [x] Advance one shared match at a fixed interval and broadcast compact snapshots.
- [x] Fail loudly on malformed command payloads by sending an error frame instead of silently ignoring it.

### Task 4: Browser Game Client

- [x] Implement Canvas rendering for the large map, units, buildings, mines, neutral camps, selection rectangle, command panel, and minimap.
- [x] Implement mouse camera pan, drag select, right-click contextual commands, minimap click navigation, build and train buttons.
- [x] Keep the style as grass-paper sketch symbols rather than sprite art.

### Task 5: Verification

- [x] Run `npm test -- --run`.
- [x] Run `npm run build`.
- [x] Run the local dev server.
- [x] Use browser automation as YATU proof: load the game, select workers, mine, build barracks, train soldiers, fight a wildling, and inspect minimap behavior.
