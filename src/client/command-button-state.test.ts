import { describe, expect, it } from "vitest";
import { abilityCommandState, autocastSwitch, autocastToggle, legalityCommandState, sharedStance, stanceCommandState, stanceFighters, stanceMenuCommandState } from "./command-button-state";
import { createGame, snapshotGame } from "../shared/sim";
import { checkCommandLegality } from "../shared/sim/command-validation";
import { ABILITY_DEFS, MERCENARY_HIRE_RANGE, TIER_SUPPLY_CAP, UPGRADE_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { GameCommand, GameSnapshot } from "../shared/types";
import type { Unit } from "../shared/types";

describe("command button state", () => {
  it('hides spells and autocast for sheltered crew without blocking ready deck casters',()=>{
    const inside={...unit('priest',undefined),deck:{shipId:'ship',x:0,y:0},cabin:{shipId:'ship'}};
    const outside={...unit('priest',undefined),id:'outside'};
    expect(abilityCommandState([inside],'heal',[inside,outside]).visible).toBe(false);
    expect(abilityCommandState([outside],'heal',[inside,outside]).enabled).toBe(true);
    expect(autocastToggle([inside,outside],'heal')?.unitIds).toEqual(['outside']);
  });
  it("shows learned veteran abilities only on their owner's card and toggles only trained selected casters", () => {
    const student = { ...unit("priest", undefined), id: "student" };
    const learned = { ...unit("priest", { veteranHealingWave: 24 }), id: "learned", veteranSkill: "veteranHealingWave" as const };
    const ready = { ...learned, id: "ready", abilityCooldowns: undefined, autocast: { veteranHealingWave: false } };
    const selected = [student, learned, ready];
    expect(abilityCommandState([student], "veteranHealingWave", selected).visible).toBe(false);
    expect(abilityCommandState([learned], "veteranHealingWave", selected)).toMatchObject({ visible: true, enabled: true, autocast: "mixed" });
    expect(autocastToggle(selected, "veteranHealingWave")).toEqual({ unitIds: ["learned", "ready"], enabled: true });
    expect(abilityCommandState([learned], "veteranHealingWave", [learned])).toMatchObject({ enabled: false, cooldownTicks: 24 });
  });

  it("keeps a selected caster ability visible while disabling it during cooldown", () => {
    expect(abilityCommandState([unit("priest", { heal: 75 })], "heal")).toEqual({
      visible: true,
      enabled: false,
      cooldownTicks: 75,
      cooldownLength: ABILITY_DEFS.heal.cooldown,
      reason: "cooldown",
      autocast: "on",
    });
  });

  it("enables a caster's spell while only its weapon is cooling down", () => {
    const priest = { ...unit("priest", undefined), cooldown: 20 };
    expect(abilityCommandState([priest], "heal")).toEqual({ visible: true, enabled: true, autocast: "on" });
  });

  it("shows the charge on a rider's card, with its autocast switch read over the whole selection", () => {
    const raider = unit("raider", undefined);
    const knight = { ...unit("knight", undefined), id: "knight-1", autocast: { charge: false } };
    expect(abilityCommandState([raider], "charge")).toEqual({ visible: true, enabled: true, autocast: "on" });
    expect(abilityCommandState([raider], "charge", [raider, knight])).toEqual({ visible: true, enabled: true, autocast: "mixed" });
    expect(abilityCommandState([unit("footman", undefined)], "charge", [raider])).toEqual({ visible: false, enabled: false });
  });

  it("switches autocast Warcraft III's way: all on unless every selected caster already has it on", () => {
    const on = (id: string) => ({ ...unit("raider", undefined), id });
    const off = (id: string) => ({ ...unit("knight", undefined), id, autocast: { charge: false } });
    const footman = unit("footman", undefined);

    expect(autocastSwitch([on("a"), on("b")], "charge")).toBe("on");
    expect(autocastToggle([on("a"), on("b"), footman], "charge")).toEqual({ unitIds: ["a", "b"], enabled: false });

    expect(autocastSwitch([on("a"), off("b")], "charge")).toBe("mixed");
    expect(autocastToggle([on("a"), off("b")], "charge")).toEqual({ unitIds: ["a", "b"], enabled: true });

    expect(autocastSwitch([off("a"), off("b")], "charge")).toBe("off");
    expect(autocastToggle([off("a"), off("b")], "charge")).toEqual({ unitIds: ["a", "b"], enabled: true });

    expect(autocastSwitch([footman], "charge")).toBeUndefined();
    expect(autocastToggle([footman], "charge")).toBeUndefined();
    // A switch only speaks for the ability it names: a priest's heal switched off leaves a witch's curse on.
    expect(autocastSwitch([{ ...unit("priest", undefined), autocast: { heal: false } }, unit("witch", undefined)], "curse")).toBe("on");
  });

  it("shows the stances for melee fighters, pressed for the stance all or some of the selected ones are in", () => {
    const lancer = unit("lancer", undefined);
    const braced = { ...unit("footman", undefined), id: "footman-2", stance: "brace" as const };
    const archer = unit("archer", undefined);
    const worker = unit("worker", undefined);
    expect(stanceCommandState([archer, worker], "pursue")).toEqual({ visible: false, enabled: false });
    expect(stanceFighters([lancer, braced, archer, worker]).map((fighter) => fighter.id)).toEqual(["lancer-1", "footman-2"]);
    expect(stanceCommandState([lancer], "pursue")).toEqual({ visible: true, enabled: true, pressed: "all" });
    expect(stanceCommandState([lancer, braced, archer], "pursue")).toEqual({ visible: true, enabled: true, pressed: "some" });
    expect(stanceCommandState([lancer, braced], "brace")).toEqual({ visible: true, enabled: true, pressed: "some" });
    expect(stanceCommandState([lancer, braced], "shock")).toEqual({ visible: true, enabled: true });
    // The card follows the focused units; the press, every selected fighter.
    expect(stanceCommandState([archer], "brace", [archer, braced])).toEqual({ visible: false, enabled: false });
    expect(stanceCommandState([braced], "brace", [braced, lancer])).toEqual({ visible: true, enabled: true, pressed: "some" });
  });

  it("folds the stances into one button, ringed while the selected fighters are out of pursue", () => {
    const lancer = unit("lancer", undefined);
    const braced = { ...unit("footman", undefined), id: "footman-2", stance: "brace" as const };
    const shocked = { ...unit("knight", undefined), id: "knight-3", stance: "shock" as const };
    expect(stanceMenuCommandState([unit("archer", undefined)])).toEqual({ visible: false, enabled: false });
    expect(stanceMenuCommandState([lancer])).toEqual({ visible: true, enabled: true });
    expect(stanceMenuCommandState([lancer, braced])).toEqual({ visible: true, enabled: true, pressed: "some" });
    expect(stanceMenuCommandState([braced, shocked])).toEqual({ visible: true, enabled: true, pressed: "all" });
    expect(sharedStance([lancer, unit("archer", undefined)])).toBe("pursue");
    expect(sharedStance([braced, { ...braced, id: "footman-4" }])).toBe("brace");
    expect(sharedStance([braced, shocked])).toBeUndefined();
  });
});

function unit(kind: Unit["kind"], abilityCooldowns: Unit["abilityCooldowns"]): Unit {
  return {
    id: `${kind}-1`,
    owner: "player",
    kind,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    speed: 3,
    attackDamage: 8,
    attackRange: 90,
    attackCooldown: 10,
    cooldown: 0,
    ...(abilityCooldowns ? { abilityCooldowns } : {}),
    radius: 14,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
  };
}

// @@@command-refusal - Every order the card offers is greyed exactly when the sim would refuse it, for the sim's reason.
describe("order buttons read the sim's own check", () => {
  const CAMP = { id: "camp", x: 1600, y: 960, radius: 50, hireKind: "mercenary" as const, cost: 160, stock: 2, cooldown: 320, cooldownRemaining: 0 };
  function scene(gold: number) {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [], races: { player: "grove", enemy: "grove" }, scenario: {
      addBuildings: [
        { id: "barracks", owner: "player", kind: "barracks", x: 1200, y: 960, complete: true },
        { id: "stables", owner: "player", kind: "stables", x: 1200, y: 1200, complete: true },
      ],
      addMercenaryCamps: [CAMP],
    } });
    const snapshot = snapshotGame(game);
    snapshot.players.player!.gold = gold;
    return snapshot;
  }
  const state = (snapshot: GameSnapshot, command: GameCommand) => legalityCommandState(checkCommandLegality(snapshot, "player", command));
  const research: GameCommand = { type: "research", buildingId: "barracks", upgradeKind: "weaponTraining" };

  it("greys a research the player cannot pay for, as it greys training", () => {
    const cost = UPGRADE_DEFS.weaponTraining.levels[0]!.cost;
    expect(state(scene(cost - 1), research)).toMatchObject({ visible: true, enabled: false, reason: "gold", refusal: { reason: "gold", detail: { required: cost, available: cost - 1 } } });
    expect(state(scene(cost), research)).toEqual({ visible: true, enabled: true });
    expect(state(scene(UNIT_DEFS.footman.cost - 1), { type: "train", buildingId: "barracks", unitKind: "footman" })).toMatchObject({ enabled: false, reason: "gold" });
  });

  it("greys a locked tier with the cap it waits for, and full supply counting the queue", () => {
    const early = scene(1000);
    early.players.player!.supplyCap = 8;
    expect(state(early, { type: "train", buildingId: "stables", unitKind: "knight" })).toMatchObject({ visible: true, enabled: false, reason: "tier", supplyCap: TIER_SUPPLY_CAP[3], refusal: { reason: "supply-tier", detail: { requiredCap: TIER_SUPPLY_CAP[3], currentCap: 8 } } });
    const full = scene(1000);
    full.players.player!.supplyCap = full.players.player!.supplyUsed;
    expect(state(full, { type: "train", buildingId: "barracks", unitKind: "footman" })).toMatchObject({ enabled: false, reason: "supply" });
  });

  it("offers a hire from as far as the camp's rule reaches, and counts down the wait between hires", () => {
    const snapshot = scene(1000);
    const scout = snapshot.units.find(unit => unit.owner === "player")!;
    const reach = CAMP.radius + scout.radius + MERCENARY_HIRE_RANGE;
    Object.assign(scout, { x: CAMP.x + reach - 10, y: CAMP.y, deck: undefined });
    expect(state(snapshot, { type: "hire", campId: "camp" })).toEqual({ visible: true, enabled: true });
    Object.assign(scout, { x: CAMP.x + reach + 10 });
    expect(state(snapshot, { type: "hire", campId: "camp" })).toMatchObject({ enabled: false, reason: "position" });
    snapshot.mercenaryCamps[0]!.cooldownRemaining = 35;
    expect(state(snapshot, { type: "hire", campId: "camp" })).toMatchObject({ visible: true, enabled: false, reason: "cooldown", cooldownTicks: 35, cooldownLength: CAMP.cooldown, refusal: { reason: "cooldown", detail: { remainingTicks: 35 } } });
  });
});
