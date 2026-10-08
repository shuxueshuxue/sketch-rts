import { describe, expect, it } from "vitest";
import { createI18n } from "./i18n";
import { abilityTooltip, buildingTooltip, itemTooltip, tooltipText, unitSelectionTooltip, unitTooltip, upgradeTooltip, veteranSkillTooltip, withTooltipRequirement } from "./tooltips";
import { ABILITY_DEFS, resolveVariant } from "../shared/catalog";
import { SIM_TICKS_PER_SECOND } from "../shared/time";
import type { GameSnapshot, PlayerState, Unit } from "../shared/types";

// The tooltips state the heal cooldown the catalog holds (they said 6.0s for a while after heals went to 12s).
const HEAL_COOLDOWN_SECONDS = (ABILITY_DEFS.heal.cooldown / SIM_TICKS_PER_SECOND).toFixed(1);
const CHARGE = ABILITY_DEFS.charge;
if (CHARGE.behavior !== "charge") throw new Error("charge is not a charge");
const CHARGE_COOLDOWN_SECONDS = (CHARGE.cooldown / SIM_TICKS_PER_SECOND).toFixed(1);

describe("gameplay tooltips", () => {
  it("labels mechanical units and passengers independently and excludes mechanical regeneration claims", () => {
    const snapshot = snapshotWithPlayerUpgrades({ leadership: 3 });
    const golem = unit("golem", { level: 3, deck: { shipId: "transport", x: 0, y: 0 } });
    const passenger = unit("footman", { deck: { shipId: "transport", x: 20, y: 0 } });
    for (const locale of ["zh", "en"] as const) {
      const i18n = createI18n(locale);
      const mechanical = unitSelectionTooltip("golem", [golem], snapshot, i18n);
      expect(mechanical.stats).toContain(locale === "zh" ? "单位类型：机械" : "Unit class: Mechanical");
      expect(mechanical.stats.join(" ")).not.toContain(locale === "zh" ? "回复 +12" : "Regen +12");
      expect(unitSelectionTooltip("footman", [passenger], snapshot, i18n).stats).toContain(locale === "zh" ? "单位类型：非机械" : "Unit class: Non-mechanical");
      expect(unitTooltip("ballista", undefined, i18n).stats).toContain(locale === "zh" ? "单位类型：机械" : "Unit class: Mechanical");
      expect(tooltipText(abilityTooltip("heal", undefined, i18n))).toContain(locale === "zh" ? "对机械单位无效" : "no effect on mechanical units");
      for (const item of ["healingScroll", "regenRing"] as const) expect(tooltipText(itemTooltip(item, undefined, i18n))).toContain(locale === "zh" ? "对机械单位无效" : "no effect on mechanical units");
      for (const building of ["moonWell", "emberShrine"] as const) expect(tooltipText(buildingTooltip(building, undefined, i18n))).toContain(locale === "zh" ? "非机械友军" : "non-mechanical allies");
    }
    snapshot.variants = { automaton: resolveVariant({ base: "footman", unitClass: "mechanical", regenPerSecond: 10 }) };
    const automaton = { ...passenger, variant: "automaton" };
    const text = tooltipText(unitSelectionTooltip("footman", [automaton], snapshot));
    expect(text).toContain("Unit class: Mechanical");
    expect(text).not.toContain("Innate regeneration");
    expect(text).not.toContain("Regen +");
  });

  it("shows the wielded weapon's damage type and distinguishes physical armor from universal veteran protection", () => {
    const snapshot = snapshotWithPlayerUpgrades({});
    const priest = unit("priest", {});
    expect(tooltipText(unitSelectionTooltip("priest", [priest], snapshot))).toContain("Magic · Ranged");
    const armed = { ...priest, hands: { right: "sword", left: "sword" } };
    snapshot.items = [{ id: "sword", kind: "greatSword", carrierId: armed.id, slot: "carry0", x: 0, y: 0, cooldownRemaining: 0 }];
    expect(tooltipText(unitSelectionTooltip("priest", [armed], snapshot))).toContain("Physical · Melee · Cutting");
    expect(tooltipText(itemTooltip("leatherArmor"))).toContain("physical damage reduction");
    expect(tooltipText(itemTooltip("roundShield", undefined, createI18n("zh")))).toContain("不减免魔法伤害");
    expect(tooltipText(veteranSkillTooltip("veteranInnerFire"))).toContain("both physical and magic");
  });

  it('shows a live purchase refusal once even when the purchase tooltip already includes it', () => {
    for(const reason of ['接收者距离过远，请先靠近商店或船坞。','金币不足','Move the recipient closer to the seller']) {
      const base={...itemTooltip('shipCannon'),requirements:[reason,'Delivered to the recipient.']};
      const projected=withTooltipRequirement(base,reason);
      expect(tooltipText(projected).split(reason)).toHaveLength(2);
      expect(projected.requirements).toEqual([reason,'Delivered to the recipient.']);
      expect(base.requirements).toEqual([reason,'Delivered to the recipient.']);
    }
  });
  it("describes trainable units with live catalog stats", () => {
    const tooltip = unitTooltip("archer", "a");

    expect(tooltip.title).toBe("Archer");
    expect(tooltip.body).toContain("ranged");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 115 gold", "Supply 2", "HP 83", "Attack 13", "Range 319.2", "Reticle speed: 320 / second", "Train 7.8s"]));
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
      body: expect.stringContaining("powerful"),
      stats: [`Strikes for x${CHARGE.damageMultiplier} its attack`, `Range ${CHARGE.minRange}-${CHARGE.range}`, `Cooldown ${CHARGE_COOLDOWN_SECONDS}s`],
      requirements: ["Raider or knight must be ready.", `Target an enemy unit at least ${CHARGE.minRange} away; a farther one is ridden up to first.`],
      hotkey: "R",
    });
    expect(abilityTooltip("charge", "r", createI18n("zh"))).toMatchObject({
      title: "冲锋",
      stats: [`伤害为普攻 x${CHARGE.damageMultiplier}`, `射程 ${CHARGE.minRange}-${CHARGE.range}`, `冷却 ${CHARGE_COOLDOWN_SECONDS}s`],
      requirements: ["掠袭者或骑士必须准备就绪。", `目标是至少 ${CHARGE.minRange} 外的敌方单位，更远的会先骑过去再冲。`],
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
      stats: expect.arrayContaining(["84 initial damage", "Up to 3 targets", "Range 280", "Cooldown 18.0s"]),
      requirements: ["Needs a visible enemy unit in range."],
      hotkey: "1",
    });
  });

  it("describes upgrades with affected units and per-level changes", () => {
    const tooltip = upgradeTooltip("reinforcedPlating", "p", 1);

    expect(tooltip.title).toBe("Reinforced Plating II");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 210 gold", "Research 52.5s", "+30% max HP"]));
    expect(tooltip.requirements).toEqual(expect.arrayContaining(["Research at Barracks / Ember Forge.", "Affects combat units."]));
    expect(tooltip.hotkey).toBe("P");
  });

  it("describes building durability as a town hall building upgrade", () => {
    const tooltip = upgradeTooltip("buildingDurability", "d", 0);

    expect(tooltip.title).toBe("Building Durability I");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 200 gold", "Research 54.0s", "+20% building HP"]));
    expect(tooltip.requirements).toEqual(expect.arrayContaining(["Research at Town Hall.", "Affects buildings."]));
    expect(tooltip.hotkey).toBe("D");
  });

  it("describes late movement, range, and leadership upgrades", () => {
    expect(upgradeTooltip("speedTraining", "m", 1)).toMatchObject({
      title: "Mobility Training II",
      stats: expect.arrayContaining(["+20% move speed"]),
      requirements: expect.arrayContaining(["Research at Stables / Cinder Spire.", "Affects combat units."]),
      hotkey: "M",
    });
    expect(upgradeTooltip("rangeTraining", "r", 2).stats).toEqual(expect.arrayContaining(["+35% unit range"]));
    expect(upgradeTooltip("leadership", "l", 2)).toMatchObject({
      stats: expect.arrayContaining(["+3/7/12 HP/s at 1/2/3 stars"]),
      requirements: expect.arrayContaining(["Affects non-mechanical starred units."]),
    });
  });

  it("describes selected units with live combat stats and leadership regeneration", () => {
    const snapshot = snapshotWithPlayerUpgrades({ leadership: 3 });
    const veteran = unit("knight", { hp: 100, maxHp: 300, attackDamage: 50, attackRange: 48, speed: 44, level: 3 });

    expect(unitSelectionTooltip("knight", [veteran], snapshot)).toMatchObject({
      title: "Knight",
      stats: expect.arrayContaining(["HP 100/300", "Attack 50", "Range 48", "Speed 44/s", "Regen +12 HP/s"]),
    });

    const zh = createI18n("zh");
    expect(unitSelectionTooltip("knight", [veteran], snapshot, zh).stats).toEqual(expect.arrayContaining(["回复 +12 生命/秒"]));
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
      stats: expect.arrayContaining(["花费 115 金", "人口 2", "生命 83", "攻击 13", "射程 319.2", "准心速度：320 / 秒", "训练 7.8s"]),
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
      stats: expect.arrayContaining(["1/2/3 星 +3/7/12 生命/秒"]),
      requirements: expect.arrayContaining(["影响非机械有星单位。"]),
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

describe("rule-generated current descriptions", () => {
  it("shows the exact faction roster, including mounted archers and split engineering", () => {
    expect(tooltipText(buildingTooltip("stables"))).toContain("Horse Archer");
    const grove = tooltipText(buildingTooltip("workshop", undefined, createI18n("en"), "grove"));
    const ember = tooltipText(buildingTooltip("workshop", undefined, createI18n("en"), "ember"));
    expect(grove).toContain("Golem"); expect(grove).toContain("Ballista"); expect(grove).not.toContain("Catapult");
    expect(ember).toContain("Catapult"); expect(ember).toContain("Organ Gun"); expect(ember).not.toContain("Golem");
    expect(tooltipText(buildingTooltip("emberForge", undefined, createI18n("zh")))).toContain("灰烬守卫");
  });
  it("explains cost-specific veterancy and target-specific tower damage in both locales", () => {
    for (const locale of ["en", "zh"] as const) {
      const i18n = createI18n(locale);
      expect(tooltipText(unitTooltip("knight", undefined, i18n))).toContain("114 / 247 / 494");
      expect(tooltipText(unitTooltip("knight", undefined, i18n))).toContain("33.3%");
      expect(tooltipText(buildingTooltip("defenseTower", undefined, i18n))).toContain("50%");
      expect(tooltipText(itemTooltip("stormStaff", undefined, i18n))).toContain("1.2s");
      expect(tooltipText(itemTooltip("stormStaff", undefined, i18n))).not.toContain("tick");
      expect(tooltipText(itemTooltip("guardianScroll", undefined, i18n))).not.toContain("45.0s");
    }
  });
});
