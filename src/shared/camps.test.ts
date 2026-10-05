import { describe, expect, it } from "vitest";
import { CAMP_TEMPLATES, HABITAT_FAMILY, TIER_LEVELS, campLevel, campRoster, type CampHabitat } from "./camps";
import { BUILDING_DEFS, UNIT_DEFS } from "./catalog";

// A seeded draw, as the generator's.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
}

const hasPower = (kind: keyof typeof UNIT_DEFS) => {
  const def = UNIT_DEFS[kind];
  return def.abilities.length > 0 || Boolean(def.slowOnHit || def.poisonOnHit || def.splash || def.armor);
};

describe("camp templates", () => {
  it("gives beasts a faster chase than ordinary infantry while keeping stone constructs heavy", () => {
    const infantryPace = Math.max(UNIT_DEFS.footman.speed, UNIT_DEFS.lancer.speed, UNIT_DEFS.sparkArcher.speed);
    for (const kind of ["wildling", "mossGnawer", "stonebackBrute", "ancientStag", "deepSnapper", "spiderling", "venomSpider", "spiderQueen", "dragonWhelp", "redDragon"] as const) {
      expect(UNIT_DEFS[kind].speed, kind).toBeGreaterThan(infantryPace);
    }
    for (const kind of ["rubbleGolem", "rockGolem", "graniteGolem"] as const) expect(UNIT_DEFS[kind].speed).toBeLessThan(UNIT_DEFS.footman.speed);
  });
  it("sum to their tier's levels, and every orange or red camp has a creep with a power", () => {
    for (const template of CAMP_TEMPLATES) {
      const level = campLevel(template.kinds);
      expect(level, template.id).toBeGreaterThanOrEqual(TIER_LEVELS[template.tier].min);
      expect(level, template.id).toBeLessThanOrEqual(TIER_LEVELS[template.tier].max);
      if (template.tier !== "green") expect(template.kinds.some(hasPower), template.id).toBe(true);
    }
    expect(new Set(CAMP_TEMPLATES.map((template) => template.id)).size).toBe(CAMP_TEMPLATES.length);
  });

  it("hold creeps that reach no farther than a tower", () => {
    for (const template of CAMP_TEMPLATES) for (const kind of template.kinds) expect(UNIT_DEFS[kind].attackRange).toBeLessThanOrEqual(BUILDING_DEFS.defenseTower.attackRange);
  });

  it("draw the habitat's family, dragons only for a red camp, and no template twice on a map until its tier is spent", () => {
    const random = seeded(7);
    const used = new Set<string>();
    for (const habitat of ["water", "hill", "forest", "open"] as CampHabitat[]) {
      const template = (id: string) => CAMP_TEMPLATES.find((candidate) => candidate.id === id)!;
      expect(template(campRoster(random, "green", habitat, used).templateId).family).toBe(HABITAT_FAMILY[habitat]);
      expect([HABITAT_FAMILY[habitat], "dragon"]).toContain(template(campRoster(random, "red", habitat, used).templateId).family);
    }
    const greens = CAMP_TEMPLATES.filter((template) => template.tier === "green").length;
    const map = new Set<string>();
    const drawn = Array.from({ length: greens }, (_, index) => campRoster(random, "green", (["water", "hill", "forest", "open"] as CampHabitat[])[index % 4]!, map).templateId);
    expect(new Set(drawn).size).toBe(greens);
    expect(campRoster(random, "green", "water", map).kinds.length).toBeGreaterThan(0);
  });

  it("draws the same camps from the same seed", () => {
    const draw = () => {
      const random = seeded(42);
      const used = new Set<string>();
      return (["green", "orange", "red"] as const).flatMap((tier) => (["water", "hill"] as CampHabitat[]).map((habitat) => campRoster(random, tier, habitat, used).templateId));
    };
    expect(draw()).toEqual(draw());
  });
});
