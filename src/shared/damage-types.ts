import type { AttackKind } from "./attack-presentation";
import type { AbilityKind, BuildingKind, ItemKind, UnitKind, WorldItem } from "./types";

export type DamageSchool = "physical" | "magic";
export type DamageDelivery = "melee" | "ranged" | "effect";
export type PhysicalDamageType = "cut" | "pierce" | "blunt";
export type DamageElement = "fire" | "poison" | "lightning" | "arcane";
/** A source's identity survives its death and must travel with projectiles. */
export type DamageOrigin = "unit" | "tower" | "spell";

/** School and delivery are independent: a magical attack can be melee or ranged. */
export type DamageProfile = {
  school: DamageSchool;
  delivery: DamageDelivery;
  physicalType?: PhysicalDamageType;
  element?: DamageElement;
  origin: DamageOrigin;
};

/** Each present dimension must match; values within an array are alternatives. */
export type DamageFilter = {
  [K in keyof DamageProfile]?: Exclude<DamageProfile[K], undefined> | readonly Exclude<DamageProfile[K], undefined>[];
};

export function matchesDamageProfile(profile: DamageProfile | undefined, filter: DamageFilter | undefined): boolean {
  if (!filter) return true;
  if (!profile) return false;
  for (const [dimension, accepted] of Object.entries(filter) as [keyof DamageProfile, string | readonly string[]][]) {
    const actual = profile[dimension];
    if (typeof accepted === "string" ? actual !== accepted : !actual || !accepted.includes(actual)) return false;
  }
  return true;
}

export const DAMAGE_PROFILES = {
  MELEE_CUT: { school: "physical", delivery: "melee", physicalType: "cut", origin: "unit" },
  MELEE_PIERCE: { school: "physical", delivery: "melee", physicalType: "pierce", origin: "unit" },
  MELEE_BLUNT: { school: "physical", delivery: "melee", physicalType: "blunt", origin: "unit" },
  RANGED_PIERCE: { school: "physical", delivery: "ranged", physicalType: "pierce", origin: "unit" },
  RANGED_BLUNT: { school: "physical", delivery: "ranged", physicalType: "blunt", origin: "unit" },
  FIRE_ARROW: { school: "physical", delivery: "ranged", physicalType: "pierce", element: "fire", origin: "unit" },
  MAGIC_MELEE: { school: "magic", delivery: "melee", element: "arcane", origin: "unit" },
  MAGIC_RANGED: { school: "magic", delivery: "ranged", element: "arcane", origin: "unit" },
  FIRE_RANGED: { school: "magic", delivery: "ranged", element: "fire", origin: "unit" },
  TOWER_ARROW: { school: "physical", delivery: "ranged", physicalType: "pierce", origin: "tower" },
  ARCANE: { school: "magic", delivery: "effect", element: "arcane", origin: "spell" },
  BURNING: { school: "magic", delivery: "effect", element: "fire", origin: "spell" },
  POISON: { school: "magic", delivery: "effect", element: "poison", origin: "spell" },
  LIGHTNING: { school: "magic", delivery: "ranged", element: "lightning", origin: "spell" },
  STORM: { school: "magic", delivery: "effect", element: "lightning", origin: "spell" },
  EXPLOSION: { school: "physical", delivery: "effect", physicalType: "blunt", origin: "spell" },
} as const satisfies Record<string, DamageProfile>;

const P = DAMAGE_PROFILES;

/** Explicit roster matrix: changing a unit's reach does not change its damage type. */
export const UNIT_DAMAGE_PROFILES: Record<UnitKind, DamageProfile> = {
  worker: P.MELEE_CUT,
  footman: P.MELEE_CUT,
  archer: P.RANGED_PIERCE,
  horseArcher: P.RANGED_PIERCE,
  raider: P.MELEE_CUT,
  lancer: P.MELEE_PIERCE,
  ashWarden: P.MELEE_PIERCE,
  emberRavager: P.MELEE_CUT,
  cinderRunner: P.MELEE_CUT,
  sparkArcher: P.FIRE_ARROW,
  emberAcolyte: P.MAGIC_RANGED,
  ashHexer: P.MAGIC_RANGED,
  pyreCaller: P.MAGIC_RANGED,
  knight: P.MELEE_CUT,
  priest: P.MAGIC_RANGED,
  summoner: P.MAGIC_RANGED,
  witch: P.MAGIC_RANGED,
  golem: P.MELEE_BLUNT,
  ashChieftain: P.MELEE_CUT,
  cinderRevenant: P.MELEE_CUT,
  spirit: P.MAGIC_MELEE,
  mercenary: P.MELEE_CUT,
  contractArcher: P.RANGED_PIERCE,
  fieldMedic: P.MAGIC_RANGED,
  wildling: P.MELEE_BLUNT,
  mossGnawer: P.MELEE_PIERCE,
  thornSlinger: P.RANGED_PIERCE,
  barkMender: P.MAGIC_RANGED,
  stonebackBrute: P.MELEE_BLUNT,
  gladeWitch: P.MAGIC_RANGED,
  // Bare transport/carrier hulls cannot attack; a mounted gun supplies its own profile.
  transport: P.MELEE_BLUNT,
  warship: P.RANGED_BLUNT,
  cutter: P.RANGED_PIERCE,
  bombardShip: P.RANGED_BLUNT,
  fireShip: P.FIRE_RANGED,
  carrier: P.MELEE_BLUNT,
  siegeRam: P.MELEE_BLUNT,
  ballista: P.RANGED_PIERCE,
  catapult: P.RANGED_BLUNT,
  organGun: P.RANGED_PIERCE,
  ancientStag: P.MELEE_PIERCE,
  murlocPeon: P.MELEE_PIERCE,
  murlocHunter: P.RANGED_PIERCE,
  tidePriest: P.MAGIC_RANGED,
  deepSnapper: P.MELEE_PIERCE,
  rubbleGolem: P.MELEE_BLUNT,
  rockGolem: P.MELEE_BLUNT,
  graniteGolem: P.MELEE_BLUNT,
  ogreWarrior: P.MELEE_BLUNT,
  ogreMage: P.MAGIC_RANGED,
  ogreLord: P.MELEE_BLUNT,
  spiderling: P.MELEE_PIERCE,
  venomSpider: P.MELEE_PIERCE,
  spiderQueen: P.MELEE_PIERCE,
  dragonWhelp: P.FIRE_RANGED,
  redDragon: P.FIRE_RANGED,
};

export const WEAPON_DAMAGE_PROFILES: Record<AttackKind, DamageProfile> = {
  melee: P.MELEE_BLUNT,
  arrow: P.RANGED_PIERCE,
  spear: P.RANGED_PIERCE,
  stone: P.RANGED_BLUNT,
  magic: P.MAGIC_RANGED,
  fire: P.FIRE_RANGED,
  bolt: P.RANGED_PIERCE,
  cannon: P.RANGED_BLUNT,
  mortar: P.RANGED_BLUNT,
  flame: P.FIRE_RANGED,
  grapeshot: P.RANGED_PIERCE,
};

export const ITEM_DAMAGE_PROFILES = {
  greatSword: P.MELEE_CUT,
  shipCannon: P.RANGED_BLUNT,
  shipMortar: P.RANGED_BLUNT,
  flameProjector: P.FIRE_RANGED,
  flameCloak: P.BURNING,
  lightningRod: P.LIGHTNING,
  stormStaff: P.STORM,
  breachCharge: P.EXPLOSION,
} as const satisfies Partial<Record<ItemKind, DamageProfile>>;

/** Charge inherits its actual weapon; non-damaging abilities need no profile. */
export const ABILITY_DAMAGE_PROFILES = {
  curse: P.ARCANE,
  ashCurse: P.ARCANE,
  pinningBolt: P.RANGED_PIERCE,
  incendiaryFlume: P.FIRE_RANGED,
} as const satisfies Partial<Record<AbilityKind, DamageProfile>>;

export type DamageWeapon = {
  delivery: "ram" | "bolt" | "shell" | "cone";
  presentation?: AttackKind;
  damageProfile?: DamageProfile;
};

export function weaponDamageProfile(weapon: DamageWeapon): DamageProfile {
  if (weapon.damageProfile) return weapon.damageProfile;
  if (weapon.delivery === "ram") return P.MELEE_BLUNT;
  if (weapon.presentation) return WEAPON_DAMAGE_PROFILES[weapon.presentation];
  return weapon.delivery === "shell" ? P.RANGED_BLUNT : P.RANGED_PIERCE;
}

export function attackDamageProfile(kind: UnitKind | BuildingKind, weapon?: DamageWeapon, equippedItem?: Pick<WorldItem, "kind" | "weaponKind">): DamageProfile {
  if (weapon) return weaponDamageProfile(weapon);
  if (equippedItem?.kind === "greatSword") return P.MELEE_CUT;
  if (equippedItem?.kind === "issuedWeapon" && equippedItem.weaponKind) return UNIT_DAMAGE_PROFILES[equippedItem.weaponKind];
  if (kind === "defenseTower") return P.TOWER_ARROW;
  return UNIT_DAMAGE_PROFILES[kind as UnitKind] ?? P.EXPLOSION;
}
