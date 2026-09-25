import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, RACE_DEFS, RACE_IDS, TRAINABLE_UNIT_KINDS, UNIT_DEFS } from "../../shared/catalog";
import { BUILDING_CARDS } from "./buildings";
import { TRAINED_UNIT_CARDS, UNIT_CARDS } from "./units";

describe("content cards", () => {
  it("has a card for every unit and building in the catalog, named in both languages", () => {
    expect(Object.keys(UNIT_CARDS).sort()).toEqual(Object.keys(UNIT_DEFS).sort());
    expect(Object.keys(BUILDING_CARDS).sort()).toEqual(Object.keys(BUILDING_DEFS).sort());
    for (const card of [...Object.values(UNIT_CARDS), ...Object.values(BUILDING_CARDS)]) {
      expect(card.name.en.trim(), JSON.stringify(card.name)).not.toBe("");
      expect(card.name.zh.trim(), JSON.stringify(card.name)).not.toBe("");
    }
    for (const kind of TRAINABLE_UNIT_KINDS) {
      expect(TRAINED_UNIT_CARDS[kind].description.en.trim(), kind).not.toBe("");
      expect(TRAINED_UNIT_CARDS[kind].description.zh.trim(), kind).not.toBe("");
    }
  });

  it("trains every trainable unit at a building its race can build", () => {
    for (const race of RACE_IDS) {
      for (const kind of RACE_DEFS[race].trainableUnits) {
        const producer = UNIT_DEFS[kind].trainedAt!;
        expect(RACE_DEFS[race].buildableBuildings, `${race} ${kind} at ${producer}`).toContain(producer);
      }
    }
  });

  it("gives no two buttons of one building, or of one race's build menu, the same hotkey", () => {
    for (const [building, def] of Object.entries(BUILDING_DEFS)) {
      const keys = def.trains.map((kind) => TRAINED_UNIT_CARDS[kind].command.hotkey);
      expect(new Set(keys).size, `${building} trains ${def.trains.join(", ")}`).toBe(keys.length);
    }
    for (const race of RACE_IDS) {
      const keys = RACE_DEFS[race].buildableBuildings.map((kind) => BUILDING_CARDS[kind].command.hotkey);
      expect(new Set(keys).size, race).toBe(keys.length);
    }
  });
});
