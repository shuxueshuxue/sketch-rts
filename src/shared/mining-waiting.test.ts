import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from "./sim";
import { createUnit } from "./map";
import { MAP_POOL } from "./map-pool";
import { GOLD_MINE_RULES } from "./mining";
import { seconds } from "./time";
import { shove, isStaggered } from "./push";
import { isStunned } from "./unit-abilities";
import type { MapId } from "./types";

/** Actual starting workers and buildings; camps have already been cleared. */
function haul(map: MapId, count: number) {
  const seats = MAP_POOL.find(spec => spec.id === map)?.players ?? 2;
  const game = createGame(map, { players: ["player", ...Array.from({ length: seats - 1 }, (_, i) => `opponent${i}`)], aiPlayers: [] });
  const hall = game.buildings.find(building => building.owner === "player" && building.kind === "townHall")!;
  const mine = game.resources.find(resource => resource.id === "gold-player-main")!;
  const initial = game.units.filter(unit => unit.owner === "player" && unit.kind === "worker");
  const workers = Array.from({ length: count }, (_, i) => initial[i] ?? createUnit(`additional-${i}`, "player", "worker", hall.x + 80, hall.y + 50 + (i - 3) * 20));
  game.units = workers;
  game.players.player!.gold = 0;
  mine.amount = 100000;
  game.scriptedVictory = true;
  const command = { type: "mine", resourceId: mine.id, unitIds: workers.map(worker => worker.id) } as const;
  issuePlayerCommand(game, "player", command);
  return { game, hall, mine, workers, command };
}

describe("mining progress and undersaturated queues", () => {
  it.each(["stun", "stagger"] as const)("lets healthy workers enter past a %s queue leader and lets that worker recover", control => {
    const { game, mine, workers, command } = haul("bareDuel", 3);
    // A group has reached the mine mouth together; the first waiting worker
    // is hit while the two behind it remain able to work.
    workers.forEach((worker, i) => Object.assign(worker, { x: mine.x - 40, y: mine.y + i * 3 }));
    issuePlayerCommand(game, "player", command);
    const leader = workers[0]!;
    if (control === "stun") leader.effects.push({ type: "stun", remaining: seconds(3) });
    else shove(leader, 0, 1, 100);
    expect(control === "stun" ? isStunned(leader) : isStaggered(leader)).toBe(true);
    stepGame(game);
    expect(workers[1]!.order, "a disabled waiter must not reserve an otherwise available entrance").toMatchObject({ phase: "gather" });
    expect(leader.order).toMatchObject({ phase: "toMine", timer: 0 });
    const restored = createGame("bareDuel", { aiPlayers: [] });
    restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    const delivered = new Set<string>();
    for (let tick = 0; tick < seconds(20); tick++) {
      const carrying = workers.filter(worker => worker.carryingGold > 0).map(worker => worker.id);
      stepGame(game);
      stepGame(restored);
      for (const id of carrying) if (workers.find(worker => worker.id === id)!.carryingGold === 0) delivered.add(id);
      expect(mine.amount + workers.reduce((sum, worker) => sum + worker.carryingGold, 0) + game.players.player!.gold).toBe(100000);
    }
    expect(delivered.size).toBe(3);
    expect(isStunned(leader) || isStaggered(leader)).toBe(false);
    expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  });

  it.each(["verdantCrossroads", "bareDuel", ...MAP_POOL.map(map => map.id)] as const)("keeps 1–4 workers cycling on %s and reaches saturation with the fifth", map => {
    const income: number[] = [];
    for (let count = 1; count <= 6; count++) {
      const { game, mine, workers } = haul(map, count);
      const waiting = workers.map(() => 0), delivered = workers.map(() => 0);
      let gold = 0, maxSteadyWait = 0, conserved = true;
      for (let tick = 0; tick < seconds(90); tick++) {
        const before = workers.map(worker => ({ x: worker.x, y: worker.y, load: worker.carryingGold }));
        stepGame(game);
        if (tick === seconds(30) - 1) gold = game.players.player!.gold;
        for (let i = 0; i < workers.length; i++) {
          const worker = workers[i]!, old = before[i]!;
          const queued = worker.order.type === "mine" && worker.order.phase === "toMine"
            && Math.hypot(worker.x - old.x, worker.y - old.y) < .01
            && Math.hypot(worker.x - mine.x, worker.y - mine.y) <= GOLD_MINE_RULES.entryRange;
          waiting[i] = queued ? waiting[i]! + 1 : 0;
          if (tick >= seconds(30)) {
            maxSteadyWait = Math.max(maxSteadyWait, waiting[i]!);
            if (old.load > 0 && worker.carryingGold === 0) delivered[i]! += old.load;
          }
        }
        conserved &&= mine.amount + workers.reduce((sum, worker) => sum + worker.carryingGold, 0) + game.players.player!.gold === 100000;
      }
      expect(conserved, `${map}/${count}: every complete haul conserves gold`).toBe(true);
      expect(delivered.every(amount => amount > 0), `${map}/${count}: each worker actually unloads`).toBe(true);
      if (count < 5) expect(maxSteadyWait, `${map}/${count}: initial batching is separate from recurring waiting`).toBeLessThanOrEqual(seconds(.3));
      income.push(game.players.player!.gold - gold);
    }
    for (let count = 1; count < 5; count++) expect(income[count]!, `${map}: worker ${count + 1} improves delivered income`).toBeGreaterThan(income[count - 1]!);
    expect(income[4]!).toBeGreaterThanOrEqual(390);
    expect(Math.abs(income[5]! - income[4]!)).toBeLessThanOrEqual(10);
  });

  it.each([0, Math.PI / 4])("keeps the nearest legal 210-unit haul productive at heading %s", heading => {
    const income: number[] = [];
    for (let count = 1; count <= 6; count++) {
      const { game, hall, mine, workers } = haul("bareDuel", count);
      mine.x = hall.x + Math.cos(heading) * GOLD_MINE_RULES.townHallDistance;
      mine.y = hall.y + Math.sin(heading) * GOLD_MINE_RULES.townHallDistance;
      let gold = 0;
      for (let tick = 0; tick < seconds(90); tick++) {
        stepGame(game);
        if (tick === seconds(30) - 1) gold = game.players.player!.gold;
      }
      expect(mine.amount + workers.reduce((sum, worker) => sum + worker.carryingGold, 0) + game.players.player!.gold).toBe(100000);
      income.push(game.players.player!.gold - gold);
    }
    for (let count = 1; count < 5; count++) expect(income[count]!).toBeGreaterThan(income[count - 1]!);
    expect(income[4]!).toBeGreaterThanOrEqual(390);
    expect(Math.abs(income[5]! - income[4]!)).toBeLessThanOrEqual(10);
  });

  it("does not restart gathering or drop income when the same mine is right-clicked every second", () => {
    const ordinary = haul("bareDuel", 3), repeated = haul("bareDuel", 3);
    for (let tick = 0; tick < seconds(60); tick++) {
      if (tick % seconds(1) === 0) issuePlayerCommand(repeated.game, "player", repeated.command);
      stepGame(ordinary.game);
      stepGame(repeated.game);
      expect(repeated.mine.amount + repeated.workers.reduce((sum, worker) => sum + worker.carryingGold, 0) + repeated.game.players.player!.gold).toBe(100000);
    }
    expect(repeated.game.players.player!.gold).toBeGreaterThanOrEqual(200);
    expect(repeated.game.players.player!.gold).toBe(ordinary.game.players.player!.gold);
    expect(repeated.mine.amount).toBe(ordinary.mine.amount);
    expect(repeated.workers.map(worker => ({ x: worker.x, y: worker.y, order: worker.order, load: worker.carryingGold })))
      .toEqual(ordinary.workers.map(worker => ({ x: worker.x, y: worker.y, order: worker.order, load: worker.carryingGold })));
  });

  it("keeps each live phase and waiting priority while an immediate same-mine order clears queued commands", () => {
    const { game, mine, workers, command } = haul("bareDuel", 3);
    const seen = new Set<string>();
    for (let tick = 0; tick < seconds(15); tick++) {
      stepGame(game);
      for (const worker of workers) {
        if (worker.order.type !== "mine") continue;
        const order = { ...worker.order }, gold = worker.carryingGold;
        seen.add(order.phase);
        issuePlayerCommand(game, "player", { type: "move", unitIds: [worker.id], x: mine.x + 200, y: mine.y, queued: true });
        expect(worker.orderQueue).toHaveLength(1);
        issuePlayerCommand(game, "player", { ...command, unitIds: [worker.id] });
        expect(worker.order).toEqual(order);
        expect(worker.carryingGold).toBe(gold);
        expect(worker.orderQueue).toEqual([]);
      }
    }
    expect([...seen].sort()).toEqual(["gather", "return", "toMine"]);
    expect(game.players.player!.gold).toBeGreaterThan(0);
  });

  it("queues same-mine orders without replacing the active work, and restores progress deterministically", () => {
    const { game, workers, command } = haul("bareDuel", 1);
    const worker = workers[0]!;
    for (let tick = 0; tick < seconds(10) && !(worker.order.type === "mine" && worker.order.phase === "gather"); tick++) stepGame(game);
    expect(worker.order).toMatchObject({ type: "mine", phase: "gather" });
    const active = { ...worker.order };
    issuePlayerCommand(game, "player", { ...command, queued: true });
    expect(worker.order).toEqual(active);
    expect(worker.orderQueue).toEqual([{ type: "mine", resourceId: command.resourceId, phase: "toMine", timer: 0 }]);
    expect(worker.orderQueue![0]).not.toBe(worker.order);
    const restored = createGame("bareDuel", { aiPlayers: [] });
    restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    for (let tick = 0; tick < seconds(10); tick++) {
      issuePlayerCommand(game, "player", command);
      issuePlayerCommand(restored, "player", command);
      stepGame(game);
      stepGame(restored);
    }
    expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  });

  it("retargets a loaded worker by delivering its existing load before mining the new resource", () => {
    const { game, hall, mine, workers } = haul("bareDuel", 1);
    const worker = workers[0]!;
    for (let tick = 0; tick < seconds(15) && worker.carryingGold === 0; tick++) stepGame(game);
    expect(worker.carryingGold).toBe(10);
    const next = { id: "new-mine", kind: "goldMine" as const, x: hall.x + 350, y: hall.y + 120, amount: 1000 };
    game.resources.push(next);
    issuePlayerCommand(game, "player", { type: "mine", resourceId: next.id, unitIds: [worker.id] });
    expect(worker.order).toMatchObject({ type: "mine", resourceId: next.id, phase: "return" });
    for (let tick = 0; tick < seconds(25); tick++) stepGame(game);
    expect(game.players.player!.gold).toBeGreaterThanOrEqual(20);
    expect(next.amount).toBeLessThan(1000);
    expect(mine.amount + next.amount + worker.carryingGold + game.players.player!.gold).toBe(101000);
  });

  it("cancels unfinished work when a different mine is ordered and creates a fresh approach", () => {
    const { game, hall, mine, workers } = haul("bareDuel", 1);
    const worker = workers[0]!;
    for (let tick = 0; tick < seconds(10) && !(worker.order.type === "mine" && worker.order.phase === "gather"); tick++) stepGame(game);
    for (let tick = 0; tick < 7; tick++) stepGame(game);
    expect(worker.order).toMatchObject({ type: "mine", phase: "gather", timer: seconds(GOLD_MINE_RULES.gatherSeconds) - 7 });
    const next = { id: "next-mine", kind: "goldMine" as const, x: hall.x + 330, y: hall.y + 120, amount: 1000 };
    game.resources.push(next);
    issuePlayerCommand(game, "player", { type: "mine", resourceId: next.id, unitIds: [worker.id] });
    expect(worker.order).toEqual({ type: "mine", resourceId: next.id, phase: "toMine", timer: 0 });
    stepGame(game);
    expect(worker.mineSlot).toBeUndefined();
    expect(mine.amount).toBe(100000);
    for (let tick = 0; tick < seconds(25); tick++) stepGame(game);
    expect(game.players.player!.gold).toBeGreaterThan(0);
    expect(next.amount).toBeLessThan(1000);
  });

  it("leaves progress intact for an unknown mine and does not resume old work after stop", () => {
    const { game, workers, command } = haul("bareDuel", 1);
    const worker = workers[0]!;
    for (let tick = 0; tick < seconds(10) && !(worker.order.type === "mine" && worker.order.phase === "gather"); tick++) stepGame(game);
    for (let tick = 0; tick < 7; tick++) stepGame(game);
    issuePlayerCommand(game, "player", { ...command, queued: true });
    const active = { ...worker.order }, queue = structuredClone(worker.orderQueue);
    expect(() => issuePlayerCommand(game, "player", { ...command, resourceId: "missing-mine" })).toThrow("Unknown resource");
    expect(worker.order).toEqual(active);
    expect(worker.orderQueue).toEqual(queue);
    issuePlayerCommand(game, "player", { type: "stop", unitIds: [worker.id] });
    stepGame(game);
    expect(worker.mineSlot).toBeUndefined();
    issuePlayerCommand(game, "player", command);
    expect(worker.order).toEqual({ type: "mine", resourceId: command.resourceId, phase: "toMine", timer: 0 });
    for (let tick = 0; tick < seconds(3) && !(worker.order.type === "mine" && worker.order.phase === "gather"); tick++) stepGame(game);
    expect(worker.order).toMatchObject({ phase: "gather", timer: seconds(GOLD_MINE_RULES.gatherSeconds) });
  });

  it("still stops at an empty mine and delivers the final partial load after depletion", () => {
    const empty = haul("bareDuel", 1);
    empty.mine.amount = 0;
    issuePlayerCommand(empty.game, "player", empty.command);
    stepGame(empty.game);
    expect(empty.workers[0]!.order).toEqual({ type: "idle" });
    expect(empty.game.players.player!.gold).toBe(0);

    const final = haul("bareDuel", 1);
    final.mine.amount = 7;
    for (let tick = 0; tick < seconds(20); tick++) {
      issuePlayerCommand(final.game, "player", final.command);
      stepGame(final.game);
    }
    expect(final.game.players.player!.gold).toBe(7);
    expect(final.mine.amount).toBe(0);
    expect(final.workers[0]!.carryingGold).toBe(0);
    stepGame(final.game);
    expect(final.workers[0]!.order).toEqual({ type: "idle" });
  });
});
