import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { UnitKind } from "../shared/types";
import { UNIT_ART, UNIT_ART_TIERS, type UnitArtTier } from "./unit-art";

const kinds = Object.keys(UNIT_DEFS) as UnitKind[];
const rank = (tier: UnitArtTier) => UNIT_ART_TIERS.indexOf(tier);
const purchasable = kinds.filter((kind) => UNIT_DEFS[kind].cost > 0);

describe("unit art tiers", () => {
  it("covers every unit kind", () => {
    expect(Object.keys(UNIT_ART).sort()).toEqual([...kinds].sort());
  });

  it("orders purchasable units by price: a higher tier always costs more", () => {
    for (const a of purchasable) {
      for (const b of purchasable) {
        if (rank(UNIT_ART[a].tier) > rank(UNIT_ART[b].tier)) {
          expect(UNIT_DEFS[a].cost, `${a} vs ${b}`).toBeGreaterThan(UNIT_DEFS[b].cost);
        }
      }
    }
  });

  it("gives elites more supply than any basic unit", () => {
    const elites = purchasable.filter((kind) => UNIT_ART[kind].tier === "elite");
    expect(elites.length).toBeGreaterThan(0);
    for (const kind of elites) expect(UNIT_DEFS[kind].supplyUsed, kind).toBeGreaterThanOrEqual(3);
  });

  it("orders creeps by camp food power", () => {
    const creeps = kinds.filter((kind) => UNIT_DEFS[kind].creepFoodPower);
    for (const a of creeps) {
      for (const b of creeps) {
        if (rank(UNIT_ART[a].tier) > rank(UNIT_ART[b].tier)) {
          expect(UNIT_DEFS[a].creepFoodPower!, `${a} vs ${b}`).toBeGreaterThan(UNIT_DEFS[b].creepFoodPower!);
        }
      }
    }
  });

  it("mounts exactly the units trained at the stables", () => {
    const mounted = kinds.filter((kind) => UNIT_ART[kind].bearing === "mounted").sort();
    expect(mounted).toEqual([...BUILDING_DEFS.stables.trains].sort());
  });
});
