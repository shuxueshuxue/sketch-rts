import { describe, expect, it } from "vitest";
import { createRoom } from "./rooms";
import { createDebugReplayTrace, extractReplayFrameSave, recordReplayBatch, recordReplayCheckpoint, replayTraceToTick } from "./replay";
import { createSaveGameRecord } from "./savegame";
import { createGame, issuePlayerCommand, stepGame } from "./sim";

const room = {
  ...createRoom({ id: "replay-room", host: { id: "host", name: "Host" }, mapId: "bareDuel" }),
  status: "inMatch" as const,
};

describe("debug replay traces", () => {
  it("rebuilds a deterministic match state from ordered command batches", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const initialSave = createSaveGameRecord(game, room, { id: "replay-initial" }, new Date("2026-05-31T00:00:00.000Z"), []);
    const trace = createDebugReplayTrace({ id: "replay-1", initialSave });
    const command = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 180, y: worker!.y + 20 };

    recordReplayBatch(trace, { tick: game.tick, source: "sdk-agent", commands: [{ playerId: "player", command }] });
    issuePlayerCommand(game, "player", command);
    for (let i = 0; i < 40; i += 1) stepGame(game);

    const replayed = replayTraceToTick(trace, 40);

    expect(replayed.tick).toBe(game.tick);
    expect(replayed.units).toEqual(game.units);
    expect(replayed.buildings).toEqual(game.buildings);
    expect(replayed.resources).toEqual(game.resources);
    expect(replayed.match).toEqual(game.match);
  });

  it("extracts any replay frame into a save-backed regression scene", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const initialSave = createSaveGameRecord(game, room, { id: "replay-initial" }, new Date("2026-05-31T00:00:00.000Z"), []);
    const trace = createDebugReplayTrace({ id: "replay-1", initialSave });
    const command = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 90, y: worker!.y + 90 };
    recordReplayBatch(trace, { tick: 0, source: "test-harness", commands: [{ playerId: "player", command }] });

    const extracted = extractReplayFrameSave(trace, 12, { id: "scene-from-replay", label: "harass bug frame" });

    expect(extracted.id).toBe("scene-from-replay");
    expect(extracted.label).toBe("harass bug frame");
    expect(extracted.snapshot.tick).toBe(12);
    expect(extracted.room.status).toBe("inMatch");
    expect(extracted.runtime.activePlayers).toEqual(initialSave.runtime.activePlayers);
    expect(extracted.snapshot.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("seeks from the nearest checkpoint without replaying earlier batches", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const initialSave = createSaveGameRecord(game, room, { id: "replay-initial" }, new Date("2026-05-31T00:00:00.000Z"), []);
    const trace = createDebugReplayTrace({ id: "replay-1", initialSave });
    const earlyCommand = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 60, y: worker!.y };
    const lateCommand = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 180, y: worker!.y + 30 };

    recordReplayBatch(trace, { tick: 0, source: "test-harness", commands: [{ playerId: "player", command: earlyCommand }] });
    issuePlayerCommand(game, "player", earlyCommand);
    for (let i = 0; i < 12; i += 1) stepGame(game);
    recordReplayCheckpoint(trace, game);
    recordReplayBatch(trace, { tick: game.tick, source: "test-harness", commands: [{ playerId: "player", command: lateCommand }] });
    issuePlayerCommand(game, "player", lateCommand);
    for (let i = 0; i < 8; i += 1) stepGame(game);
    trace.batches[0]!.commands[0]!.command = { type: "move", unitIds: ["missing-unit"], x: 0, y: 0 };

    const replayed = replayTraceToTick(trace, game.tick);

    expect(replayed.tick).toBe(game.tick);
    expect(replayed.units.find((unit) => unit.id === worker!.id)?.order).toEqual(game.units.find((unit) => unit.id === worker!.id)?.order);
  });
});
