import { describe, expect, it } from "vitest";
import { createI18n } from "./i18n";
import { abilityTooltip, buildingTooltip, itemTooltip, tooltipText, unitTooltip, upgradeTooltip } from "./tooltips";

describe("gameplay tooltips", () => {
  it("describes trainable units with live catalog stats", () => {
    const tooltip = unitTooltip("archer", "a");

    expect(tooltip.title).toBe("Archer");
    expect(tooltip.body).toContain("ranged");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 115 gold", "Supply 2", "HP 85", "Attack 13", "Range 399", "Train 7.8s"]));
    expect(tooltip.hotkey).toBe("A");
  });

  it("describes ability targeting, range, and effect numbers", () => {
    expect(abilityTooltip("heal", "h")).toMatchObject({
      title: "Heal",
      body: expect.stringContaining("allied"),
      stats: expect.arrayContaining(["Restores 55 HP", "Range 240", "Cooldown 6.0s"]),
      requirements: ["Priest or field medic must be ready."],
      hotkey: "H",
    });
    expect(abilityTooltip("curse", "c").stats).toEqual(expect.arrayContaining(["Enemy damage x0.4", "Range 280", "Duration 18.0s", "Cooldown 7.5s"]));
    expect(abilityTooltip("emberMend", "m")).toMatchObject({
      title: "Ember Mend",
      stats: expect.arrayContaining(["Restores 55 HP", "Range 240", "Cooldown 6.0s"]),
      requirements: ["Ember acolyte must be ready."],
      hotkey: "M",
    });
    expect(abilityTooltip("ashCurse", "x").stats).toEqual(expect.arrayContaining(["Enemy damage x0.4", "Range 280", "Duration 18.0s", "Cooldown 7.5s"]));
    expect(abilityTooltip("cinderSoul", "o").stats).toEqual(expect.arrayContaining(["Summons 1 spirit", "Range 260", "Duration 45.0s", "Cooldown 11.0s"]));
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
    expect(tooltip.requirements).toEqual(expect.arrayContaining(["Research at Barracks.", "Affects combat units."]));
    expect(tooltip.hotkey).toBe("P");
  });

  it("describes building durability as a town hall building upgrade", () => {
    const tooltip = upgradeTooltip("buildingDurability", "d", 0);

    expect(tooltip.title).toBe("Building Durability I");
    expect(tooltip.stats).toEqual(expect.arrayContaining(["Cost 260 gold", "Research 54.0s", "+20% building HP"]));
    expect(tooltip.requirements).toEqual(expect.arrayContaining(["Research at Town Hall.", "Affects buildings."]));
    expect(tooltip.hotkey).toBe("D");
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
      stats: expect.arrayContaining(["花费 115 金", "人口 2", "生命 85", "攻击 13", "射程 399", "训练 7.8s"]),
      hotkey: "A",
    });
    expect(abilityTooltip("heal", "h", zh)).toMatchObject({
      title: "治疗",
      stats: expect.arrayContaining(["恢复 55 生命", "射程 240", "冷却 6.0s"]),
      requirements: ["牧师或战地医师必须准备就绪。"],
    });
    expect(itemTooltip("lightningRod", "1", zh).requirements).toEqual(["需要射程内可见的敌方单位。"]);
    expect(upgradeTooltip("buildingDurability", "d", 0, zh).requirements).toEqual(["在城镇大厅研究。", "影响建筑。"]);
    expect(buildingTooltip("barracks", "b", zh).requirements[0]).toContain("提供：步兵");
    expect(buildingTooltip("barracks", "b", zh).requirements[0]).toContain("武器训练");
  });
});
