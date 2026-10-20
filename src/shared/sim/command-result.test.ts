import { describe, expect, it } from "vitest";
import { CommandRefusedError, createGame, issuePlayerCommand, tryPlayerCommand } from "../sim";
import { applyCommandFrame } from "./frame";
import type { GameCommand } from "../types";

// See @@@command-result: the check judges a command once, and the sim, the frame path and the throwing callers read
// the same refusal.
describe("command result", () => {
  function scene() {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.spawnUnit("player", "worker", 900, 900);
    const hall = game.buildings.find((building) => building.owner === "player")!;
    return { game, worker, hall };
  }

  it("returns a refusal with its reason without changing the order", () => {
    const { game, worker, hall } = scene();
    const command: GameCommand = { type: "repair", unitIds: [worker.id], buildingId: hall.id };
    expect(tryPlayerCommand(game, "player", command)).toEqual({ ok: false, message: `${hall.kind} is already fully repaired`, transient: true, reason: "state", refusal: { reason: "condition-unmet", detail: { category: "state" } } });
    expect(worker.order.type).toBe("idle");
    hall.hp -= 10;
    expect(tryPlayerCommand(game, "player", command)).toEqual({ ok: true });
    expect(worker.order.type).toBe("repair");
  });

  it("refuses a building the player cannot pay for in the check's own words", () => {
    const { game, worker } = scene();
    game.players.player!.gold = 0;
    const command: GameCommand = { type: "build", unitId: worker.id, buildingKind: "farm", x: 1300, y: 1300 };
    const result = tryPlayerCommand(game, "player", command);
    expect(result).toMatchObject({ ok: false, reason: "gold", transient: true });
    expect(result.ok ? "" : result.message).toMatch(/^Need \d+ gold$/);
    let thrown: unknown;
    try { issuePlayerCommand(game, "player", command); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(CommandRefusedError);
    expect((thrown as CommandRefusedError).refusal).toEqual(result);
  });

  it("lets a frame skip a refusal a later tick could lift and fail on any other", () => {
    const { game, worker, hall } = scene();
    const frame = (command: GameCommand) => ({ roomId: "test", tick: game.tick, sequence: 0, commands: [{ playerId: "player", command }] });
    expect(() => applyCommandFrame(game, frame({ type: "repair", unitIds: [worker.id], buildingId: hall.id }))).not.toThrow();
    expect(() => applyCommandFrame(game, frame({ type: "setAutocast", unitIds: [worker.id], ability: "pinningBolt", enabled: true }))).toThrow("pinningBolt cannot be autocast");
  });
});
