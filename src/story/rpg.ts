import { resolveVariant, type UnitVariantDef, type UnitVariantStats } from "../shared/catalog";
import type { CastMember } from "./cast";
import type { Operation } from "./kernel";
import { every } from "./ops";
import type { Empowered } from "./powers";
import type { PartyMember, PartyView, Text } from "./stage";
import { seconds } from "./time";
import type { World } from "./world";

// @@@story-rpg - The role-playing layer, on top of the story's own tools: heroes level up by the experience their kills
// earn (the sim already counts it on every unit) and the quests the story rewards, and carry gear that changes their
// numbers. What a hero has become is plain data in the story's variables (a save keeps it with the checkpoint); its
// unit's rules are recomputed from that data (base + levels + gear) whenever it changes, through the hero's variant, so
// no stat is ever patched on a unit by hand and nothing drifts when the sim re-derives it.

export type Gear = { id: string; name: Text; note: Text; stats: UnitVariantStats };

export type HeroRecord = { level: number; gear: string[] };

export type Hero = { member: CastMember; unitId: string; powers?: Empowered };

export class Party {
  private readonly heroes = new Map<string, Hero>();

  constructor(
    private readonly world: World,
    // Kept in the story's variables, keyed by cast member id.
    private readonly records: Record<string, HeroRecord>,
    private readonly gear: Readonly<Record<string, Gear>>,
    private readonly onLevel?: (hero: Hero, level: number) => void,
  ) {}

  // Takes a hero into the party (its unit already on the field); its rules are derived from its record.
  join(member: CastMember, unitId: string, powers?: Empowered): Hero {
    if (!member.hero) throw new Error(`${member.id} is no hero`);
    this.records[member.id] ??= { level: 1, gear: [] };
    const hero = { member, unitId, ...(powers ? { powers } : {}) };
    this.heroes.set(member.id, hero);
    this.world.rewrite(member.id, this.rulesOf(member));
    return hero;
  }

  leave(memberId: string) {
    this.heroes.delete(memberId);
  }

  record(memberId: string): HeroRecord {
    const record = this.records[memberId];
    if (!record) throw new Error(`${memberId} has no record`);
    return record;
  }

  hero(memberId: string): Hero | undefined {
    return this.heroes.get(memberId);
  }

  levelOf(memberId: string): number {
    return this.records[memberId]?.level ?? 1;
  }

  // The level this much experience earns on the hero's curve.
  levelFor(member: CastMember, xp: number): number {
    const thresholds = member.hero?.thresholds ?? [];
    let level = 1;
    for (const needed of thresholds) if (xp >= needed) level += 1;
    return level;
  }

  equip(memberId: string, gearId: string) {
    const gear = this.gear[gearId];
    if (!gear) throw new Error(`Unknown gear ${gearId}`);
    const record = this.record(memberId);
    if (record.gear.includes(gearId)) return;
    record.gear.push(gearId);
    const hero = this.heroes.get(memberId);
    if (hero) this.world.rewrite(memberId, this.rulesOf(hero.member));
  }

  // Levels come as the experience does: checked twice a second for as long as the party's scope runs.
  *watch(): Operation<void> {
    const party = this;
    yield* every(seconds(0.5), function* levels() {
      for (const hero of party.heroes.values()) party.catchUp(hero);
    }, "party:levels");
  }

  view(): PartyView {
    const members: PartyMember[] = [];
    for (const hero of this.heroes.values()) {
      const unit = this.world.unit(hero.unitId);
      if (!unit) continue;
      const level = this.levelOf(hero.member.id);
      const thresholds = hero.member.hero?.thresholds ?? [];
      const xpNext = thresholds[level - 1];
      members.push({
        unitId: unit.id,
        name: hero.member.name,
        color: hero.member.color ?? "#315f87",
        level,
        xp: unit.xp,
        xpFloor: level >= 2 ? (thresholds[level - 2] ?? 0) : 0,
        ...(xpNext !== undefined ? { xpNext } : {}),
        hp: unit.hp,
        maxHp: unit.maxHp,
        skills: (hero.powers?.powers ?? []).map((power) => ({ name: power.name, ready: hero.powers!.readiness(power.id) })),
        gear: this.record(hero.member.id).gear.map((id) => this.gear[id]?.name ?? id),
      });
    }
    return { members };
  }

  private catchUp(hero: Hero) {
    const unit = this.world.unit(hero.unitId);
    if (!unit) return;
    const record = this.record(hero.member.id);
    const earned = this.levelFor(hero.member, unit.xp);
    if (earned <= record.level) return;
    record.level = earned;
    this.world.rewrite(hero.member.id, this.rulesOf(hero.member));
    this.onLevel?.(hero, earned);
  }

  // Base rules, plus every level past the first, plus the gear.
  private rulesOf(member: CastMember): UnitVariantDef {
    const record = this.record(member.id);
    const rules: UnitVariantDef = { ...member.rules };
    // Growth adds to the numbers the hero plays by, including those it takes from its base kind.
    const full = resolveVariant(member.rules);
    for (const key of ADDITIVE) {
      const value = full[key];
      if (value !== undefined) rules[key] = value;
    }
    const growth = member.hero?.perLevel ?? {};
    addStats(rules, growth, record.level - 1);
    for (const id of record.gear) addStats(rules, this.gear[id]?.stats ?? {}, 1);
    return rules;
  }
}

const ADDITIVE = ["hp", "speed", "radius", "attackDamage", "attackRange", "attackCooldown", "regenPerSecond", "xpReward"] as const;

function addStats(rules: UnitVariantDef, delta: UnitVariantStats, times: number) {
  if (times <= 0) return;
  for (const key of ADDITIVE) {
    const add = delta[key];
    if (add === undefined) continue;
    const base = rules[key] ?? 0;
    rules[key] = key === "attackCooldown" ? Math.max(4, Math.round(base + add * times)) : Math.round((base + add * times) * 100) / 100;
  }
  if (delta.armor) rules.armor = delta.armor;
  if (delta.casterSlayer) rules.casterSlayer = Math.max(rules.casterSlayer ?? 1, delta.casterSlayer);
}
