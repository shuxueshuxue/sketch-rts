import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import type { UnitKind } from "./types";
import {
  VETERAN_ACTIVE_SKILL_IDS, VETERAN_COMMON_SKILL_IDS, VETERAN_SKILLS, VETERAN_SPECIALIST_SKILLS,
  isVeteranActiveSkillId, isVeteranSkillId, rollVeteranSkillChoices, veteranSkillFitsUnitClass,
} from "./veteran-skills";

describe("veteran skill offers", () => {
  it("does not offer personal medical recovery to mechanical units or mechanical variants", () => {
    for (const kind of ["golem", "siegeRam", "rockGolem", "footman"] as const) {
      for (let seed = 0; seed < 80; seed++) {
        const choices = rollVeteranSkillChoices(kind, `machine-${seed}`, seed, "mechanical");
        expect(choices).not.toContain("veteranEndurance");
        expect(new Set(choices).size).toBe(3);
        expect(choices.every(skill => veteranSkillFitsUnitClass(skill, "mechanical"))).toBe(true);
      }
    }
    // Mechanical support casters can still heal non-mechanical allies.
    expect(veteranSkillFitsUnitClass("veteranHealingWave", "mechanical")).toBe(true);
    expect(veteranSkillFitsUnitClass("veteranRenewal", "mechanical")).toBe(true);
  });

  it("keeps the version-one draw stable for persisted deterministic replays", () => {
    expect(rollVeteranSkillChoices("priest", "unit-player-42", "island-7")).toEqual([
      "veteranRally", "veteranMobility", "veteranInnerFire",
    ]);
    expect(rollVeteranSkillChoices("worker", "unit-player-42", 7)).toEqual([
      "veteranCommand", "veteranVigilance", "veteranResilience",
    ]);
  });

  it("offers exactly three distinct, eligible skills for every unit kind and seeded veteran", () => {
    for (const kind of Object.keys(UNIT_DEFS) as UnitKind[]) {
      const specialist = VETERAN_SPECIALIST_SKILLS[kind] ?? [];
      const eligible = new Set([...VETERAN_COMMON_SKILL_IDS, ...specialist]);
      for (let index = 0; index < 80; index += 1) {
        const choices = rollVeteranSkillChoices(kind, `unit-${index}`, `map-${index % 7}`);
        expect(choices).toHaveLength(3);
        expect(new Set(choices).size).toBe(3);
        expect(choices.every(id => eligible.has(id))).toBe(true);
        const specialistCount = choices.filter(id => VETERAN_SKILLS[id].pool === "specialist").length;
        if (specialist.length === 0) expect(specialistCount).toBe(0);
        else if (specialist.length === 1) expect(specialistCount).toBe(1);
        else expect([1, 2]).toContain(specialistCount);
        // General choices stay before the specialist choices on the learning card.
        expect(choices.slice(0, 3 - specialistCount).every(id => VETERAN_SKILLS[id].pool === "common")).toBe(true);
      }
    }
  });

  it("does not reroll when unrelated units are inspected or returned arrays are changed", () => {
    const first = rollVeteranSkillChoices("priest", "unit-player-42", "island-7");
    const saved = [...first];
    for (let index = 0; index < 40; index += 1) rollVeteranSkillChoices("knight", `unit-${index}`, "island-7");
    first.reverse();
    expect(rollVeteranSkillChoices("priest", "unit-player-42", "island-7")).toEqual(saved);
    expect(rollVeteranSkillChoices("priest", "unit-player-42", "island-7")).not.toBe(first);
  });

  it("varies both pool splits and offers across units and game seeds", () => {
    const offers = Array.from({ length: 160 }, (_, index) => rollVeteranSkillChoices("priest", `unit-${index}`, "test"));
    expect(new Set(offers.map(offer => offer.filter(id => VETERAN_SKILLS[id].pool === "specialist").length))).toEqual(new Set([1, 2]));
    expect(new Set(offers.map(offer => offer.join(","))).size).toBeGreaterThan(30);
    const changedSeed = Array.from({ length: 40 }, (_, index) => rollVeteranSkillChoices("priest", "same-unit", index));
    expect(new Set(changedSeed.map(offer => offer.join(","))).size).toBeGreaterThan(12);
  });

  it("fills missing specialist slots with common options for workers and noncombat transports", () => {
    for (const kind of ["worker", "transport", "carrier", "murlocPeon", "spirit"] as const) {
      const choices = rollVeteranSkillChoices(kind, "generic", 1);
      expect(choices.every(id => VETERAN_COMMON_SKILL_IDS.includes(id))).toBe(true);
    }
  });
});

describe("veteran skill catalog contracts", () => {
  it("declares shared specialties without duplicate or cross-pool matrix entries", () => {
    const assignments = new Map<string, number>();
    for (const [kind, ids] of Object.entries(VETERAN_SPECIALIST_SKILLS)) {
      expect(Object.hasOwn(UNIT_DEFS, kind)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(VETERAN_SKILLS[id].pool).toBe("specialist");
        assignments.set(id, (assignments.get(id) ?? 0) + 1);
      }
    }
    for (const skill of Object.values(VETERAN_SKILLS)) {
      if (skill.pool === "specialist") expect(assignments.get(skill.id)).toBeGreaterThan(1);
      else expect(VETERAN_COMMON_SKILL_IDS).toContain(skill.id);
    }
    for (const kind of ["priest", "emberAcolyte", "fieldMedic"] as const) {
      expect(VETERAN_SPECIALIST_SKILLS[kind]).toContain("veteranHealingWave");
      expect(VETERAN_SPECIALIST_SKILLS[kind]).toContain("veteranInnerFire");
    }
  });

  it("matches the active ability union and rejects prototype keys or unsupported IDs", () => {
    const active = Object.values(VETERAN_SKILLS).filter(skill => skill.effect.type === "active").map(skill => skill.id).sort();
    expect(active).toEqual([...VETERAN_ACTIVE_SKILL_IDS].sort());
    for (const id of Object.keys(VETERAN_SKILLS)) expect(isVeteranSkillId(id)).toBe(true);
    for (const id of VETERAN_ACTIVE_SKILL_IDS) expect(isVeteranActiveSkillId(id)).toBe(true);
    expect(isVeteranActiveSkillId("veteranResilience")).toBe(false);
    for (const invalid of ["toString", "__proto__", "heal", "", null, 0, {}, []]) {
      expect(isVeteranSkillId(invalid)).toBe(false);
      expect(isVeteranActiveSkillId(invalid)).toBe(false);
    }
  });
});
