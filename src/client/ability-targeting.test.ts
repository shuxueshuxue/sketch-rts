import { describe, expect, it } from "vitest";
import { ABILITY_DEFS, UNIT_DEFS, resolveVariant } from "../shared/catalog";
import { createUnit } from "../shared/map";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import type { AbilityKind, UnitKind } from "../shared/types";
import { abilityUnitTargetMatches, castCommandForSelection, preferredAbilityCaster, readyAbilityCasters, type CastCommand } from "./ability-targeting";
import { abilityCommandState } from "./command-button-state";

function field(kind: UnitKind) {
  const game = createGame("bareDuel", { players: ["us", "ally", "enemy"], aiPlayers: [], teams: { us: "a", ally: "a", enemy: "b" }, scenario: { replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true } });
  game.scriptedVictory = true;
  game.units = [0, 1, 2].map(index => createUnit(`caster-${index}`, "us", kind, 1_000, 1_000 + index * 50));
  for (const unit of game.units) unit.autocast = Object.fromEntries(UNIT_DEFS[kind].abilities.map(ability => [ability, false]));
  return game;
}

describe("selected unit spell casting", () => {
  it("keeps healing pointer eligibility aligned with cast validation for constructs, siege units and passengers", () => {
    const game = field("priest"), casters = [...game.units];
    for (const kind of ["golem", "rubbleGolem", "rockGolem", "graniteGolem", "ballista", "catapult", "organGun", "siegeRam", "transport"] as const) {
      const mechanical = createUnit(`target-${kind}`, "ally", kind, 1100, 1000);
      mechanical.hp = 1;
      game.units.push(mechanical);
      const snapshot = snapshotGame(game);
      expect(abilityUnitTargetMatches(snapshot, "heal", mechanical), kind).toBe(false);
      expect(castCommandForSelection(snapshot, "us", casters, "heal", { targetId: mechanical.id }), kind).toBeUndefined();
    }
    const passenger = createUnit("passenger", "ally", "footman", 1100, 1000);
    passenger.hp = 1;
    passenger.deck = { shipId: "target-transport", x: 0, y: 0 };
    game.units.push(passenger);
    expect(abilityUnitTargetMatches(snapshotGame(game), "heal", passenger)).toBe(true);
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: passenger.id })?.targetId).toBe(passenger.id);
    const construct = game.units.find(unit => unit.kind === "golem")!;
    construct.deck = { shipId: "target-transport", x: 20, y: 0 };
    expect(abilityUnitTargetMatches(snapshotGame(game), "heal", construct)).toBe(false);
  });

  it("uses a campaign variant's explicit unit class in pointer and command targeting", () => {
    const game = field("priest"), casters = [...game.units];
    const target = createUnit("clockwork", "ally", "footman", 1100, 1000);
    target.variant = "clockwork"; target.hp = 1;
    game.variants = { clockwork: resolveVariant({ base: "footman", unitClass: "mechanical" }) };
    game.units.push(target);
    expect(abilityUnitTargetMatches(snapshotGame(game), "heal", target)).toBe(false);
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: target.id })).toBeUndefined();
  });

  it.each([["priest", "heal"], ["footman", "veteranRally"]] as const)("disables dead or stunned %s casters and accepts an expired stun for %s", (kind, ability) => {
    const game = field(kind), casters = [...game.units];
    if (ability === "veteranRally") for (const caster of casters) caster.veteranSkill = ability;
    casters[0]!.hp = 0;
    casters[1]!.effects = [{ type: "stun", remaining: 12 }];
    casters[2]!.effects = [{ type: "stun", remaining: 0 }];
    expect(readyAbilityCasters(casters, ability).map(caster => caster.id)).toEqual([casters[2]!.id]);
    expect(abilityCommandState([casters[0]!], ability)).toMatchObject({ visible: true, enabled: false });
    expect(abilityCommandState([casters[1]!], ability)).toMatchObject({ visible: true, enabled: false });
    expect(abilityCommandState([casters[2]!], ability)).toMatchObject({ visible: true, enabled: true });
  });

  it("casts a selected ready veteran when the focused veteran is stunned, then disables the card until another can cast", () => {
    const game = field("footman"), casters = [...game.units], focused = casters[0]!;
    for (const caster of casters) caster.veteranSkill = "veteranRally";
    focused.effects = [{ type: "stun", remaining: 10 }];
    casters[2]!.hp = 0;
    expect(abilityCommandState([focused], "veteranRally", casters)).toMatchObject({ visible: true, enabled: true });
    const actual = preferredAbilityCaster(casters, "veteranRally", focused.id)!;
    expect(actual.id).toBe(casters[1]!.id);
    issuePlayerCommand(game, "us", { type: "cast", unitId: actual.id, ability: "veteranRally" });
    expect(actual.abilityCooldowns?.veteranRally).toBeGreaterThan(0);
    expect(focused.abilityCooldowns?.veteranRally).toBeUndefined();
    expect(abilityCommandState([focused], "veteranRally", casters)).toMatchObject({ visible: true, enabled: false });
    expect(preferredAbilityCaster(casters, "veteranRally", focused.id)).toBeUndefined();
    focused.effects[0]!.remaining = 0;
    expect(preferredAbilityCaster(casters, "veteranRally", focused.id)?.id).toBe(focused.id);
  });

  it("lets three selected priests heal on three clicks without changing the focused priest", () => {
    const game = field("priest"), casters = [...game.units], focused = [casters[0]!];
    const patient = createUnit("patient", "ally", "knight", 1_100, 1_000);
    patient.hp = 1;
    game.units.push(patient);
    for (let index = 0; index < 3; index++) {
      expect(abilityCommandState(focused, "heal", casters).enabled).toBe(true);
      const command = castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: patient.id }, casters[0]!.id)!;
      expect(command.unitId).toBe(casters[index]!.id);
      issuePlayerCommand(game, "us", command);
      const def = ABILITY_DEFS.heal;
      if (def.behavior !== "heal") throw new Error("Expected heal");
      expect(patient.hp).toBe(1 + def.healAmount * (index + 1));
    }
    expect(abilityCommandState(focused, "heal", casters)).toMatchObject({ enabled: false, reason: "cooldown" });
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: patient.id })).toBeUndefined();
  });

  it.each([
    ["emberAcolyte", "emberMend"], ["witch", "curse"], ["ashHexer", "ashCurse"], ["summoner", "summon"],
    ["pyreCaller", "cinderSoul"], ["ballista", "pinningBolt"], ["fireShip", "incendiaryFlume"], ["knight", "charge"],
  ] as const)("reserves a different %s for each pending %s command", (kind, ability) => {
    const game = field(kind), casters = [...game.units], pending: CastCommand[] = [];
    const def = ABILITY_DEFS[ability];
    const target = createUnit("target", def.behavior === "heal" ? "ally" : "enemy", "knight", 1_200, 1_000);
    game.units.push(target);
    const at = def.behavior === "summon" || (def.behavior === "weapon" && def.target === "point") ? { x: target.x, y: target.y } : { targetId: target.id };
    for (let index = 0; index < 3; index++) {
      const command = castCommandForSelection(snapshotGame(game), "us", casters, ability, at, casters[0]!.id, false, pending)!;
      expect(command).toBeDefined();
      expect(pending.map(cast => cast.unitId)).not.toContain(command.unitId);
      pending.push(command);
    }
    expect(readyAbilityCasters(casters, ability, pending)).toEqual([]);
    expect(abilityCommandState([casters[0]!], ability, casters, pending).enabled).toBe(false);
  });

  it("does not overwrite a caster already walking to a cast, or a spell queued behind a move", () => {
    const game = field("priest"), casters = [...game.units];
    const patient = createUnit("patient", "us", "knight", 1_900, 1_000);
    patient.hp = 10;
    game.units.push(patient);
    for (const caster of casters.slice(0, 2)) {
      const queued = caster === casters[1];
      if (queued) issuePlayerCommand(game, "us", { type: "move", unitIds: [caster.id], x: 1_000, y: 1_500 });
      const command = castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: patient.id }, caster.id, queued)!;
      issuePlayerCommand(game, "us", command);
    }
    expect(casters[0]!.order.type).toBe("cast");
    expect(casters[1]!.orderQueue).toContainEqual(expect.objectContaining({ type: "cast", ability: "heal" }));
    expect(readyAbilityCasters(casters, "heal").map(unit => unit.id)).toEqual([casters[2]!.id]);
    for (let i = 0; i < 800; i++) stepGame(game);
    expect(patient.hp).toBeGreaterThan(10);
  });

  it("rechecks readiness at release and uses an in-range caster before making another walk", () => {
    const game = field("priest"), casters = [...game.units];
    casters[0]!.x = 1_700;
    const patient = createUnit("patient", "us", "footman", 1_100, 1_000);
    game.units.push(patient);
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: patient.id }, casters[0]!.id)?.unitId).toBe(casters[1]!.id);
    casters[1]!.abilityCooldowns = { heal: 10 };
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: patient.id }, casters[1]!.id)?.unitId).toBe(casters[2]!.id);
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: "gone" })).toBeUndefined();
    patient.owner = "enemy";
    expect(castCommandForSelection(snapshotGame(game), "us", casters, "heal", { targetId: patient.id })).toBeUndefined();
  });

  it("excludes unrelated selected units and refuses a charge too close to every ready rider", () => {
    const units = [createUnit("cooling", "us", "priest", 1_000, 1_000), createUnit("ready", "us", "fieldMedic", 1_100, 1_000), createUnit("melee", "us", "footman", 1_200, 1_000)];
    units[0]!.abilityCooldowns = { heal: 10 };
    expect(readyAbilityCasters(units, "heal").map(unit => unit.id)).toEqual(["ready"]);
    expect(abilityCommandState([units[0]!], "heal", units).enabled).toBe(true);
    const game = field("knight"), target = createUnit("near", "enemy", "footman", 1_005, 1_000);
    game.units.push(target);
    expect(castCommandForSelection(snapshotGame(game), "us", game.units.slice(0, 3), "charge", { targetId: target.id })).toBeUndefined();
  });
});
