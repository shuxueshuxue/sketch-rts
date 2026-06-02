import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import type { WildlingUnitKind } from "./types";

const WILDLING_KINDS: WildlingUnitKind[] = ["mossGnawer", "wildling", "thornSlinger", "barkMender", "stonebackBrute", "gladeWitch", "ancientStag"];

describe("unit catalog", () => {
  it("keeps neutral wildling model radius tied to creep power", () => {
    const byPower = new Map<number, number[]>();
    for (const kind of WILDLING_KINDS) {
      const def = UNIT_DEFS[kind];
      const power = def.creepFoodPower ?? 0;
      byPower.set(power, [...(byPower.get(power) ?? []), def.radius]);
    }
    const bands = [...byPower.entries()]
      .map(([power, radii]) => ({ power, minRadius: Math.min(...radii), maxRadius: Math.max(...radii) }))
      .sort((a, b) => a.power - b.power);

    for (let index = 1; index < bands.length; index += 1) {
      const weaker = bands[index - 1]!;
      const stronger = bands[index]!;
      expect(stronger.minRadius, `power ${stronger.power} should read larger than power ${weaker.power}`).toBeGreaterThan(weaker.maxRadius);
    }
  });
});
