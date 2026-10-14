import { afterEach, describe, expect, it, vi } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { UNIT_DEFS, unitMover } from "../../shared/catalog";
import * as naval from "../../shared/naval";
import { canReach } from "../../shared/naval";
import { canTakeStance } from "../../shared/push";
import { snapshotGame } from "../../shared/sim";
import type { GameCommand, GameSnapshot, MeleeStance, PlayerId, Unit } from "../../shared/types";
import { createAiPolicyMemory } from "../memory";
import { isOpponentOwner } from "./ownership";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { SHOOTER_UNIT_KINDS } from "./versions";
import { planCombatReadiness, readinessUnitIds, withCombatReadinessReuse } from "./combat-readiness";
import { withAiGoldBudget } from "./snapshot";

// The pre-optimization algorithm remains a test-only oracle: compare complete
// commands and claims, including stance ordering, thresholds and tied targets.
function referenceReadinessPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): { commands: GameCommand[]; aimed: Set<string> } {
  const own = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== "worker" && unitMover(unit.kind) === "land");
  const foes = snapshot.units.filter(unit => unit.kind !== "worker" && isOpponentOwner(snapshot, owner, unit.owner, options));
  const commands: GameCommand[] = [];
  const aimed = new Set<string>();
  const stances = new Map<MeleeStance, string[]>();
  const general = options.memory.v6?.general;
  for (const unit of own) {
    if (["board", "cast", "charge", "move"].includes(unit.order.type)) continue;
    const nearby = foes.filter(enemy => distance(unit, enemy) < 300 && canReach(snapshot.map, unit, enemy));
    if (canTakeStance(unit.kind)) {
      const order = unit.order;
      const target = order.type === "attack" || order.type === "attackMove" ? snapshot.units.find(enemy => enemy.id === order.targetId) : undefined;
      const protectedFriend = own.some(friend => friend !== unit && friend.attackRange > 100 && distance(friend, unit) < 140
        && nearby.some(enemy => enemy.attackRange <= 100 && distance(enemy, friend) < 140));
      const stance: MeleeStance = protectedFriend && nearby.some(enemy => distance(enemy, unit) <= unit.attackRange + 30) ? "brace"
        : target && target.attackRange > 100 && unit.speed >= 70 && unit.hp > unit.maxHp * .75 && !nearby.some(enemy => enemy.attackRange <= 100 && distance(enemy, unit) < 160) ? "shock" : "pursue";
      if ((unit.stance ?? "pursue") !== stance) stances.set(stance, [...(stances.get(stance) ?? []), unit.id]);
    }
    if (!(SHOOTER_UNIT_KINDS.has(unit.kind) || UNIT_DEFS[unit.kind].weapon) || unit.attackRange <= 100 || unit.hp < unit.maxHp * .6) continue;
    if (!general?.target || !["guard", "hold", "defend"].includes(general.mode) || distance(unit, general.target) > 200) continue;
    if (!["idle", "hold", "aim"].includes(unit.order.type) || nearby.some(enemy => distance(unit, enemy) <= unit.attackRange)) continue;
    const approaching = foes.filter(enemy => canReach(snapshot.map, unit, enemy) && distance(unit, enemy) > unit.attackRange
      && distance(unit, enemy) <= Math.min(900, unit.attackRange + enemy.speed * 4)).sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    if (!approaching) continue;
    const gap = distance(unit, approaching);
    const reach = unit.attackRange * .85;
    const point = { x: unit.x + (approaching.x - unit.x) * reach / gap, y: unit.y + (approaching.y - unit.y) * reach / gap };
    aimed.add(unit.id);
    if (unit.order.type !== "aim" || distance(unit.order, point) > 40) commands.push({ type: "aim", unitIds: [unit.id], ...point });
  }
  for (const [stance, unitIds] of stances) commands.push({ type: "setStance", unitIds, stance });
  return { commands, aimed };
}

function readinessScene() {
  return sketchScene("readiness-distance-filter").map("bareDuel").replaceDefaults()
    .player("us", { team: "ours", race: "grove" }).player("enemy", { team: "theirs", race: "grove" })
    .player("ally", { team: "ours", race: "grove" })
    .townHall("us", 300, 300).townHall("enemy", 2400, 1600).townHall("ally", 300, 1500)
    .unit("us", "archer", 1000, 1000, { id: "shooter" })
    .unit("us", "footman", 1020, 1000, { id: "screen" })
    .unit("us", "priest", 980, 1000, { id: "caster" })
    .unit("enemy", "footman", 1430, 1000, { id: "first" })
    .unit("enemy", "footman", 1000, 1430, { id: "second" })
    .unit("enemy", "knight", 2200, 1500, { id: "far" })
    .unit("ally", "footman", 1450, 1000, { id: "ally" }).build().createGame();
}
function guardContext(): AiPolicyContext {
  const memory = createAiPolicyMemory();
  memory.v6 = { general: { mode: "guard", target: { x: 1000, y: 1000 } } };
  return { version: "v7", memory };
}

afterEach(() => vi.restoreAllMocks());

describe("combat readiness exact distance filtering", () => {
  it("does not ask reachability about opponents outside the approach band", () => {
    const snapshot = snapshotGame(readinessScene());
    snapshot.units = snapshot.units.filter(unit => ["shooter", "first", "far"].includes(unit.id));
    const reach = vi.spyOn(naval, "canReach");
    expect(planCombatReadiness(snapshot, "us", guardContext())).toEqual([
      { type: "aim", unitIds: ["shooter"], x: 1271.32, y: 1000 },
    ]);
    expect(reach.mock.calls.map(call => call[2].id)).toEqual(["first"]);
  });

  it("retains the input-order tie-break for equally distant targets", () => {
    const snapshot = snapshotGame(readinessScene()), context = guardContext();
    snapshot.units = snapshot.units.filter(unit => ["shooter", "first", "second"].includes(unit.id));
    expect(planCombatReadiness(snapshot, "us", context)).toEqual(referenceReadinessPlan(snapshot, "us", context).commands);
    expect(planCombatReadiness(snapshot, "us", context)[0]).toMatchObject({ x: 1271.32, y: 1000 });
    snapshot.units = [snapshot.units[0]!, snapshot.units[2]!, snapshot.units[1]!];
    expect(planCombatReadiness(snapshot, "us", context)[0]).toMatchObject({ x: 1000, y: 1271.32 });
  });

  it.each(["land", "islands"] as const)("equals the reference for 120 varied %s snapshots", terrain => {
    const base = snapshotGame(readinessScene());
    if (terrain === "islands") base.map = { ...base.map, width: 2560, height: 1920,
      terrain: { cell: 64, cols: 40, rows: 30, cells: (".".repeat(18) + "~".repeat(4) + ".".repeat(18)).repeat(30) } };
    let seed = 0x521ced;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
    const modes = ["guard", "hold", "defend", "attack", "creep"] as const;
    const orders: Unit["order"][] = [{ type: "idle" }, { type: "hold", x: 1000, y: 1000 }, { type: "aim", x: 1270, y: 1000 },
      { type: "attack", targetId: "first" }, { type: "move", x: 1300, y: 1200 }, { type: "board", transportId: "missing" }];
    for (let sample = 0; sample < 120; sample++) {
      const snapshot = structuredClone(base), context = guardContext();
      context.memory.v6!.general!.mode = modes[sample % modes.length]!;
      if (sample % 7 === 0) delete context.memory.v6!.general!.target;
      else context.memory.v6!.general!.target = { x: 1000 + (sample % 3) * 120, y: 1000 };
      if (sample % 3 === 0) context.teams = { us: "ours", enemy: "ours", ally: "theirs" };
      for (const unit of snapshot.units) {
        if (unit.owner === "us") {
          unit.order = structuredClone(orders[Math.floor(random() * orders.length)]!);
          unit.hp = unit.maxHp * [.59, .6, .75, 1][sample % 4]!;
          unit.stance = sample % 2 ? "brace" : "shock";
        } else {
          unit.x = 1000 + 200 + random() * 1200; unit.y = 600 + random() * 1000;
          unit.speed = [0, 60, 70, 200][sample % 4]!;
        }
      }
      const before = structuredClone(snapshot), memoryBefore = structuredClone(context.memory);
      const reference = referenceReadinessPlan(snapshot, "us", context);
      expect(planCombatReadiness(snapshot, "us", context), `commands at sample ${sample}`).toEqual(reference.commands);
      expect([...readinessUnitIds(snapshot, "us", context)], `claims at sample ${sample}`).toEqual([...reference.aimed]);
      expect(snapshot).toEqual(before); expect(context.memory).toEqual(memoryBefore);
    }
  });

  it("preserves open/closed approach thresholds and the 900 distance cap", () => {
    const base = snapshotGame(readinessScene());
    base.units = base.units.filter(unit => ["shooter", "first"].includes(unit.id));
    const shooter = base.units.find(unit => unit.id === "shooter")!, target = base.units.find(unit => unit.id === "first")!;
    for (const speed of [0, 60, 200]) for (const gap of [shooter.attackRange, shooter.attackRange + 1e-7,
      shooter.attackRange + speed * 4, shooter.attackRange + speed * 4 + 1e-7, 900, 900 + 1e-7]) {
      const snapshot = structuredClone(base), context = guardContext();
      const enemy = snapshot.units.find(unit => unit.id === target.id)!;
      enemy.speed = speed; enemy.x = shooter.x + gap; enemy.y = shooter.y;
      const reference = referenceReadinessPlan(snapshot, "us", context);
      expect(planCombatReadiness(snapshot, "us", context)).toEqual(reference.commands);
      expect([...readinessUnitIds(snapshot, "us", context)]).toEqual([...reference.aimed]);
    }
  });
});

function scopedReadinessFrame() {
  const snapshot = snapshotGame(readinessScene());
  snapshot.units = snapshot.units.filter(unit => ["shooter", "first", "ally"].includes(unit.id));
  Object.assign(snapshot.units.find(unit => unit.id === "ally")!, { x: 1000, y: 1430 });
  const context = guardContext();
  context.teams = { us: "ours", enemy: "theirs", ally: "ours" };
  return { snapshot, context };
}

describe("combat readiness invocation reuse", () => {
  it("evaluates unchanged claims and commands once inside the scope", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const reach = vi.spyOn(naval, "canReach");
    withCombatReadinessReuse(context, () => {
      expect([...readinessUnitIds(snapshot, "us", context)]).toEqual(["shooter"]);
      expect(planCombatReadiness(snapshot, "us", context)).toEqual([
        { type: "aim", unitIds: ["shooter"], x: 1271.32, y: 1000 },
      ]);
    });
    expect(reach).toHaveBeenCalledTimes(1);
  });

  it("keeps command objects, unit lists and claimed sets independent", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const expected = referenceReadinessPlan(snapshot, "us", context);
    const reach = vi.spyOn(naval, "canReach");
    withCombatReadinessReuse(context, () => {
      const claims = readinessUnitIds(snapshot, "us", context) as Set<string>;
      claims.clear();
      const first = planCombatReadiness(snapshot, "us", context);
      const firstCommand = first[0] as Extract<GameCommand, { type: "aim" }>;
      firstCommand.x = -999;
      firstCommand.unitIds.length = 0;
      first.length = 0;
      expect(planCombatReadiness(snapshot, "us", context)).toEqual(expected.commands);
      expect([...readinessUnitIds(snapshot, "us", context)]).toEqual([...expected.aimed]);
    });
    expect(reach).toHaveBeenCalledTimes(1);
  });

  type Mutation = (context: AiPolicyContext) => void;
  const mutations: Array<[string, Mutation]> = [
    ["general mode", context => { context.memory.v6!.general!.mode = "attack"; }],
    ["general replacement", context => { context.memory.v6!.general = { mode: "hold", target: { x: 1300, y: 1000 } }; }],
    ["target coordinate", context => { context.memory.v6!.general!.target!.x = 1300; }],
    ["target replacement", context => { context.memory.v6!.general!.target = { x: 1000, y: 1300 }; }],
    ["target deletion", context => { delete context.memory.v6!.general!.target; }],
    ["teams replacement", context => { context.teams = { us: "ours", enemy: "ours", ally: "theirs" }; }],
    ["teams values", context => { context.teams!.enemy = "ours"; context.teams!.ally = "theirs"; }],
    ["owner team", context => { context.teams!.us = "theirs"; }],
  ];
  it.each(mutations)("uses current %s after claims have been collected", (_name, mutate) => {
    const { snapshot, context } = scopedReadinessFrame();
    withCombatReadinessReuse(context, () => {
      const before = planCombatReadiness(snapshot, "us", context);
      mutate(context);
      const expected = referenceReadinessPlan(snapshot, "us", context);
      expect(expected.commands).not.toEqual(before);
      expect(planCombatReadiness(snapshot, "us", context)).toEqual(expected.commands);
      expect([...readinessUnitIds(snapshot, "us", context)]).toEqual([...expected.aimed]);
    });
  });

  it("notices deletion and inherited changes in partial team maps", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const inherited: Partial<Record<PlayerId, string>> = { enemy: "ours", ally: "theirs" };
    context.teams = Object.assign(Object.create(inherited) as NonNullable<AiPolicyContext["teams"]>, { us: "ours" });
    withCombatReadinessReuse(context, () => {
      expect(planCombatReadiness(snapshot, "us", context)[0]).toMatchObject({ x: 1000, y: 1271.32 });
      delete inherited.enemy;
      expect(planCombatReadiness(snapshot, "us", context)).toEqual(referenceReadinessPlan(snapshot, "us", context).commands);
      expect(planCombatReadiness(snapshot, "us", context)[0]).toMatchObject({ x: 1271.32, y: 1000 });
      inherited.enemy = "ours";
      expect(planCombatReadiness(snapshot, "us", context)[0]).toMatchObject({ x: 1000, y: 1271.32 });
    });
  });

  it("retains reuse across unrelated memory updates", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const reach = vi.spyOn(naval, "canReach");
    withCombatReadinessReuse(context, () => {
      readinessUnitIds(snapshot, "us", context);
      context.memory.unitClaims.shooter = { kind: "retreat", targetId: "retreat", x: 300, y: 300, sinceTick: 0, expiresTick: 900 };
      context.memory.v6!.general!.leash = 700;
      expect(planCombatReadiness(snapshot, "us", context)).toHaveLength(1);
    });
    expect(reach).toHaveBeenCalledTimes(1);
    expect(context.memory.unitClaims.shooter?.kind).toBe("retreat");
    expect(context.memory.v6!.general!.leash).toBe(700);
  });

  it("does not share the original snapshot with distinct gold budget views", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const budget = withAiGoldBudget(snapshot, "us", snapshot.players.us!.gold - 100);
    const reach = vi.spyOn(naval, "canReach");
    withCombatReadinessReuse(context, () => {
      const original = planCombatReadiness(snapshot, "us", context);
      expect(planCombatReadiness(budget, "us", context)).toEqual(original);
      expect(planCombatReadiness(budget, "us", context)).toEqual(original);
    });
    expect(reach).toHaveBeenCalledTimes(2);
  });

  it("separates owners and snapshot identities", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const next = structuredClone(snapshot);
    withCombatReadinessReuse(context, () => {
      readinessUnitIds(snapshot, "us", context);
      expect(planCombatReadiness(snapshot, "ally", context)).toEqual(referenceReadinessPlan(snapshot, "ally", context).commands);
      next.units.find(unit => unit.id === "first")!.x = 2000;
      expect(planCombatReadiness(next, "us", context)).toEqual(referenceReadinessPlan(next, "us", context).commands);
    });
  });

  it("does not cache standalone calls or a context retained after scope exit", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const reach = vi.spyOn(naval, "canReach");
    readinessUnitIds(snapshot, "us", context);
    planCombatReadiness(snapshot, "us", context);
    expect(reach).toHaveBeenCalledTimes(2);
    withCombatReadinessReuse(context, () => {
      readinessUnitIds(snapshot, "us", context);
      planCombatReadiness(snapshot, "us", context);
    });
    expect(reach).toHaveBeenCalledTimes(3);
    planCombatReadiness(snapshot, "us", context);
    expect(reach).toHaveBeenCalledTimes(4);
    snapshot.units.find(unit => unit.id === "first")!.x = 2000;
    expect(planCombatReadiness(snapshot, "us", context)).toEqual([]);
  });

  it("returns fresh standalone containers without a reuse scope", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const first = planCombatReadiness(snapshot, "us", context), second = planCombatReadiness(snapshot, "us", context);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    if (first[0]?.type !== "aim" || second[0]?.type !== "aim") throw new Error("missing standalone aim");
    expect(first[0].unitIds).not.toBe(second[0].unitIds);
    const firstClaims = readinessUnitIds(snapshot, "us", context), secondClaims = readinessUnitIds(snapshot, "us", context);
    expect([...firstClaims]).toEqual([...secondClaims]);
    expect(firstClaims).not.toBe(secondClaims);
  });

  it("cleans up a failed scope and restores its enclosing scope after a nested call", () => {
    const { snapshot, context } = scopedReadinessFrame();
    const reach = vi.spyOn(naval, "canReach");
    withCombatReadinessReuse(context, () => {
      readinessUnitIds(snapshot, "us", context);
      expect(() => withCombatReadinessReuse(context, () => {
        readinessUnitIds(snapshot, "us", context);
        throw new Error("readiness scope fixture");
      })).toThrow("readiness scope fixture");
      planCombatReadiness(snapshot, "us", context);
    });
    expect(reach).toHaveBeenCalledTimes(2);
    planCombatReadiness(snapshot, "us", context);
    expect(reach).toHaveBeenCalledTimes(3);
    expect(() => withCombatReadinessReuse(context, () => {
      readinessUnitIds(snapshot, "us", context);
      throw new Error("outer scope fixture");
    })).toThrow("outer scope fixture");
    planCombatReadiness(snapshot, "us", context);
    expect(reach).toHaveBeenCalledTimes(5);
  });
});
