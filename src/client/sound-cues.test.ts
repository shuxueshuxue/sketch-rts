import { describe, expect, it } from "vitest";
import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS } from "../shared/catalog";
import { createBuilding } from "../shared/map";
import { SHIP_WEAPONS, shipMounts } from "../shared/ship-equipment";
import { createGame, issueCommand, RANGED_ATTACK_RANGE_THRESHOLD, snapshotGame, stepGame, tryPlayerCommand } from "../shared/sim";
import type { AbilityKind, BuildingKind, GameSnapshot, ShipEquipmentKind, UnitKind, WorldEffect } from "../shared/types";
import { soundCues } from "./sound-cues";

const start = snapshotGame(createGame("bareDuel"));
const later = (change: (next: GameSnapshot) => void) => {
  const next = structuredClone(start);
  next.tick += 1;
  change(next);
  return next;
};
const effect = (id: string, type: WorldEffect["type"], extra: Partial<WorldEffect> = {}): WorldEffect => ({ id, type, x: 100, y: 200, remaining: 10, duration: 10, ...extra });
const ids = (before: GameSnapshot, after: GameSnapshot) => soundCues(before, after, "player").map((cue) => cue.id);
const shotTypes = new Set<WorldEffect["type"]>(["projectile", "siegeBolt", "shellFlight", "grapeshot"]);

function battle(kind: UnitKind, range = UNIT_DEFS[kind].attackRange) {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  const shooter = game.spawnUnit("player", kind, 1000, 1000);
  const target = game.spawnUnit("enemy", "footman", 1000 + range * .7 + 70, 1000);
  target.invulnerable = true; target.cooldown = 9999;
  target.order = { type: "hold", x: target.x, y: target.y };
  shooter.autocast = Object.fromEntries(UNIT_DEFS[kind].abilities.map(ability => [ability, false]));
  if (shooter.sailing) shooter.sailing.heading = kind === "shipOfTheLine" ? Math.PI / 2 : 0;
  return { game, shooter, target };
}

// Exercise real sim releases; catalogue-driven cases also pick up new ranged units, mounts, skills and buildings.
function firstShots(game: ReturnType<typeof createGame>, sourceId: string, actionMode?: "cast") {
  let before = snapshotGame(game);
  for (let tick = 0; tick < 120; tick += 1) {
    stepGame(game);
    const after = snapshotGame(game), seen = new Set(before.effects.map(effect => effect.id));
    const shots = after.effects.filter(effect => effect.sourceId === sourceId && shotTypes.has(effect.type) && !seen.has(effect.id));
    for (const shot of shots) expect(shot.attackKind, `${shot.sourceKind} ${shot.type} must capture its attackKind`).toBeDefined();
    const cues = soundCues(before, after, "player").filter(cue => cue.id.endsWith("Shot"));
    expect(cues).toHaveLength(shots.length);
    expect(cues.map(({ x, y }) => ({ x, y }))).toEqual(shots.map(shot => ({ x: shot.fromX, y: shot.fromY })));
    expect(cues.every(cue => cue.id !== "shipShot" && cue.kind === undefined)).toBe(true);
    if (shots.length && (!actionMode || shots.some(shot => shot.actionMode === actionMode))) return { before, after, shots };
    before = after;
  }
  throw new Error(`${sourceId} did not release a ${actionMode ?? "weapon"} shot`);
}

describe("sound cues", () => {
  const rangedKinds = (Object.keys(UNIT_DEFS) as UnitKind[]).filter(kind => UNIT_DEFS[kind].attackDamage > 0 && UNIT_DEFS[kind].attackRange > RANGED_ATTACK_RANGE_THRESHOLD);
  it.each(rangedKinds)("captures attackKind on every real %s launch and sounds it once at its origin", kind => {
    const { game, shooter, target } = battle(kind);
    issueCommand(game, { type: "attack", unitIds: [shooter.id], targetId: target.id });
    firstShots(game, shooter.id);
  });

  it.each(Object.keys(SHIP_WEAPONS) as ShipEquipmentKind[])("captures a real mounted %s's identity independently of its hull", kind => {
    const def = SHIP_WEAPONS[kind], { game, shooter, target } = battle("warship", def.range);
    const mount = shipMounts(shooter).find(mount => mount.id === "bow")!;
    const item = { id: "test-mount", kind, shipId: shooter.id, mountId: mount.id, x: shooter.x, y: shooter.y, durability: def.hp, cooldownRemaining: 0 };
    game.items = [item]; shooter.fittings = [{ ...mount, id: item.id }];
    issueCommand(game, { type: "attack", unitIds: [shooter.id], targetId: target.id });
    const { shots } = firstShots(game, shooter.id);
    expect(shots.every(shot => shot.itemId === item.id && shot.attackKind === def.weapon.presentation)).toBe(true);
  });

  const weaponAbilities = (Object.keys(ABILITY_DEFS) as AbilityKind[]).filter(ability => ABILITY_DEFS[ability].behavior === "weapon");
  it.each(weaponAbilities)("captures attackKind on real %s skill releases", ability => {
    const def = ABILITY_DEFS[ability];
    if (def.behavior !== "weapon") throw new Error("Expected a weapon skill");
    const kind = (Object.keys(UNIT_DEFS) as UnitKind[]).find(kind => UNIT_DEFS[kind].abilities.includes(ability));
    expect(kind, `${ability} needs a real caster`).toBeDefined();
    const { game, shooter, target } = battle(kind!, def.range);
    const at = def.target === "point" ? { x: target.x, y: target.y } : { targetId: target.id };
    expect(tryPlayerCommand(game, "player", { type: "cast", unitId: shooter.id, ability, ...at }).ok).toBe(true);
    firstShots(game, shooter.id, "cast");
  });

  const rangedBuildings = (Object.keys(BUILDING_DEFS) as BuildingKind[]).filter(kind => BUILDING_DEFS[kind].attackDamage > 0 && BUILDING_DEFS[kind].attackRange > RANGED_ATTACK_RANGE_THRESHOLD);
  it.each(rangedBuildings)("captures attackKind on real %s projectiles", kind => {
    const { game, target } = battle("archer", BUILDING_DEFS[kind].attackRange);
    game.units = [target]; game.items = [];
    const tower = createBuilding("tower", "player", kind, 1000, 1000, true);
    game.buildings = [tower];
    firstShots(game, tower.id);
  });

  it.each(["archer", "warship"] as const)("keeps a real %s shot silent if its captured attackKind is missing", kind => {
    const { game, shooter, target } = battle(kind);
    issueCommand(game, { type: "attack", unitIds: [shooter.id], targetId: target.id });
    const { before, after, shots } = firstShots(game, shooter.id);
    for (const shot of shots) delete shot.attackKind;
    expect(soundCues(before, after, "player").filter(cue => cue.id.endsWith("Shot"))).toEqual([]);
  });

  it('uses the launched weapon identity even when the hull or its fittings differ',()=>{
    const shots=later(next=>next.effects.push(
      effect('swapped','siegeBolt',{sourceKind:'fireShip',attackKind:'cannon',fromX:10,fromY:20}),
      effect('flame','grapeshot',{sourceKind:'warship',attackKind:'flame'}),
      effect('stone','projectile',{sourceKind:'bombardShip',attackKind:'stone'}),
      effect('magic','projectile',{sourceKind:'priest',attackKind:'magic'}),
      effect('landed','hit',{sourceKind:'fireShip',attackKind:'cannon',unitId:'target'})));
    expect(soundCues(start,shots,'player').map(cue=>cue.id)).toEqual(['cannonShot','flameShot','stoneShot','spellShot','shipHit']);
  });
  it("hears a melee blow by its striker's kind, once, and no spell or swipe", () => {
    const struck = later((next) =>
      next.effects.push(
        effect("e1", "hit", { sourceKind: "footman", unitId: "u" }),
        effect("e2", "melee"),
        effect("e3", "hit", { unitId: "u" }),
        effect("e4", "heal"),
        effect("e5", "chargeTrail", { sourceKind: "knight" }),
        effect("e6", "curse"),
      ),
    );
    expect(soundCues(start, struck, "player")).toEqual([{ id: "melee", x: 100, y: 200, kind: "footman" }]);
    const same = structuredClone(struck);
    same.tick += 1;
    expect(ids(struck, same)).toEqual([]);
    expect(ids(struck, struck)).toEqual([]);
  });

  it("hears a real game's blows by their strikers: a footman's swing and an archer's arrow loosed and landing", () => {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
    game.units = [];
    const knight = game.spawnUnit("enemy", "knight", 1200, 1200);
    const footman = game.spawnUnit("player", "footman", 1240, 1200);
    const archer = game.spawnUnit("player", "archer", 1500, 1200);
    issueCommand(game, { type: "attack", unitIds: [footman.id, archer.id], targetId: knight.id });
    const heard: string[] = [];
    let before = snapshotGame(game);
    for (let tick = 0; tick < 80 && heard.filter((cue) => cue.startsWith("arrowHit")).length === 0; tick += 1) {
      stepGame(game);
      const after = snapshotGame(game);
      heard.push(...soundCues(before, after, "player").map((cue) => `${cue.id}${cue.kind ? `:${cue.kind}` : ""}`));
      before = after;
    }
    expect(heard).toContain("melee:footman");
    expect(heard).toContain("arrowShot");
    expect(heard).toContain("arrowHit");
  });

  it("hears an arrow loosed where its bowman or tower stands and where it lands, and also hears non-arrow impacts", () => {
    const shots = later((next) =>
      next.effects.push(
        effect("a", "projectile", { sourceKind: "archer", attackKind: "arrow", fromX: 10, fromY: 20 }),
        effect("b", "projectile", { sourceKind: "defenseTower", attackKind: "arrow", fromX: 30, fromY: 40 }),
        effect("c", "projectile", { sourceKind: "warship", attackKind: "cannon" }),
        effect("d", "projectile", { sourceKind: "priest" }),
        effect("e", "projectile"),
        effect("f", "hit", { sourceKind: "thornSlinger", unitId: "u" }),
        effect("g", "hit", { sourceKind: "redDragon", unitId: "u" }),
        effect("h", "hit", { sourceKind: "witch", unitId: "u" }),
      ),
    );
    expect(soundCues(start, shots, "player")).toEqual([
      { id: "arrowShot", x: 10, y: 20 },
      { id: "arrowShot", x: 30, y: 40 },
      { id: "cannonShot", x: 100, y: 200 },
      { id: "arrowHit", x: 100, y: 200 },
      { id: "impact", x: 100, y: 200 },
      { id: "impact", x: 100, y: 200 },
    ]);
  });

  it("hears the fallen and ships sunk, but not soldiers going aboard a transport or coming ashore", () => {
    const [first, second] = start.units.filter((unit) => unit.owner === "player");
    const fallen = later((next) => {
      next.units = next.units.filter((unit) => unit.id !== first!.id);
    });
    expect(ids(start, fallen)).toEqual(["death"]);
    const afloat = later((next) => {
      next.units.push({ ...structuredClone(first!), id: "ship", kind: "warship" });
    });
    const sunk = structuredClone(afloat);
    sunk.tick += 1;
    sunk.units = sunk.units.filter((unit) => unit.id !== "ship");
    expect(ids(afloat, sunk)).toEqual(["shipSink"]);
    const aboard = later((next) => {
      next.units = next.units.filter((unit) => unit.id !== first!.id);
      next.units.find((unit) => unit.id === second!.id)!.cargo = [structuredClone(first!)];
    });
    expect(ids(start, aboard)).toEqual([]);
    const ashore = structuredClone(start);
    ashore.tick = aboard.tick + 1;
    expect(ids(aboard, ashore)).toEqual([]);
  });

  it("hears any building raised, the listener's own finished and any fall, and no recruit", () => {
    const own = start.units.find((unit) => unit.owner === "player")!;
    const trained = later((next) => next.units.push({ ...own, id: "new-own" }));
    expect(ids(start, trained)).toEqual([]);
    const placed = later((next) => next.buildings.push({ ...structuredClone(start.buildings[0]!), id: "new-farm", complete: false }));
    expect(ids(start, placed)).toEqual(["construction"]);
    const raising = later((next) => {
      next.buildings[0]!.complete = false;
    });
    const raised = structuredClone(start);
    raised.tick = raising.tick + 1;
    expect(ids(raising, raised)).toEqual(start.buildings[0]!.owner === "player" ? ["built"] : []);
    const razed = later((next) => {
      next.buildings = next.buildings.slice(1);
    });
    expect(ids(start, razed)).toEqual(["buildingDown"]);
  });
});
