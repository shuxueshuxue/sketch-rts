import { describe, expect, it } from "vitest";
import { createI18n } from "./i18n";
import { abilityTooltip, buildingTooltip, itemTooltip, tooltipText, unitSelectionTooltip, unitTooltip, upgradeTooltip } from "./tooltips";
import { ABILITY_DEFS } from "../shared/catalog";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, PlayerState, Unit } from "../shared/types";

// The tooltips state the heal cooldown the catalog holds (they said 6.0s for a while after heals went to 12s).
const HEAL_COOLDOWN_SECONDS = (ABILITY_DEFS.heal.cooldown / SIM_TICKS_PER_SECOND).toFixed(1);
const CHARGE = ABILITY_DEFS.charge;
if (CHARGE.behavior !== "charge") throw new Error("charge is not a charge");
const CHARGE_COOLDOWN_SECONDS = (CHARGE.cooldown / SIM_TICKS_PER_SECOND).toFixed(1);

describe("gameplay tooltips", () => {
  it("describes trainable units with live catalog stats", () => {
    const tooltip = unitTooltip("archer", "a");

    expect(tooltip.title).toBe("Archer");
    expect(tooltip.body).toContain("ranged");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 115 gold", "Supply 2", "HP 72", "Attack 13", "Range 399", "Train 7.8s"]));
    expect(tooltip.hotkey).toBe("A");
  });

  it("describes ability targeting, range, and effect numbers", () => {
    expect(abilityTooltip("heal", "h")).toMatchObject({
      title: "Heal",
      body: expect.stringContaining("allied"),
      stats: expect.arrayContaining(["Restores 55 HP", "Range 240", `Cooldown ${HEAL_COOLDOWN_SECONDS}s`]),
      requirements: ["Priest or field medic must be ready."],
      hotkey: "H",
    });
    expect(abilityTooltip("curse", "c").stats).toEqual(expect.arrayContaining(["Enemy damage x0.4", "100 damage to summoned units", "Range 280", "Duration 18.0s", "Cooldown 7.5s"]));
    expect(abilityTooltip("emberMend", "m")).toMatchObject({
      title: "Ember Mend",
      stats: expect.arrayContaining(["Restores 55 HP", "Range 240", `Cooldown ${HEAL_COOLDOWN_SECONDS}s`]),
      requirements: ["Ember acolyte must be ready."],
      hotkey: "M",
    });
    expect(abilityTooltip("ashCurse", "x").stats).toEqual(expect.arrayContaining(["Enemy damage x0.45", "Scorched enemy damage x0.3", "Range 280", "Duration 18.0s", "Cooldown 7.5s"]));
    expect(abilityTooltip("cinderSoul", "o").stats).toEqual(expect.arrayContaining(["Summons 1 spirit", "Range 260", "Duration 60.0s", "Cooldown 40.0s"]));
  });

  it("describes the charge with its window, blow and cooldown from the catalog, in both languages", () => {
    expect(abilityTooltip("charge", "r")).toMatchObject({
      title: "Charge",
      body: expect.stringContaining("twice"),
      stats: [`Strikes for x${CHARGE.damageMultiplier} its attack`, `Range ${CHARGE.minRange}-${CHARGE.range}`, `Cooldown ${CHARGE_COOLDOWN_SECONDS}s`],
      requirements: ["Raider or knight must be ready.", `Target an enemy unit ${CHARGE.minRange} to ${CHARGE.range} away.`],
      hotkey: "R",
    });
    expect(abilityTooltip("charge", "r", createI18n("zh"))).toMatchObject({
      title: "冲锋",
      stats: [`伤害为普攻 x${CHARGE.damageMultiplier}`, `射程 ${CHARGE.minRange}-${CHARGE.range}`, `冷却 ${CHARGE_COOLDOWN_SECONDS}s`],
      requirements: ["掠袭者或骑士必须准备就绪。", `目标必须是 ${CHARGE.minRange} 到 ${CHARGE.range} 距离内的敌方单位。`],
    });
  });

  it("tells how a spell's autocast stands and that a right-click switches it, only when asked", () => {
    expect(abilityTooltip("charge", "r").notes).toBeUndefined();
    expect(abilityTooltip("charge", "r", undefined, "on").notes).toEqual(["Autocast: on", "Right-click: autocast on/off"]);
    expect(abilityTooltip("heal", "h", undefined, "off").notes).toEqual(["Autocast: off", "Right-click: autocast on/off"]);
    expect(abilityTooltip("curse", "c", undefined, "mixed").notes).toEqual(["Autocast: on for some", "Right-click: autocast on/off"]);
    expect(abilityTooltip("charge", "r", createI18n("zh"), "on").notes).toEqual(["自动施法：开", "右键：开/关自动施法"]);
    expect(tooltipText(abilityTooltip("charge", "r", undefined, "off"))).toContain("Right-click: autocast on/off");
  });

  it("names a rider's charge on its training tooltip (a missing label once broke the whole command card)", () => {
    expect(unitTooltip("raider", "r").requirements).toContain("Abilities: Charge.");
    expect(unitTooltip("knight", "k", createI18n("zh")).requirements).toContain("技能：冲锋。");
  });

  it("describes items with use conditions and damage numbers", () => {
    expect(itemTooltip("lightningRod", "1")).toMatchObject({
      title: "Lightning Rod",
      body: expect.stringContaining("enemy"),
      stats: expect.arrayContaining(["84 initial damage", "3 jumps", "Range 280", "Cooldown 18.0s"]),
      requirements: ["Needs a visible enemy unit in range."],
      hotkey: "1",
    });
  });

  it("describes upgrades with affected units and per-level changes", () => {
    const tooltip = upgradeTooltip("reinforcedPlating", "p", 1);

    expect(tooltip.title).toBe("Reinforced Plating II");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 250 gold", "Research 52.5s", "+15 max HP"]));
    expect(tooltip.requirements).toEqual(expect.arrayContaining(["Research at Barracks / Ember Forge.", "Affects combat units."]));
    expect(tooltip.hotkey).toBe("P");
  });

  it("describes building durability as a town hall building upgrade", () => {
    const tooltip = upgradeTooltip("buildingDurability", "d", 0);

    expect(tooltip.title).toBe("Building Durability I");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 260 gold", "Research 54.0s", "+20% building HP"]));
    expect(tooltip.requirements).toEqual(expect.arrayContaining(["Research at Town Hall.", "Affects buildings."]));
    expect(tooltip.hotkey).toBe("D");
  });

  it("describes late movement, range, and leadership upgrades", () => {
    expect(upgradeTooltip("speedTraining", "m", 1)).toMatchObject({
      title: "Mobility Training II",
      stats: expect.arrayContaining(["+38% move speed"]),
      requirements: expect.arrayContaining(["Research at Stables / Cinder Spire.", "Affects combat units."]),
      hotkey: "M",
    });
    expect(upgradeTooltip("rangeTraining", "r", 2).stats).toEqual(expect.arrayContaining(["+35% unit range"]));
    expect(upgradeTooltip("leadership", "l", 2)).toMatchObject({
      stats: expect.arrayContaining(["+3 HP/s per star"]),
      requirements: expect.arrayContaining(["Affects starred units."]),
    });
  });

  it("describes selected units with live combat stats and leadership regeneration", () => {
    const snapshot = snapshotWithPlayerUpgrades({ leadership: 3 });
    const veteran = unit("golem", { hp: 100, maxHp: 300, attackDamage: 50, attackRange: 48, speed: 2.2, level: 3 });

    expect(unitSelectionTooltip("golem", [veteran], snapshot)).toMatchObject({
      title: "Golem",
      stats: expect.arrayContaining(["HP 100/300", "Attack 50", "Range 48", "Speed 2.2", "Regen +9 HP/s"]),
    });

    const zh = createI18n("zh");
    expect(unitSelectionTooltip("golem", [veteran], snapshot, zh).stats).toEqual(expect.arrayContaining(["回复 +9 生命/秒"]));
  });

  it("describes buildings without relying on self-label text", () => {
    const tooltip = buildingTooltip("barracks", "b");

    expect(tooltip.title).toBe("Barracks");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 170 gold", "Build 11.0s", "HP 620"]));
    expect(tooltip.body).toContain("trains");
    expect(tooltipText(tooltip)).toContain("Barracks");
  });

  it("uses the active locale for labels, descriptions, stats, and requirements", () => {
    const zh = createI18n("zh");

    expect(unitTooltip("archer", "a", zh)).toMatchObject({
      title: "弓箭手",
      body: expect.stringContaining("远程"),
      stats: expect.arrayContaining(["花费 115 金", "人口 2", "生命 72", "攻击 13", "射程 399", "训练 7.8s"]),
      hotkey: "A",
    });
    expect(abilityTooltip("heal", "h", zh)).toMatchObject({
      title: "治疗",
      stats: expect.arrayContaining(["恢复 55 生命", "射程 240", `冷却 ${HEAL_COOLDOWN_SECONDS}s`]),
      requirements: ["牧师或战地医师必须准备就绪。"],
    });
    expect(itemTooltip("lightningRod", "1", zh).requirements).toEqual(["需要射程内可见的敌方单位。"]);
    expect(upgradeTooltip("buildingDurability", "d", 0, zh).requirements).toEqual(["在城镇大厅研究。", "影响建筑。"]);
    expect(upgradeTooltip("leadership", "l", 2, zh)).toMatchObject({
      stats: expect.arrayContaining(["每颗星 +3 生命/秒"]),
      requirements: expect.arrayContaining(["影响有星单位。"]),
    });
    expect(buildingTooltip("barracks", "b", zh).requirements[0]).toContain("提供：步兵");
    expect(buildingTooltip("barracks", "b", zh).requirements[0]).toContain("武器训练");
  });
});

function snapshotWithPlayerUpgrades(upgrades: Partial<PlayerState["upgrades"]>): GameSnapshot {
  const player: PlayerState = {
    race: "grove",
    gold: 0,
    supplyUsed: 0,
    supplyCap: 0,
    upgrades: { weaponTraining: 0, reinforcedPlating: 0, buildingDurability: 0, speedTraining: 0, rangeTraining: 0, leadership: 0, ...upgrades },
  };
  return {
    tick: 0,
    map: { id: "bareDuel", name: "Bare Duel", width: 4096, height: 4096, landmarks: [] },
    players: { player, enemy: { ...player, race: "ember" }, enemy2: { ...player, race: "ember" } },
    units: [],
    buildings: [],
    resources: [],
    mercenaryCamps: [],
    items: [],
    projectiles: [],
    effects: [],
    match: {
      winner: null,
      endedAtTick: null,
      stats: {
        unitsKilled: { player: 0, enemy: 0, enemy2: 0, neutral: 0 },
        unitsLost: { player: 0, enemy: 0, enemy2: 0, neutral: 0 },
        buildingsDestroyed: { player: 0, enemy: 0, enemy2: 0 },
        nonBaseBuildingsDestroyed: { player: 0, enemy: 0, enemy2: 0 },
        neutralUnitsKilled: { player: 0, enemy: 0, enemy2: 0 },
        unitsKilledByNeutral: { player: 0, enemy: 0, enemy2: 0 },
        mercenaryKills: { player: 0, enemy: 0, enemy2: 0 },
        goldSpent: { player: 0, enemy: 0, enemy2: 0 },
      },
    },
  };
}

function unit(kind: Unit["kind"], overrides: Partial<Unit>): Unit {
  return {
    id: `unit-player-${kind}`,
    owner: "player",
    kind,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    speed: 3,
    attackDamage: 10,
    attackRange: 50,
    attackCooldown: 10,
    cooldown: 0,
    radius: 15,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
    ...overrides,
  };
}
