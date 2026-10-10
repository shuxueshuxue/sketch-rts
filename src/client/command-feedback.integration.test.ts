import { describe, expect, it } from "vitest";
import { createBuilding } from "../shared/map";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import { checksumGame } from "../shared/sim/checksum";
import { setBuildingBodies } from "../shared/terrain";
import type { GameCommand, WorldEffect } from "../shared/types";
import { isCommandFeedback, shouldRenderCommandFeedback } from "./command-feedback";
import { shouldRenderBuildingRally } from "./rally-visual";

function field() {
  const game = createGame("bareDuel", { players: ["us", "ally", "enemy"], aiPlayers: [], teams: { us: "blue", ally: "blue", enemy: "red" } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.shops = [];
  game.map = { ...game.map, width: 3200, height: 2400, terrain: { cell: 32, cols: 100, rows: 75, cells: ".".repeat(7500) } };
  game.scriptedVictory = true;
  for (const owner of game.activePlayers) game.players[owner]!.gold = 10000;
  return game;
}

describe("private order feedback from actual commands", () => {
  it("keeps both players’ queued, follow, mine, attack and rally receipts private, including between allies", () => {
    const game = field(), mine = { id: "gold", kind: "goldMine" as const, x: 1600, y: 1200, amount: 10000 };
    game.resources.push(mine);
    const actors = ["us", "ally", "enemy"].map((owner, i) => ({
      owner,
      worker: game.spawnUnit(owner, "worker", 300 + i * 800, 300),
      fighter: game.spawnUnit(owner, "footman", 400 + i * 800, 300),
      friend: game.spawnUnit(owner, "footman", 500 + i * 800, 300),
      hall: createBuilding(`hall-${owner}`, owner, "townHall", 400 + i * 800, 800, true),
    }));
    game.buildings = actors.map(actor => actor.hall); setBuildingBodies(game.map, game.buildings);
    for (const actor of actors) {
      const target = actors.find(other => other.owner === (actor.owner === "enemy" ? "us" : "enemy"))!.fighter;
      const commands: GameCommand[] = [
        { type: "move", unitIds: [actor.fighter.id], x: 1200, y: 500 },
        { type: "move", unitIds: [actor.fighter.id], x: 1300, y: 500, queued: true },
        { type: "attackMove", unitIds: [actor.fighter.id], x: 1400, y: 500 },
        { type: "attackMove", unitIds: [actor.fighter.id], x: 1500, y: 500, queued: true },
        { type: "attack", unitIds: [actor.fighter.id], targetId: target.id },
        { type: "attack", unitIds: [actor.fighter.id], targetId: target.id, queued: true },
        { type: "follow", unitIds: [actor.fighter.id], targetId: actor.friend.id },
        { type: "follow", unitIds: [actor.fighter.id], targetId: actor.friend.id, queued: true },
        { type: "mine", unitIds: [actor.worker.id], resourceId: mine.id },
        { type: "mine", unitIds: [actor.worker.id], resourceId: mine.id, queued: true },
        { type: "setRally", buildingIds: [actor.hall.id], x: mine.x, y: mine.y, target: { type: "resource", resourceId: mine.id } },
      ];
      for (const command of commands) {
        const before = game.effects.length;
        issuePlayerCommand(game, actor.owner, command);
        const receipt = game.effects.slice(before);
        expect(receipt.length, `${actor.owner} ${command.type}`).toBeGreaterThan(0);
        for (const effect of receipt) {
          expect(effect.owner).toBe(actor.owner);
          expect(isCommandFeedback(effect)).toBe(true);
          expect(shouldRenderCommandFeedback(effect, actor.owner)).toBe(true);
          for (const other of actors.filter(other => other.owner !== actor.owner)) expect(shouldRenderCommandFeedback(effect, other.owner)).toBe(false);
          expect(shouldRenderCommandFeedback(effect)).toBe(false);
        }
      }
      expect(shouldRenderBuildingRally({ selected: true, trainable: true, owner: actor.hall.owner, viewer: "us" })).toBe(actor.owner === "us");
    }
    const saved = snapshotGame(game), before = checksumGame(game);
    for (const viewer of ["us", "ally", "enemy", undefined]) saved.effects.filter(effect => shouldRenderCommandFeedback(effect, viewer));
    expect(checksumGame(game)).toBe(before);
    expect(snapshotGame(game)).toEqual(saved);
  });

  it("hides out-of-range and queued spell destinations while retaining the enemy’s actual spell", () => {
    const game = field();
    for (const [i, owner] of ["us", "enemy"].entries()) {
      const caster = game.spawnUnit(owner, "priest", 300, 400 + i * 700), patient = game.spawnUnit(owner, "footman", 1800, caster.y);
      patient.hp -= 20; caster.autocast = { heal: false };
      for (const queued of [false, true]) {
        const before = game.effects.length;
        issuePlayerCommand(game, owner, { type: "cast", unitId: caster.id, ability: "heal", targetId: patient.id, queued });
        const receipt = game.effects.slice(before);
        expect(receipt).toHaveLength(1);
        expect(receipt[0]).toMatchObject({ type: queued ? "queuedMove" : "move", owner });
        expect(shouldRenderCommandFeedback(receipt[0]!, owner)).toBe(true);
        expect(shouldRenderCommandFeedback(receipt[0]!, owner === "us" ? "enemy" : "us")).toBe(false);
      }
    }
    const caster = game.spawnUnit("enemy", "priest", 2400, 1800), patient = game.spawnUnit("enemy", "footman", 2480, 1800);
    patient.hp -= 20; caster.autocast = { heal: false };
    const hp = patient.hp;
    issuePlayerCommand(game, "enemy", { type: "cast", unitId: caster.id, ability: "heal", targetId: patient.id });
    const spell = game.effects.find(effect => effect.type === "heal")!;
    expect(spell).toBeDefined(); expect(patient.hp).toBeGreaterThan(hp);
    expect(isCommandFeedback(spell)).toBe(false);
    expect(shouldRenderCommandFeedback(spell, "us")).toBe(true);
    expect(shouldRenderCommandFeedback(spell)).toBe(true);
  });

  it("preserves the opponent’s actual repair strokes while hiding the repair command receipt", () => {
    const game = field(), building = createBuilding("damaged-farm", "enemy", "farm", 2256, 816, true);
    building.hp -= 30; game.buildings = [building]; setBuildingBodies(game.map, game.buildings);
    const worker = game.spawnUnit("enemy", "worker", building.x - 60, building.y), hp = building.hp;
    issuePlayerCommand(game, "enemy", { type: "repair", unitIds: [worker.id], buildingId: building.id });
    const receipt = game.effects.find(effect => effect.type === "repair" && !effect.unitId)!;
    expect(receipt).toMatchObject({ owner: "enemy" });
    expect(shouldRenderCommandFeedback(receipt, "us")).toBe(false);
    stepGame(game);
    const stroke = game.effects.find(effect => effect.type === "repair" && effect.unitId === worker.id)!;
    expect(stroke).toBeDefined(); expect(building.hp).toBeGreaterThan(hp);
    expect(isCommandFeedback(stroke)).toBe(false);
    expect(shouldRenderCommandFeedback(stroke, "us")).toBe(true);
    expect(shouldRenderCommandFeedback(stroke)).toBe(true);
  });

  it("fails closed for receipts without a trustworthy owner and reevaluates the viewing player", () => {
    const effect: WorldEffect = { id: "saved-receipt", type: "move", x: 100, y: 100, remaining: 10, duration: 24 };
    expect(shouldRenderCommandFeedback(effect, "us")).toBe(false);
    expect(shouldRenderCommandFeedback(effect)).toBe(false);
    effect.owner = "us";
    expect(shouldRenderCommandFeedback(effect, "us")).toBe(true);
    expect(shouldRenderCommandFeedback(effect, "ally")).toBe(false);
    expect(shouldRenderCommandFeedback(effect)).toBe(false);
    expect(shouldRenderCommandFeedback({ ...effect, owner: "neutral" }, "neutral")).toBe(false);
  });
});
