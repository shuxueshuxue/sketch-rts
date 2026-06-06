# Lockstep Command Frame Checkpoint

## Current Truth

The simulation now has a shared command-frame entry layer:

- `src/shared/net/types.ts` defines `CommandFrame`, `CommandEnvelope`, checksum/checkpoint frames, and client/server net messages.
- `src/shared/sim/frame.ts` applies a `CommandFrame` to the existing simulation and can step with a checksum result.
- `src/shared/sim/canonical.ts` defines canonical state that excludes derived runtime caches and sorts id-addressed arrays.
- `src/shared/sim/checksum.ts` hashes that canonical state.
- `src/shared/sim/engine.ts` wraps the existing simulation functions without changing sim semantics.

Replay, savegame, SDK command batching, and room-host commands now move toward the same frame contract:

- Debug replay traces store `frames`, not replay-only `batches`.
- Room-host browser and SDK command paths create hosted `CommandFrame`s before applying commands.
- Hosted internal AI now plans commands without mutating simulation state; room-host creates and applies the authoritative internal-AI `CommandFrame`.
- SDK `issueCommandFrame` constructs and applies a shared `CommandFrame` while preserving per-command hooks.
- Savegame runtime metadata records the deterministic checksum for checkpoint proof.

Network boundaries now have first-pass protocol primitives:

- `src/server/lockstep-room.ts` provides a sim-free `LockstepRoomCoordinator` for command delay, sequence ordering, frame construction, and checksum recording.
- `src/server/spectator-sync.ts` owns the checkpoint/frame retention window for late observers and names the default history length as `DEFAULT_SPECTATOR_FRAME_HISTORY_LIMIT = 240`.
- `src/shared/net/codec.ts` encodes and decodes typed net messages and fails loudly on malformed payloads.
- `src/shared/net/frame-buffer.ts` stores authoritative frames by tick.
- `src/client/net/transport.ts`, `websocket-transport.ts`, and `lockstep-client.ts` define a client adapter path where local commands are sent over transport and simulation advances only after server frames arrive.
- `src/client/net/local-adapter.ts` and `lockstep-client.ts` provide local command-frame stepping and room lockstep sync.
- `src/client/game-adapter.ts` defines the active gameplay adapter boundary; local/static play and room lockstep play share the same `sendCommand` / `currentSnapshot` / `updateToRenderTime` surface in `src/client/main.ts`.

The room WebSocket path is now wired into the running server:

- `/ws/rooms/:roomId` is the server gameplay WebSocket path.
- Bare `/ws` and the removed global session socket are rejected by the server upgrade classifier.
- `src/server/room-net.ts` accepts typed room messages, sends `hello` and `checkpoint`, records checksums, accepts delayed client commands, broadcasts authoritative frames, and advances the room through `tickRoomFrame`.
- `src/server/room-net.ts` retains recent authoritative checkpoints and frames so a late observer can request an older checkpoint and replay the frames after it.
- `src/server/room-host.ts` exposes `tickRoomFrame` and `checkpointRoom`; connected lockstep rooms can be excluded from the ordinary active-room ticker so they are not double-stepped.
- `src/client/net/lockstep-client.ts` restores checkpoint snapshots into its existing engine, discards buffered frames older than the restored tick, and still advances simulation only from server frames.
- `src/client/main.ts` starts room matches through `LockstepClient`; room commands no longer call the HTTP room command endpoint, and room gameplay no longer polls HTTP snapshots.
- Public in-match rooms now stay visible in the room browser as spectator entries; spectators connect through room WebSocket without claiming a player slot or POSTing `/join`.

Frontend world state has one authority:

- The active `GameAdapter` snapshot is gameplay truth for local/static play and hosted room play.
- `selectedIds`, `focusedSelectionId`, control groups, debug view, and canvas render data are UI projection only.
- `src/client/frontend-world-view.ts` materializes the active adapter snapshot and prunes selected/control-group ids from that snapshot.
- `src/client/main.ts` must refresh that projection before command construction entrypoints read selected/focused ids. A visible entity or remembered selection id cannot be treated as command authority until it has survived the latest adapter snapshot materialization.

## Checkpoint Semantics

Normal room play advances through authoritative command frames. Checkpoints are synchronization boundaries, not a routine replacement for applying frames.

Checkpoint requests carry a reason. The server records that reason with a semantic class and annotates the checkpoint response with the same reason/class so client restore events are attributed by server metadata, not by client-side guessing:

- `initial-sync` -> `initial`: a player or spectator is joining and needs authoritative state before consuming frames.
- `late-catchup` -> `catchup`: a late observer requests a retained checkpoint and replay window.
- `manual` -> `manual`: an explicit developer/user diagnostic request.
- `frame-apply-error`, `server-desync`, and `message-error` -> `recovery`: a sync fault occurred and the client is asking to recover from server truth.

Recovery checkpoints are incidents. They must stay visible through room sync events and the `/api/rooms/:roomId/sync-events` summary. A release or YATU run with recovery checkpoint growth should be treated as evidence to investigate, not as proof that lockstep is healthy.

## Evidence

Final automated verification passed:

```bash
npm test -- --run
```

Result: 70 test files, 533 tests passed.

Build passed:

```bash
npm run build
```

Result: TypeScript `tsc --noEmit` passed and Vite production build completed.

Backend WebSocket proof passed against a real local server on port `5187`:

```json
{
  "helloTick": 0,
  "checkpointTick": 0,
  "commandFrameTick": 2,
  "commandFrameSequence": 2,
  "commandCount": 1,
  "afterTick": 3,
  "workerOrder": { "type": "move", "x": 1295, "y": 460 }
}
```

Frontend YATU proof passed through Playwright CLI against a real local server on port `5188`. It created and started a room through the browser UI, issued a move command by mouse, and verified the active match used room WebSocket traffic instead of HTTP polling/commands:

```json
{
  "httpRoomCommands": [],
  "httpRoomSnapshots": [],
  "wsRoomFrames": 12,
  "wsRoomCommands": 1,
  "ticks": [1, 4],
  "finalStatus": "Move order issued."
}
```

Playwright CLI artifacts were moved out of the repo to `~/share/ops/sketch-rts-yatu/`.

Late-observer backend proof passed against a real local server on port `5191`. A live room socket advanced frames, then a separate observer socket requested checkpoint tick `2` and received retained frames starting from that checkpoint:

```json
{
  "roomId": "proof-1780393006077",
  "liveFrames": [1, 2, 3, 4, 5, 6],
  "checkpointTick": 2,
  "retainedPrefix": [2, 3, 4, 5],
  "observerFrameCount": 8
}
```

Spectator frontend YATU proof passed through Playwright CLI against a real local server on port `5192`. A non-slot viewer opened the room browser, saw the live public room as `watch live`, entered without POSTing `/join`, and advanced from room WebSocket frames:

```json
{
  "joinPosts": [],
  "wsRoomFrames": 7,
  "wsRoomMessages": ["hello", "checkpoint", "frame", "frame", "frame", "frame", "frame", "frame", "frame"],
  "view": { "roomId": "spectator-yatu-human-1780394081845", "tick": 987 },
  "buttons": [
    {
      "text": "Spectator YATU Human Live bareDuel · inMatch · 2 active · watch live",
      "roomId": "spectator-yatu-human-1780394081845"
    }
  ]
}
```

Adapter frontend YATU proof passed through Playwright CLI against a real local server on port `5193`. After the `GameAdapter` extraction, a non-slot viewer still entered a live public match through the room browser, did not POST `/join`, and advanced from room WebSocket frames:

```json
{
  "joinPosts": [],
  "wsRoomFrames": 5,
  "view": { "roomId": "adapter-spectator-yatu-1780394727056", "tick": 1110 },
  "buttons": [
    {
      "text": "Adapter Spectator Live bareDuel · inMatch · 2 active · watch live",
      "roomId": "adapter-spectator-yatu-1780394727056"
    }
  ]
}
```

## Remaining Work

- GitHub #38 still needs broad frontend YATU stress for visual/client-state sync.
- GitHub #42 removes old global session gameplay APIs; closure still needs post-merge verification evidence.
- GitHub #43 still needs explicit proof that static and server deployments share one gameplay core.
