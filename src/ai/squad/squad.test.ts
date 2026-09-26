import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import type { GameCommand, Unit } from "../../shared/types";
import { assessSquad, createSquadMemory, planSquad, type SquadIntent, type SquadMemory, type SquadOptions } from "./squad";

function field() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.buildings = [];
  return game;
}

type Game = ReturnType<typeof field>;

// Plays the squad for `ticks`, thinking every 10 ticks as the AI runner does; the enemy just stands (or does what its
// own squad says when one is given).
function play(game: Game, ids: string[], intent: SquadIntent, ticks: number, options: SquadOptions = {}, memory: SquadMemory = createSquadMemory()) {
  let report = planSquad(snapshotGame(game), "player", ids, intent, memory, options).report;
  for (let tick = 0; tick < ticks; tick += 1) {
    if (tick % 10 === 0) {
      const plan = planSquad(snapshotGame(game), "player", ids, intent, memory, options);
      report = plan.report;
      for (const command of plan.commands) issuePlayerCommand(game, "player", command);
    }
    stepGame(game);
  }
  return { memory, report };
}

function alive(game: Game, units: Unit[]) {
  return units.filter((unit) => game.units.includes(unit) && unit.hp > 0).length;
}

describe("squad", () => {
  it("weighs itself against the foes around it by what they fight with", () => {
    const game = field();
    const squad = [0, 1, 2, 3].map((index) => game.spawnUnit("player", "footman", 500, 400 + index * 40));
    game.spawnUnit("enemy", "footman", 700, 450);
    game.spawnUnit("enemy", "footman", 2_000, 450);
    const odds = assessSquad(snapshotGame(game), "player", squad);
    expect(odds.own).toBeCloseTo(4, 5);
    expect(odds.foeStrength).toBeCloseTo(1, 5);
    expect(odds.foes).toHaveLength(1);
  });

  it("holds its point and destroys a weaker group that comes within its leash", () => {
    const game = field();
    const squad = [0, 1, 2, 3].map((index) => game.spawnUnit("player", "footman", 500, 400 + index * 40));
    const foes = [0, 1].map((index) => game.spawnUnit("enemy", "footman", 800, 440 + index * 40));
    const { report } = play(game, squad.map((unit) => unit.id), { kind: "hold", at: { x: 500, y: 460 } }, 400);
    expect(alive(game, foes)).toBe(0);
    expect(alive(game, squad)).toBeGreaterThanOrEqual(3);
    expect(report.state).toBe("advance");
  });

  it("falls back from a fight it cannot win, and puts every blow on one target while it fights", () => {
    const game = field();
    const squad = [0, 1].map((index) => game.spawnUnit("player", "footman", 500, 440 + index * 40));
    [0, 1, 2, 3, 4].forEach((index) => game.spawnUnit("enemy", "footman", 650, 400 + index * 40));
    const memory = createSquadMemory();
    const plan = planSquad(snapshotGame(game), "player", squad.map((unit) => unit.id), { kind: "attack", at: { x: 1_500, y: 480 } }, memory, { retreatTo: { x: 100, y: 480 } });
    expect(plan.report.state).toBe("fallback");
    expect(plan.commands).toEqual([expect.objectContaining({ type: "move", x: 100, y: 480 })]);

    const even = field();
    const archers = [0, 1, 2].map((index) => even.spawnUnit("player", "archer", 400, 420 + index * 40));
    even.spawnUnit("enemy", "footman", 700, 460);
    even.spawnUnit("enemy", "archer", 760, 520);
    const fighting = planSquad(snapshotGame(even), "player", archers.map((unit) => unit.id), { kind: "attack", at: { x: 1_500, y: 460 } }, createSquadMemory());
    expect(fighting.report.state).toBe("fight");
    const attacks = fighting.commands.filter((command): command is Extract<GameCommand, { type: "attack" }> => command.type === "attack");
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.unitIds).toHaveLength(3);
  });

  it("switches on the abilities its units carry", () => {
    const game = field();
    const priest = game.spawnUnit("player", "priest", 500, 500);
    const footman = game.spawnUnit("player", "footman", 540, 500);
    issuePlayerCommand(game, "player", { type: "setAutocast", unitIds: [priest.id], ability: "heal", enabled: false });
    const plan = planSquad(snapshotGame(game), "player", [priest.id, footman.id], { kind: "hold", at: { x: 500, y: 500 } }, createSquadMemory());
    expect(plan.commands).toContainEqual({ type: "setAutocast", unitIds: [priest.id], ability: "heal", enabled: true });
    expect(planSquad(snapshotGame(game), "player", [priest.id], { kind: "hold", at: { x: 500, y: 500 } }, createSquadMemory(), { skills: "leave" }).commands.some((command) => command.type === "setAutocast")).toBe(false);
  });

  it("walks its patrol route in a loop and keeps by the unit it escorts", () => {
    const game = field();
    const guards = [0, 1].map((index) => game.spawnUnit("player", "footman", 500, 500 + index * 30));
    const route = [
      { x: 500, y: 500 },
      { x: 900, y: 500 },
    ];
    const { memory } = play(game, guards.map((unit) => unit.id), { kind: "patrol", route }, 20);
    expect(memory.waypoint).toBe(1);
    expect(guards[0]!.order).toMatchObject({ type: "attackMove", x: 900, y: 500 });

    const escort = field();
    const ward = escort.spawnUnit("player", "worker", 1_200, 800);
    const guard = escort.spawnUnit("player", "footman", 500, 500);
    const plan = planSquad(snapshotGame(escort), "player", [guard.id], { kind: "escort", unitId: ward.id }, createSquadMemory());
    expect(plan.commands).toEqual([expect.objectContaining({ type: "attackMove", x: 1_200, y: 800 })]);
  });

  it("hunts its prey past other foes", () => {
    const game = field();
    const riders = [0, 1, 2].map((index) => game.spawnUnit("player", "footman", 500, 440 + index * 40));
    game.spawnUnit("enemy", "footman", 560, 300);
    const prey = game.spawnUnit("enemy", "archer", 700, 480);
    const plan = planSquad(snapshotGame(game), "player", riders.map((unit) => unit.id), { kind: "hunt", targetIds: [prey.id] }, createSquadMemory());
    expect(plan.report.focusId).toBe(prey.id);
  });
});
