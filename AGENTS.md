# Sketch RTS Local Agent Workflow

## Product Direction

- Treat the design spec and coverage ledger under `docs/superpowers/specs/` as the project checkpoint ledger. Update them when a new workflow, acceptance gate, or durable proof rule becomes true.
- Do not shrink the RTS spec to make a small slice look complete. Each edit should make the full War3-like, SDK-controllable, replayable RTS more true.
- Prefer prose-style module growth for cross-cutting changes: clarify each module's responsibility, then let the bug disappear through better boundaries instead of adding a one-off patch.

## Playtest Sidecar

- For user playtest requests, prefer a sidecar LAN build instead of reusing the main dev port. Run `npm run build` first, then start `HOST=0.0.0.0 PORT=<port> npm run server`.
- Pick a sidecar port low enough that Vite HMR can add its `+20000` port without exceeding `65535`. Good default: `34573`. Avoid high ports such as `59600`.
- Report both URLs after startup: `http://127.0.0.1:<port>/` for local testing and `http://<LAN-IP>:<port>/` for Wi-Fi/LAN devices.
- Keep the sidecar server running while the user is actively playtesting. Do not kill it as part of ordinary verification cleanup unless the user asks to stop it.
- While a sidecar playtest server is intentionally running, process cleanup checks should distinguish it from accidental background CPU burners.
- LAN HTTP browsers may not expose `crypto.randomUUID()`. Local identity generation must support `crypto.getRandomValues()` as the compatible path and fail loudly only when no browser crypto source exists.

## Replay, Save, And SDK Truth

- Debug replay is command-log infrastructure, not a visual recording. Record ordinary browser commands, SDK-agent commands, and internal-AI commands after they are emitted by the shared policy modules.
- If a room tick path advances AI, it must use the same hosted AI frame helper as SDK fast-forward so replay batches stay equivalent.
- Checkpoint seek must be deterministic: seeking from a checkpoint may skip earlier batches, but the resulting state must match straight replay from the initial save.
- Savegames and replay frame extraction are AI-debugging primitives. Prefer turning a failing large match frame into a save-backed small scene instead of rerunning long matches for every diagnosis.
- Dogfood the TypeScript SDK for external control tests. Use raw `fetch` only when the test is specifically about transport behavior.

## AI Architecture

- AI scripts are reusable policies, not player identities. Internal computer slots and SDK-controlled human slots must import the same policy modules and emit ordinary player commands.
- Do not implement a second "external agent AI" that diverges from internal AI. Adapter differences are allowed; strategic logic duplication is not.
- AI strategy should be condition-driven and mostly stateless. Prefer current snapshot facts over time-based build orders or stale memory.
- Do not improve v2 by weakening v1, adding hidden resources, or exploiting adapter bugs. If v1 or an adapter is broken, fix that first.

## Verification Discipline

- Browser/player claims need YATU-style Playwright CLI or real browser proof. SDK, sim, or source inspection evidence is useful but does not prove visible controls/rendering.
- For new behavior, use TDD where practical: write the failing test, observe the right failure, then implement the smallest real fix.
- After tests or stress scripts, check for accidental background server/test processes and repo-local CPU profiles. Keep intentional playtest sidecars alive.
- Prefer print-based debugging. Show current state, command batches, snapshots, process lists, and relevant counters before judging the fix.
