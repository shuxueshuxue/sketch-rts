import { describe, expect, it } from "vitest";
import { applyCommandFrame, stepCommandFrame } from "./frame";
import { checksumGame } from "./checksum";
import { canonicalGameState } from "./canonical";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type Game } from "../sim";
import { createBuilding } from "../map";
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

  it("keeps direct sim commands fail-loud for unknown unit ids", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });

    expect(() => issuePlayerCommand(game, "player", { type: "move", unitIds: ["missing-worker"], x: 600, y: 600 })).toThrow(/Unknown player unit missing-worker/);
  });

  it("treats stale command-frame unit ids as an empty current issuer set", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    game.units = game.units.filter((unit) => unit.id !== worker!.id);

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 120, y: worker!.y } }],
      }),
    ).not.toThrow();
    expect(game.units.some((unit) => unit.id === worker!.id)).toBe(false);
  });

  it("treats stale command-frame building issuers as no-ops", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(townHall).toBeDefined();
    game.buildings = game.buildings.filter((building) => building.id !== townHall!.id);

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [{ playerId: "player", command: { type: "train", buildingId: townHall!.id, unitKind: "worker" } }],
      }),
    ).not.toThrow();
    expect(game.buildings.some((building) => building.id === townHall!.id)).toBe(false);
  });

  it("keeps structural illegal command-frame rules fail-loud at apply time", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(townHall).toBeDefined();

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [{ playerId: "player", command: { type: "train", buildingId: townHall!.id, unitKind: "footman" } }],
      }),
    ).toThrow(/townHall cannot train footman/);
  });

  it("keeps direct sim ability commands fail-loud for stale targets", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const priest = game.spawnUnit("player", "priest", 900, 900);

    expect(() => issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: "missing-ally" })).toThrow(/Heal requires an allied unit target/);
  });

  it("treats stale command-frame ability targets as no-ops", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    const wounded = game.spawnUnit("player", "footman", 930, 900);
    wounded.hp = 20;
    game.units = game.units.filter((unit) => unit.id !== wounded.id);

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [{ playerId: "player", command: { type: "cast", unitId: priest.id, ability: "heal", targetId: wounded.id } }],
      }),
    ).not.toThrow();
    expect(priest.cooldown).toBe(0);
  });

  it("treats command-frame repair of an already-restored building as a no-op", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(townHall).toBeDefined();
    townHall!.hp = townHall!.maxHp;

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [{ playerId: "player", command: { type: "repair", unitIds: [worker!.id], buildingId: townHall!.id } }],
      }),
    ).not.toThrow();
    expect(worker!.order.type).not.toBe("repair");
  });

  it("treats command-frame build placement occupied by an earlier frame command as a no-op", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const workers = game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker").slice(0, 2);
    expect(workers.length).toBe(2);
    game.players.player.gold = 500;
    const x = 900;
    const y = 900;

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [
          { playerId: "player", command: { type: "build", unitId: workers[0]!.id, buildingKind: "farm", x, y } },
          { playerId: "player", command: { type: "build", unitId: workers[1]!.id, buildingKind: "farm", x, y } },
        ],
      }),
    ).not.toThrow();
    expect(game.buildings.filter((building) => building.owner === "player" && building.kind === "farm" && building.x === x && building.y === y)).toHaveLength(1);
  });

  it("treats command-frame training that loses the same-frame gold race as a no-op", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 100;
    game.players.player.supplyCap = 50;
    const first = createBuilding("player-barracks-a", "player", "barracks", 900, 900, true);
    const second = createBuilding("player-barracks-b", "player", "barracks", 1040, 900, true);
    game.buildings.push(first, second);

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [
          { playerId: "player", command: { type: "train", buildingId: first.id, unitKind: "footman" } },
          { playerId: "player", command: { type: "train", buildingId: second.id, unitKind: "footman" } },
        ],
      }),
    ).not.toThrow();
    expect(first.queue).toHaveLength(1);
    expect(second.queue).toHaveLength(0);
  });

  it("treats command-frame mercenary hire that loses the same-frame stock race as a no-op", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 500;
    game.players.player.supplyCap = 50;
    game.mercenaryCamps = [{ id: "shared-camp", x: 900, y: 900, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }];
    game.spawnUnit("player", "footman", 900, 900);

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [
          { playerId: "player", command: { type: "hire", campId: "shared-camp" } },
          { playerId: "player", command: { type: "hire", campId: "shared-camp" } },
        ],
      }),
    ).not.toThrow();
    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "mercenary")).toHaveLength(1);
  });

  it("treats command-frame pickup of an already-carried item as a no-op", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const first = game.spawnUnit("player", "footman", 900, 900);
    const second = game.spawnUnit("player", "footman", 905, 900);
    game.items.push({ id: "shared-scroll", kind: "guardianScroll", x: 900, y: 900, cooldownRemaining: 0 });

    expect(() =>
      applyCommandFrame(game, {
        roomId: "local",
        tick: game.tick,
        sequence: 0,
        commands: [
          { playerId: "player", command: { type: "pickupItem", unitId: first.id, itemId: "shared-scroll" } },
          { playerId: "player", command: { type: "pickupItem", unitId: second.id, itemId: "shared-scroll" } },
        ],
      }),
    ).not.toThrow();
    expect(game.items.find((item) => item.id === "shared-scroll")?.carrierId).toBe(first.id);
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
