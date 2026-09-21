import { UNIT_DEFS } from "../shared/catalog";
import type { AbilityKind, UnitKind } from "../shared/types";

export type UnitVisualRole =
  | "worker"
  | "line"
  | "bruiser"
  | "mobility"
  | "ranged"
  | "caster"
  | "support"
  | "heavy"
  | "mercenary"
  | "creep"
  | "creep-heavy"
  | "creep-caster"
  | "summoned"
  | "boss";

export type UnitVisualTier = 0 | 1 | 2 | 3 | 4 | 5;

export type UnitVisualProfile = {
  kind: UnitKind;
  role: UnitVisualRole;
  tier: UnitVisualTier;
  /** A deterministic comparison score derived from live catalog values. */
  valueScore: number;
  bodyScale: number;
  armor: "workwear" | "cloth" | "leather" | "plate" | "stone" | "bark" | "spirit";
  accent: "grove" | "ember" | "brass" | "wild" | "neutral";
  cost: number;
  supply: number;
  abilities: readonly AbilityKind[];
};

const ROLE_OVERRIDES: Record<UnitKind, UnitVisualRole> = {
  worker: "worker",
  footman: "line",
  archer: "ranged",
  raider: "mobility",
  lancer: "line",
  groveWarden: "line",
  emberRavager: "bruiser",
  cinderRunner: "mobility",
  sparkArcher: "ranged",
  emberAcolyte: "support",
  ashHexer: "caster",
  pyreCaller: "caster",
  knight: "heavy",
  priest: "support",
  summoner: "caster",
  witch: "caster",
  golem: "heavy",
  spirit: "summoned",
  mercenary: "mercenary",
  contractArcher: "mercenary",
  fieldMedic: "support",
  wildling: "creep",
  mossGnawer: "creep",
  thornSlinger: "creep",
  barkMender: "creep-caster",
  stonebackBrute: "creep-heavy",
  gladeWitch: "creep-caster",
  ancientStag: "boss",
};

const EMBER_UNITS = new Set<UnitKind>([
  "emberRavager",
  "cinderRunner",
  "sparkArcher",
  "emberAcolyte",
  "ashHexer",
  "pyreCaller",
]);

const GROVE_UNITS = new Set<UnitKind>([
  "footman",
  "archer",
  "raider",
  "lancer",
  "groveWarden",
  "knight",
  "priest",
  "summoner",
  "witch",
  "golem",
]);

const ABILITY_VALUE: Record<AbilityKind, number> = {
  heal: 34,
  summon: 38,
  curse: 42,
  emberMend: 34,
  cinderSoul: 38,
  ashCurse: 46,
};

/**
 * Compare units using the same catalog that drives simulation and tooltips.
 * HP, damage-per-second, reach, speed, supply, cost and spell utility all
 * contribute. This is a visual hierarchy, not a balance score.
 */
export function unitVisualValueScore(kind: UnitKind) {
  const def = UNIT_DEFS[kind];
  const dps = def.attackDamage / Math.max(0.1, def.attackCooldown / 20);
  const abilityValue = def.abilities.reduce((total, ability) => total + ABILITY_VALUE[ability], 0);
  return def.hp * 0.35 + dps * 18 + Math.min(def.attackRange, 450) * 0.09 + def.speed * 8 + def.supplyUsed * 10 + def.cost * 0.1 + def.trainTime * 0.025 + abilityValue + (def.creepFoodPower ?? 0) * 10;
}

function tierForValue(valueScore: number): UnitVisualTier {
  if (valueScore >= 470) return 5;
  if (valueScore >= 360) return 4;
  if (valueScore >= 270) return 3;
  if (valueScore >= 205) return 2;
  if (valueScore >= 150) return 1;
  return 0;
}

function armorForRole(role: UnitVisualRole): UnitVisualProfile["armor"] {
  if (role === "worker") return "workwear";
  if (role === "heavy") return "stone";
  if (role === "creep-heavy" || role === "boss") return "bark";
  if (role === "caster" || role === "support" || role === "creep-caster") return "cloth";
  if (role === "summoned") return "spirit";
  if (role === "line" || role === "bruiser") return "plate";
  return "leather";
}

function bodyScaleFor(kind: UnitKind, role: UnitVisualRole, tier: UnitVisualTier) {
  if (kind === "golem") return 1.38;
  if (kind === "knight") return 1.27;
  if (kind === "ancientStag") return 1.48;
  const roleScale: Record<UnitVisualRole, number> = {
    worker: 0.82,
    line: 1,
    bruiser: 1.02,
    mobility: 0.96,
    ranged: 0.9,
    caster: 0.91,
    support: 0.89,
    heavy: 1.23,
    mercenary: 1.08,
    creep: 0.88,
    "creep-heavy": 1.18,
    "creep-caster": 0.94,
    summoned: 0.84,
    boss: 1.42,
  };
  return Math.round((roleScale[role] + tier * 0.012) * 100) / 100;
}

export function unitVisualProfile(kind: UnitKind): UnitVisualProfile {
  const role = ROLE_OVERRIDES[kind];
  const tier = tierForValue(unitVisualValueScore(kind));
  return {
    kind,
    role,
    tier,
    valueScore: Math.round(unitVisualValueScore(kind) * 10) / 10,
    bodyScale: bodyScaleFor(kind, role, tier),
    armor: armorForRole(role),
    accent: EMBER_UNITS.has(kind) ? "ember" : GROVE_UNITS.has(kind) ? "grove" : role === "mercenary" || role === "heavy" ? "brass" : role === "boss" || role.startsWith("creep") ? "wild" : "neutral",
    cost: UNIT_DEFS[kind].cost,
    supply: UNIT_DEFS[kind].supplyUsed,
    abilities: UNIT_DEFS[kind].abilities,
  };
}

export const UNIT_VISUAL_PROFILES = Object.fromEntries(Object.keys(UNIT_DEFS).map((kind) => [kind, unitVisualProfile(kind as UnitKind)])) as Record<UnitKind, UnitVisualProfile>;

export const RANKED_UNIT_VISUAL_PROFILES = Object.values(UNIT_VISUAL_PROFILES).sort((a, b) => b.valueScore - a.valueScore);
