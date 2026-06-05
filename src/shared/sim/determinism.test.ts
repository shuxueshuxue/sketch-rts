import { describe, expect, it } from "vitest";
import { applyCommandFrame, stepCommandFrame } from "./frame";
import { checksumGame } from "./checksum";
import { canonicalGameState } from "./canonical";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type Game } from "../sim";
import type { CommandFrame } from "../net/types";

describe("deterministic command-frame simulation", () => {
  it("applies command frames as the shared simulation input", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const frame: CommandFrame = {
      roomId: "local",
      tick: game.tick,
      sequence: 0,
      commands: [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 120, y: worker!.y } }],
    };

    applyCommandFrame(game, frame);

    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("applies queued unit commands through the shared command-frame path", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.units = game.units.filter((unit) => unit === worker || unit.owner !== "player");
    const first = { x: worker.x + 120, y: worker.y };
    const second = { x: worker.x + 240, y: worker.y };

    applyCommandFrame(game, {
      roomId: "local",
      tick: game.tick,
      sequence: 0,
      commands: [
        { playerId: "player", command: { type: "move", unitIds: [worker.id], x: first.x, y: first.y } },
        { playerId: "player", command: { type: "move", unitIds: [worker.id], x: second.x, y: second.y, queued: true } },
      ],
    });

    expect(worker.order).toEqual({ type: "move", x: first.x, y: first.y });
    expect(worker.orderQueue).toEqual([{ type: "move", x: second.x, y: second.y }]);
  });

  it("fails loudly when a command frame targets a different tick", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const frame: CommandFrame = { roomId: "local", tick: game.tick + 1, sequence: 0, commands: [] };

    expect(() => applyCommandFrame(game, frame)).toThrow(/targets tick 1 but game is at tick 0/);
  });

  it("matches direct simulation when the same commands are issued through frames", () => {
    const direct = createGame("bareDuel", { aiPlayers: [] });
    const framed = createGame("bareDuel", { aiPlayers: [] });
    const worker = direct.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const command = { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 180, y: worker!.y + 30 };

    issuePlayerCommand(direct, "player", command);
    const result = stepCommandFrame(framed, {
      roomId: "local",
      tick: framed.tick,
      sequence: 0,
      commands: [{ playerId: "player", command }],
    });
    stepGame(direct);

    expect(result.tick).toBe(framed.tick);
    expect(result.checksum).toBe(checksumGame(framed));
    expect(snapshotGame(framed)).toEqual(snapshotGame(direct));
  });

  it("produces the same checksum for the same seed and command frames", () => {
    const first = runFrameScript();
    const second = runFrameScript();

    expect(second.checksums).toEqual(first.checksums);
    expect(snapshotGame(second.game)).toEqual(snapshotGame(first.game));
  });

  it("canonicalizes runtime state without depending on derived caches or array order", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    stepGame(game);
    const scrambled = {
      ...game,
      units: [...game.units].reverse(),
      buildings: [...game.buildings].reverse(),
      resources: [...game.resources].reverse(),
      mercenaryCamps: [...game.mercenaryCamps].reverse(),
      items: [...game.items].reverse(),
      effects: [...game.effects].reverse(),
    } satisfies Game;
    delete scrambled.unitSpatial;
    delete scrambled.unitSpatialByTeam;
    delete scrambled.buildingSpatial;
    delete scrambled.buildingSpatialByTeam;
    delete scrambled.buildingSpatialCount;
    delete scrambled.entityById;

    expect(canonicalGameState(scrambled)).toEqual(canonicalGameState(game));
    expect(checksumGame(scrambled)).toBe(checksumGame(game));
  });
});

function runFrameScript() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
  expect(worker).toBeDefined();
  const checksums: string[] = [];

  for (let tick = 0; tick < 24; tick += 1) {
    const commands =
      tick === 0
        ? [{ playerId: "player", command: { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 120, y: worker!.y + 40 } }]
        : [];
    stepCommandFrame(game, { roomId: "local", tick: game.tick, sequence: tick, commands });
    checksums.push(checksumGame(game));
  }

  return { game, checksums };
}
