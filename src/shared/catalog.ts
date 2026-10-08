import { SHIP_HULL_COST, SHIP_WEAPONS } from "./ship-equipment";
import type { AttackKind } from "./attack-presentation";
import type { Mover } from "./terrain";
import type { AbilityKind, BuildingKind, MercenaryUnitKind, RaceId, TrainableUnitKind, UnitKind, UpgradeKind } from "./types";
import { creepGoldBounty, unitValue } from "./unit-value";
import { seconds } from "./time";
import { VETERAN_ACTIVE_SKILL_IDS, VETERAN_SKILLS, type VeteranActiveSkillId } from "./veteran-skills";
import type { DamageProfile } from "./damage-types";
import type { UnitClass, UnitTargetFilter } from "./unit-targeting";

export const MERCENARY_HIRE_RANGE = 220;
export const SUPPORT_BUILDING_HEAL = 5;
export const DOCK_REPAIR = { range: 240, hpPerSecond: 3, goldPerSecond: 1 };

/** Weapon rules belong to the simulation, independent of maps and AI versions. */
export type WeaponDef = {
  damageProfile?: DamageProfile;
  presentation?: AttackKind;
  delivery: "ram" | "bolt" | "shell" | "cone";
  buildingMultiplier?: number;
  navalMultiplier?: number;
  minRange?: number;
  radius?: number;
  /** A direct cannonball bursts at its first impact; engineering bolts keep piercing. */
  blastRadius?: number;
  hullDamageShare?: number;
  maxHits?: number;
  pierceShare?: number;
  coneAngle?: number;
  burst?: number;
};

// @@@catalog-rules - A unit's rules say where it comes from: the building that trains it and the race that owns it (no
// race: every race). Unit kinds, each building's training list, each race's units and buildings, and the lists command
// validation checks against are all derived from these rows, so a new unit or building is one row here (plus its card
// in client/content for how it looks); nothing else in shared/ needs to be told.
export type UnitDef = {
  unitClass: UnitClass;
  trainedAt?: BuildingKind;
  race?: RaceId;
  hp: number;
  /** Movement distance per second. */
  speed: number;
  radius: number;
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  cost: number;
  trainTime: number;
  supplyUsed: number;
  xpReward: number;
  creepFoodPower?: number;
  goldBounty?: number;
  abilities: AbilityKind[];
  armor?: "heavy";
  // Damage multiplier against summoned units and casters (units with an ability).
  casterSlayer?: number;
  // Innate health regeneration, on top of leadership's.
  regenPerSecond?: number;
  // Advanced (2) and elite (3) units; see TIER_SUPPLY_CAP. No tier: trainable from the start.
  tier?: 2 | 3;
  // A ship (see @@@naval): it sails deep and shallow water and nothing else.
  naval?: true;
  /** A hull's own attack, independent of installed and removable ship weapons. */
  intrinsicAttack?: true;
  /** Ship passives applied to live passengers, removed immediately on unloading. */
  passengerDamageMultiplier?: number;
  weapon?: WeaponDef;
  /** Weapon/proficiency reticle distance per second before the global multiplier; allowed displacement from the last shot. */
  aimSpeed?: number;
  aimMoveTolerance?: number;
  // @@@creep-traits - What a creep's blow does besides its damage: slows its target (a murloc hunter's net), poisons it (a
  // venom spider's bite), or strikes every enemy round it for a share of the blow (a red dragon's fire).
  slowOnHit?: true;
  poisonOnHit?: true;
  splash?: true;
  // How much harder a camp with this creep is than its health and damage say: the AIs weigh camps by it (see ai
  // combatRating). These account for body size, armor and status effects beyond raw DPS.
  // Recalibrate the whole ladder with scripts/neutral-balance.ts after changing creep stats.
  threat?: number;
};

// @@@creep-trait-numbers - The traits' one number each: a net slows its target to SLOW_PACE for SLOW_TICKS; a bite
// poisons for POISON_TICKS at POISON_DAMAGE a second (a second bite starts it over); fire strikes enemies within
// SPLASH_RADIUS of the target for SPLASH_SHARE of the blow.
export const SLOW_PACE = 0.7;
export const SLOW_TICKS = seconds(3);
export const POISON_TICKS = seconds(4);
export const POISON_DAMAGE = 3;
export const SPLASH_RADIUS = 50;
export const SPLASH_SHARE = 0.15;

// @@@unit-tiers - Advanced and elite units are locked until the player's supply cap (halls and farms built, not supply in
// use) reaches a bar: the tech a player buys is supply, the way a Warcraft III player buys a keep and a castle. Early
// fights are fought with the basic line (footmen, archers, ravagers, runners, spark archers). Measured over 16 AI games
// at a farm's 120 gold: V6, which buys farms ahead of need, fields its first caster at about 5:00, V3 and V5 their first
// advanced unit at 7:00-8:30; no AI reached the elite bar inside 12 minutes.
export const TIER_SUPPLY_CAP = { 2: 42, 3: 60 } as const;

// Upkeep: from LOW_UPKEEP_SUPPLY in use a player banks 70% of the gold its workers bring back, from HIGH_UPKEEP_SUPPLY 40%.
export const LOW_UPKEEP_SUPPLY = 51;
export const HIGH_UPKEEP_SUPPLY = 81;

// Heavy armor (knights, golems, ash chieftains and cinder revenants): a shooter's or caster's attack deals half damage, a defense
// tower's 70%. Melee blows land in full.
export { HEAVY_ARMOR_DAMAGE } from "./damage-reduction";

// Whether a unit casts the ability on its own (see autocast): "on" and "off" are the default of an ability the player can
// switch, "none" one that is only ever cast by hand. As in Warcraft III, nearly every unit ability starts on.
export type AutocastDefault = "on" | "off" | "none";

export type AbilityDef = { autocast: AutocastDefault; targets?: UnitTargetFilter } & (
  | { behavior: "veteran"; skill: VeteranActiveSkillId; range: number; plannerRange: number; cooldown: number; effectType: "heal" | "guardianField" | "bloodlust" }
  | { behavior: "weapon"; target: "enemy" | "point"; weapon: WeaponDef; range: number; plannerRange: number; cooldown: number; damage: number; rootTicks?: number; burnTicks?: number; effectType: "siegeImpact" | "shellFlight" | "siegeBolt" | "grapeshot" | "burningGround" }
  | { behavior: "heal"; range: number; plannerRange: number; cooldown: number; healAmount: number; effectType: "heal" }
  | { behavior: "summon"; range: number; plannerRange: number; cooldown: number; summonKind: UnitKind; summonDuration: number; effectType: "summon" }
  // A dash at an enemy unit between minRange and range away, striking it for damageMultiplier times the weapon's blow.
  | { behavior: "charge"; minRange: number; range: number; plannerRange: number; cooldown: number; damageMultiplier: number; drive: number; effectType: "chargeTrail" }
  // A creep's own: stun every enemy unit within range; quicken an ally's blows; root one enemy (see @@@creep-abilities).
  | { behavior: "stomp"; range: number; plannerRange: number; cooldown: number; effectDuration: number; effectType: "stomp" }
  | { behavior: "bloodlust"; range: number; plannerRange: number; cooldown: number; effectDuration: number; attackSpeed: number; effectType: "bloodlust" }
  | { behavior: "web"; range: number; plannerRange: number; cooldown: number; effectDuration: number; effectType: "web" }
  | {
      behavior: "curse";
      range: number;
      plannerRange: number;
      cooldown: number;
      effectDuration: number;
      damageMultiplier: number;
      scorchedDamageMultiplier?: number;
      // Damage dealt at once to a summoned target (a spirit has 85 hp): the witch's answer to a summoner's free army.
      summonedDamage?: number;
      statusType: "curse";
      effectType: "curse" | "scorch";
    }
);

export type BuildingRules = {
  /** Target-specific passive modifier, applied in addition to armor. */
  neutralDamageMultiplier?: number;
  race?: RaceId;
  hp: number;
  radius: number;
  cost: number;
  buildTime: number;
  researches: UpgradeKind[];
  attackDamage: number;
  attackRange: number;
  attackCooldown: number;
  supplyProvided: number;
  // Stands on the shore, part of it where a worker walks and part over open water (see @@@shore-footprint); every other
  // building stands on walkable ground.
  shore?: true;
};

// What the building trains is derived from the units' trainedAt, in catalog order.
export type BuildingDef = BuildingRules & { trains: TrainableUnitKind[] };

export type UpgradeDef = {
  researchBuildingKinds: BuildingKind[];
  affectedUnitKinds: TrainableUnitKind[];
  levels: readonly UpgradeLevelDef[];
};

export type UpgradeLevelDef = {
  cost: number;
  researchTime: number;
  attackMultiplier?: number;
  maxHpMultiplier?: number;
  buildingMaxHpMultiplier?: number;
  speedMultiplier?: number;
  attackRangeMultiplier?: number;
  // Health a second for a veteran of one, two and three stars.
  veteranRegenByStars?: readonly [number, number, number];
};

export type RaceDef = {
  id: RaceId;
  name: string;
  note: string;
  trainableUnits: TrainableUnitKind[];
  buildableBuildings: BuildingKind[];
  upgrades: UpgradeKind[];
};

// Ranged basic attacks, including hired troops, creeps and naval guns, use 80% of their former reach.
export const UNIT_RULES = {
  worker: { trainedAt: "townHall", hp: 70, speed: 60, radius: 15, attackDamage: 10, attackRange: 36, attackCooldown: seconds(1.7), cost: 75, trainTime: seconds(7), supplyUsed: 1, abilities: [] },
  footman: { trainedAt: "barracks", race: "grove", hp: 145, speed: 62, radius: 18, attackDamage: 16, attackRange: 48, attackCooldown: seconds(1.1), cost: 100, trainTime: seconds(8), supplyUsed: 2, abilities: [] },
  archer: { trainedAt: "archeryRange", race: "grove", hp: 83, speed: 60, radius: 16, attackDamage: 13, attackRange: 319.2, aimSpeed: 480, attackCooldown: seconds(1.5), cost: 115, trainTime: seconds(7.75), supplyUsed: 2, abilities: [] },
  // The cavalry strikes from the saddle with a reach a little under the lancer's 74 (it had a footman's, 48 and 52).
  horseArcher: { trainedAt: "stables", race: "grove", hp: 109, speed: 90, radius: 19, attackDamage: 10, attackRange: 264, aimSpeed: 600, attackCooldown: seconds(1.5), cost: 150, trainTime: seconds(10), supplyUsed: 2, abilities: [], tier: 2, aimMoveTolerance: 72 },
  raider: { trainedAt: "stables", race: "grove", hp: 115, speed: 82, radius: 18, attackDamage: 14, attackRange: 72, attackCooldown: seconds(1), cost: 115, trainTime: seconds(8.5), supplyUsed: 2, abilities: ["charge"], tier: 2 },
  lancer: { trainedAt: "barracks", race: "grove", hp: 130, speed: 68, radius: 18, attackDamage: 18, attackRange: 74, attackCooldown: seconds(1.4), cost: 110, trainTime: seconds(8.75), supplyUsed: 2, abilities: [] },
  ashWarden: { trainedAt: "emberForge", race: "ember", hp: 165, speed: 60, radius: 19, attackDamage: 15, attackRange: 52, attackCooldown: seconds(1.15), cost: 120, trainTime: seconds(9), supplyUsed: 2, abilities: [] },
  emberRavager: { trainedAt: "emberForge", race: "ember", hp: 118, speed: 76, radius: 18, attackDamage: 20, attackRange: 52, attackCooldown: seconds(1.25), cost: 120, trainTime: seconds(9), supplyUsed: 2, abilities: [] },
  cinderRunner: { trainedAt: "emberForge", race: "ember", hp: 96, speed: 87, radius: 17, attackDamage: 14, attackRange: 48, attackCooldown: seconds(0.95), cost: 110, trainTime: seconds(8), supplyUsed: 2, abilities: [] },
  sparkArcher: { trainedAt: "cinderSpire", race: "ember", hp: 75, speed: 63, radius: 16, attackDamage: 12, attackRange: 288, aimSpeed: 540, attackCooldown: seconds(1.35), cost: 110, trainTime: seconds(7.25), supplyUsed: 2, abilities: [] },
  emberAcolyte: { trainedAt: "cinderSpire", race: "ember", hp: 78, speed: 62, radius: 16, attackDamage: 6, attackRange: 192, aimSpeed: 480, attackCooldown: seconds(1.8), cost: 130, trainTime: seconds(8.75), supplyUsed: 2, abilities: ["emberMend"], tier: 2 },
  ashHexer: { trainedAt: "cinderSpire", race: "ember", hp: 82, speed: 64, radius: 16, attackDamage: 7, attackRange: 240, aimSpeed: 520, attackCooldown: seconds(1.7), cost: 140, trainTime: seconds(9), supplyUsed: 2, abilities: ["ashCurse"], tier: 2 },
  pyreCaller: { trainedAt: "cinderSpire", race: "ember", hp: 88, speed: 59, radius: 17, attackDamage: 7, attackRange: 208, aimSpeed: 440, attackCooldown: seconds(1.9), cost: 174, trainTime: seconds(9.5), supplyUsed: 2, abilities: ["cinderSoul"], tier: 2 },
  knight: { trainedAt: "stables", race: "grove", hp: 220, speed: 72, radius: 22, attackDamage: 24, attackRange: 72, attackCooldown: seconds(1.3), cost: 190, trainTime: seconds(11.5), supplyUsed: 3, abilities: ["charge"], armor: "heavy", tier: 3 },
  priest: { trainedAt: "sanctum", race: "grove", hp: 90, speed: 60, radius: 16, attackDamage: 7, attackRange: 201.6, aimSpeed: 440, attackCooldown: seconds(1.8), cost: 135, trainTime: seconds(9.25), supplyUsed: 2, abilities: ["heal"], tier: 2 },
  summoner: { trainedAt: "sanctum", race: "grove", hp: 95, speed: 56, radius: 17, attackDamage: 8, attackRange: 218.4, aimSpeed: 400, attackCooldown: seconds(1.9), cost: 180, trainTime: seconds(10.5), supplyUsed: 2, abilities: ["summon"], tier: 2 },
  witch: { trainedAt: "sanctum", race: "grove", hp: 92, speed: 62, radius: 16, attackDamage: 8, attackRange: 252, aimSpeed: 480, attackCooldown: seconds(1.7), cost: 145, trainTime: seconds(9.75), supplyUsed: 2, abilities: ["curse"], tier: 2 },
  golem: { unitClass: "mechanical", trainedAt: "workshop", race: "grove", hp: 340, speed: 42, radius: 28, attackDamage: 34, attackRange: 58, attackCooldown: seconds(2.1), cost: 230, trainTime: seconds(14), supplyUsed: 4, abilities: [], armor: "heavy", tier: 3 },
  // Ember's heavies, raised in the ashen hall and heavy-armored like the grove's knight and golem, but built for
  // other jobs. The chieftain hunts casters and what they summon (half again as much damage to both); the revenant is
  // light for an elite and burns its wounds away, back to full health in about twenty seconds.
  ashChieftain: { trainedAt: "ashenHall", race: "ember", hp: 210, speed: 66, radius: 20, attackDamage: 22, attackRange: 52, attackCooldown: seconds(1.2), cost: 190, trainTime: seconds(11), supplyUsed: 3, abilities: [], armor: "heavy", casterSlayer: 1.5, tier: 3 },
  cinderRevenant: { trainedAt: "ashenHall", race: "ember", hp: 150, speed: 70, radius: 19, attackDamage: 21, attackRange: 52, attackCooldown: seconds(1.15), cost: 210, trainTime: seconds(12), supplyUsed: 3, abilities: [], armor: "heavy", regenPerSecond: 7, tier: 3 },
  spirit: { hp: 85, speed: 70, radius: 15, attackDamage: 13, attackRange: 55, attackCooldown: seconds(1.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, abilities: [] },
  mercenary: { hp: 155, speed: 74, radius: 18, attackDamage: 28, attackRange: 62, attackCooldown: seconds(0.9), cost: 160, trainTime: seconds(0.05), supplyUsed: 2, abilities: [] },
  contractArcher: { hp: 93, speed: 64, radius: 16, attackDamage: 19, attackRange: 352.8, aimSpeed: 600, attackCooldown: seconds(1.35), cost: 145, trainTime: seconds(0.05), supplyUsed: 2, abilities: [] },
  fieldMedic: { hp: 105, speed: 62, radius: 16, attackDamage: 8, attackRange: 210.4, aimSpeed: 480, attackCooldown: seconds(1.7), cost: 155, trainTime: seconds(0.05), supplyUsed: 2, abilities: ["heal"] },
  wildling: { hp: 76, speed: 76, radius: 15, attackDamage: 10, attackRange: 42, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  mossGnawer: { hp: 54, speed: 84, radius: 13, attackDamage: 8, attackRange: 34, attackCooldown: seconds(1.3), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  thornSlinger: { hp: 83, speed: 68, radius: 18, attackDamage: 13, attackRange: 132, aimSpeed: 400, attackCooldown: seconds(1.7), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: [] },
  barkMender: { hp: 68, speed: 64, radius: 18, attackDamage: 7, attackRange: 88, aimSpeed: 400, attackCooldown: seconds(2.1), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: ["heal"] },
  stonebackBrute: { hp: 210, speed: 72, radius: 24, attackDamage: 28, attackRange: 48, attackCooldown: seconds(1.9), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: [] },
  gladeWitch: { hp: 110, speed: 66, radius: 22, attackDamage: 13, attackRange: 120, aimSpeed: 440, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: ["curse"] },
  // @@@ships - Both races can board every ship. Transport passengers deal half damage;
  // warships have sturdier hulls and a cannon. Deck space and mass determine crew capacity.
  transport: { unitClass: "mechanical", trainedAt: "shipyard", hp: 270, speed: 64, radius: 30, attackDamage: 0, attackRange: 0, attackCooldown: seconds(1), cost: 160, trainTime: seconds(12), supplyUsed: 1, abilities: [], naval: true, passengerDamageMultiplier: .5 },
  warship: { unitClass: "mechanical", trainedAt: "shipyard", hp: 320, speed: 60, radius: 28, attackDamage: 20, attackRange: 312, aimSpeed: 440, attackCooldown: seconds(2), cost: SHIP_HULL_COST.warship + SHIP_WEAPONS.shipCannon.cost, trainTime: seconds(14), supplyUsed: 3, abilities: [], naval: true, weapon: SHIP_WEAPONS.shipCannon.weapon },
  cutter: { unitClass: "mechanical", trainedAt: "shipyard", hp: 110, speed: 84, radius: 24, attackDamage: 10, attackRange: 264, aimSpeed: 540, attackCooldown: seconds(1.3), cost: 120, trainTime: seconds(9), supplyUsed: 2, abilities: [], naval: true, intrinsicAttack: true },
  bombardShip: { unitClass: "mechanical", trainedAt: "shipyard", hp: 260, speed: 44, radius: 32, attackDamage: 36, attackRange: 576, aimSpeed: 400, attackCooldown: seconds(3.6), cost: SHIP_HULL_COST.bombardShip + SHIP_WEAPONS.shipMortar.cost, trainTime: seconds(19), supplyUsed: 4, abilities: [], naval: true, tier: 2, weapon: { presentation: "mortar", delivery: "shell", radius: 75, minRange: 180, buildingMultiplier: 2 } },
  fireShip: { unitClass: "mechanical", trainedAt: "shipyard", hp: 340, speed: 70, radius: 28, attackDamage: 10, attackRange: 144, aimSpeed: 480, attackCooldown: seconds(1.2), cost: SHIP_HULL_COST.fireShip + SHIP_WEAPONS.flameProjector.cost, trainTime: seconds(15), supplyUsed: 3, abilities: ["incendiaryFlume"], naval: true, weapon: { presentation: "flame", delivery: "cone", coneAngle: 0.85, buildingMultiplier: 0.7 } },
  carrier: { unitClass: "mechanical", trainedAt: "shipyard", hp: 480, speed: 54, radius: 38, attackDamage: 0, attackRange: 0, attackCooldown: seconds(1), cost: 280, trainTime: seconds(18), supplyUsed: 3, abilities: [], naval: true, armor: "heavy", tier: 2 },
  siegeRam: { unitClass: "mechanical", trainedAt: "workshop", race: "ember", hp: 420, speed: 50, radius: 26, attackDamage: 22, attackRange: 64, attackCooldown: seconds(1.8), cost: 240, trainTime: seconds(16), supplyUsed: 3, abilities: [], armor: "heavy", tier: 2, weapon: { presentation: "melee", delivery: "ram", buildingMultiplier: 3.3 } },
  ballista: { unitClass: "mechanical", trainedAt: "workshop", race: "grove", hp: 150, speed: 46, radius: 24, attackDamage: 27, attackRange: 472, aimSpeed: 420, attackCooldown: seconds(2.4), cost: 300, trainTime: seconds(15), supplyUsed: 3, abilities: ["pinningBolt"], tier: 2, weapon: { presentation: "bolt", delivery: "bolt", radius: 18, maxHits: 3, pierceShare: 0.7, buildingMultiplier: 0.75, navalMultiplier: 1.4 } },
  catapult: { unitClass: "mechanical", trainedAt: "workshop", race: "ember", hp: 180, speed: 38, radius: 27, attackDamage: 38, attackRange: 608, aimSpeed: 360, attackCooldown: seconds(3.8), cost: 390, trainTime: seconds(19), supplyUsed: 4, abilities: [], tier: 2, weapon: { presentation: "stone", delivery: "shell", radius: 90, minRange: 180, buildingMultiplier: 2 } },
  organGun: { unitClass: "mechanical", trainedAt: "workshop", race: "ember", hp: 190, speed: 46, radius: 25, attackDamage: 12, attackRange: 304, aimSpeed: 480, attackCooldown: seconds(2.5), cost: 350, trainTime: seconds(17), supplyUsed: 3, abilities: [], tier: 2, weapon: { presentation: "grapeshot", delivery: "cone", coneAngle: 0.42, burst: 3, buildingMultiplier: 0.45 } },
  ancientStag: { hp: 360, speed: 88, radius: 32, attackDamage: 38, attackRange: 68, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 5, abilities: [] },
  // @@@creep-families - The camp families (see shared/camps.ts), a creep's level its food power, bounty and experience by
  // level (20/35/50/68/85/100/130 gold at levels 1-8). A tier's camps are as hard as the old wildling camps of that tier:
  // health and damage were set so that a squad of two footmen to an archer sized to the tier (3, 5, 7) loses as much,
  // for the camp's level, clearing the new templates as the old ones, within a tenth on average (green 0.96, orange
  // 1.09, red 1.06); a power changes how a camp fights, not how hard it is. Each has one trait or ability at most (see
  // @@@creep-traits), and none reaches past a tower's 480, so no creep wakes from farther than today. None is wider
  // than 28: a blow's reach is measured from center to center, and a footman (radius 18, reach 48) could not strike a
  // wider one through their bodies.
  murlocPeon: { hp: 80, speed: 72, radius: 14, attackDamage: 11, attackRange: 40, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  murlocHunter: { hp: 98, speed: 72, radius: 15, attackDamage: 13, attackRange: 120, aimSpeed: 480, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: [], slowOnHit: true, threat: 1.05 },
  tidePriest: { hp: 100, speed: 64, radius: 17, attackDamage: 10, attackRange: 160, aimSpeed: 440, attackCooldown: seconds(1.9), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: ["heal"] },
  deepSnapper: { hp: 350, speed: 70, radius: 26, attackDamage: 31, attackRange: 52, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 5, abilities: [], armor: "heavy", threat: 1.25 },
  rubbleGolem: { unitClass: "mechanical", hp: 190, speed: 50, radius: 22, attackDamage: 22, attackRange: 48, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: [], armor: "heavy" },
  rockGolem: { unitClass: "mechanical", hp: 235, speed: 50, radius: 25, attackDamage: 25, attackRange: 52, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 4, abilities: [], armor: "heavy", threat: 1.3 },
  graniteGolem: { unitClass: "mechanical", hp: 390, speed: 48, radius: 28, attackDamage: 35, attackRange: 58, attackCooldown: seconds(2.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 6, abilities: ["stomp"], armor: "heavy", threat: 1.3 },
  ogreWarrior: { hp: 178, speed: 68, radius: 22, attackDamage: 22, attackRange: 52, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 3, abilities: [] },
  ogreMage: { hp: 145, speed: 64, radius: 22, attackDamage: 15, attackRange: 160, aimSpeed: 400, attackCooldown: seconds(1.8), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 4, abilities: ["bloodlust"], threat: 1.15 },
  ogreLord: { hp: 380, speed: 68, radius: 28, attackDamage: 34, attackRange: 56, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 6, abilities: [], threat: 1.35 },
  spiderling: { hp: 65, speed: 88, radius: 12, attackDamage: 10, attackRange: 36, attackCooldown: seconds(1.2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 1, abilities: [] },
  venomSpider: { hp: 105, speed: 84, radius: 15, attackDamage: 13, attackRange: 44, attackCooldown: seconds(1.5), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 2, abilities: [], poisonOnHit: true, threat: 1.7 },
  spiderQueen: { hp: 350, speed: 80, radius: 26, attackDamage: 33, attackRange: 52, attackCooldown: seconds(1.7), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 5, abilities: ["web"] },
  dragonWhelp: { hp: 170, speed: 84, radius: 22, attackDamage: 17, attackRange: 144, aimSpeed: 540, attackCooldown: seconds(1.6), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 4, abilities: [] },
  redDragon: { hp: 600, speed: 80, radius: 28, attackDamage: 42, attackRange: 176, aimSpeed: 480, attackCooldown: seconds(2), cost: 0, trainTime: seconds(0.05), supplyUsed: 0, creepFoodPower: 8, abilities: [], splash: true, threat: 1.3 },
} satisfies Record<string, Omit<UnitDef, "xpReward" | "goldBounty" | "unitClass"> & { unitClass?: UnitClass }>;

export const UNIT_DEFS: Record<UnitKind, UnitDef> = Object.fromEntries(
  Object.entries(UNIT_RULES).map(([kind, row]) => {
    const def: UnitDef = { unitClass: "nonMechanical", ...row, xpReward: 0 };
    def.xpReward = kind === "spirit" ? 0 : Math.round(unitValue(def) / 3);
    if (def.creepFoodPower) def.goldBounty = creepGoldBounty(def.creepFoodPower, def.threat);
    return [kind, def];
  }),
) as Record<UnitKind, UnitDef>;

// @@@unit-variants - A campaign's own units (a hero, a boss, a beast of its story) are variants of a catalog unit, as
// Warcraft III's custom units copy a base unit's row: a variant names its base kind and restates only the numbers it
// changes. The unit still has its base kind, so every table keyed by kind (the AIs' heuristics, command validation,
// the tooltips) takes it for its base, as any subtype passes for its supertype; the sim, which knows variants, plays it
// by its own numbers. Its abilities are its base's: a campaign's own powers are scripts (see story/). Variants live in
// the game that uses them (Game.variants), never in these tables, so no campaign can move the balance of any other game.
export type UnitVariantStats = Partial<Pick<UnitDef, "hp" | "speed" | "radius" | "attackDamage" | "attackRange" | "attackCooldown" | "supplyUsed" | "xpReward" | "goldBounty" | "armor" | "casterSlayer" | "regenPerSecond" | "unitClass">>;

export type UnitVariantDef = UnitVariantStats & {
  base: UnitKind;
  // A hero grows by its campaign's rules (levels, gear) instead of the veterancy stars kills give an ordinary unit.
  heroic?: boolean;
};

// A variant's full rules: its base kind's row with the variant's numbers laid over it.
export type VariantRules = UnitDef & { base: UnitKind; heroic?: boolean };

// The rules a unit plays by: its kind's catalog row, or its variant's. A game (or a snapshot of one) carries its own
// variants; a view without them takes a variant for its base kind.
export function unitRules(game: { variants?: Readonly<Record<string, VariantRules>> }, unit: { kind: UnitKind; variant?: string | undefined }): UnitDef {
  if (unit.variant === undefined || !game.variants) return UNIT_DEFS[unit.kind];
  const rules = game.variants[unit.variant];
  if (!rules) throw new Error(`Unknown unit variant ${unit.variant}`);
  return rules;
}

export function resolveVariant(def: UnitVariantDef): VariantRules {
  const { base, heroic, ...stats } = def;
  const rules: VariantRules = { ...UNIT_DEFS[base], ...definedStats(stats), base };
  if (heroic) rules.heroic = true;
  return rules;
}

function definedStats(stats: UnitVariantStats): UnitVariantStats {
  return Object.fromEntries(Object.entries(stats).filter(([, value]) => value !== undefined)) as UnitVariantStats;
}

// The supply cap a player needs before it can train this kind (0 for the basic line, workers and hired units).
export function requiredSupplyCap(kind: UnitKind): number {
  const tier = UNIT_DEFS[kind].tier;
  return tier ? TIER_SUPPLY_CAP[tier] : 0;
}
const UNIT_KINDS = Object.keys(UNIT_DEFS) as UnitKind[];

// @@@naval - Ships sail the water every other unit is kept out of, and a unit's kind says which it is: every terrain query
// a unit makes is its mover's (see @@@terrain-movers). The ships' kinds are a set, as the sim asks of every walking unit
// every tick.
const NAVAL_KINDS: ReadonlySet<UnitKind> = new Set(UNIT_KINDS.filter((kind) => UNIT_DEFS[kind].naval));
export function unitMover(kind: UnitKind): Mover {
  return NAVAL_KINDS.has(kind) ? "sea" : "land";
}

export const TRAINABLE_UNIT_KINDS = UNIT_KINDS.filter((kind) => UNIT_DEFS[kind].trainedAt !== undefined) as TrainableUnitKind[];

export const MERCENARY_UNIT_KINDS: MercenaryUnitKind[] = ["mercenary", "contractArcher", "fieldMedic"];

export const ABILITY_KINDS: AbilityKind[] = ["heal", "summon", "curse", "emberMend", "cinderSoul", "ashCurse", "charge", "stomp", "bloodlust", "web", "pinningBolt", "incendiaryFlume", ...VETERAN_ACTIVE_SKILL_IDS];

// What a curse deals at once to a summoned unit (a spirit has 85 hp): both races' curses are the answer to a summoner's
// free army, so they share the one number.
const CURSE_SUMMONED_DAMAGE = 100;

export const ABILITY_DEFS: Record<AbilityKind, AbilityDef> = {
  ...Object.fromEntries(VETERAN_ACTIVE_SKILL_IDS.map(skill => {
    const effect = VETERAN_SKILLS[skill].effect;
    if (effect.type !== "active") throw new Error(`Veteran ability ${skill} must be active`);
    return [skill, { behavior: "veteran", skill, range: effect.radius, plannerRange: effect.radius, cooldown: effect.cooldown,
      effectType: effect.action === "heal" ? "heal" : effect.modifiers.damageReduction ? "guardianField" : "bloodlust", autocast: "on", ...(effect.targets ? { targets: effect.targets } : {}) }];
  })) as Record<VeteranActiveSkillId, AbilityDef>,
  pinningBolt: { behavior: "weapon", target: "enemy", weapon: { presentation: "bolt", delivery: "bolt", radius: 20, maxHits: 3, pierceShare: 0.7 }, range: 472, plannerRange: 472, cooldown: seconds(14), damage: 36, rootTicks: seconds(2), effectType: "siegeBolt", autocast: "none" },
  incendiaryFlume: { behavior: "weapon", target: "point", weapon: { presentation: "fire", delivery: "shell", radius: 85, buildingMultiplier: 0.7 }, range: 224, plannerRange: 224, cooldown: seconds(18), damage: 14, burnTicks: seconds(4), effectType: "burningGround", autocast: "none" },

  // With spells on their own cooldowns (see ability-cooldowns) a healer heals through every fight. At one heal every 6s,
  // 9 health a second, two mirrored default AIs fought for 41 minutes on verdantCrossroads (12.7 before) and never ended on
  // wildMarches. Every 12s is Warcraft III's measure: a priest's mana holds it to about a third of a footman's damage.
  heal: { behavior: "heal", targets: { unitClasses: ["nonMechanical"] }, range: 240, plannerRange: 220, cooldown: seconds(12), healAmount: 55, effectType: "heal", autocast: "on" },
  summon: { behavior: "summon", range: 260, plannerRange: 240, cooldown: seconds(40), summonKind: "spirit", summonDuration: seconds(60), effectType: "summon", autocast: "on" },
  curse: { behavior: "curse", range: 280, plannerRange: 260, cooldown: seconds(7.5), effectDuration: seconds(18), damageMultiplier: 0.4, summonedDamage: CURSE_SUMMONED_DAMAGE, statusType: "curse", effectType: "curse", autocast: "on" },
  emberMend: { behavior: "heal", targets: { unitClasses: ["nonMechanical"] }, range: 240, plannerRange: 220, cooldown: seconds(12), healAmount: 55, effectType: "heal", autocast: "on" },
  cinderSoul: { behavior: "summon", range: 260, plannerRange: 240, cooldown: seconds(40), summonKind: "spirit", summonDuration: seconds(60), effectType: "summon", autocast: "on" },
  ashCurse: { behavior: "curse", range: 280, plannerRange: 260, cooldown: seconds(7.5), effectDuration: seconds(18), damageMultiplier: 0.45, scorchedDamageMultiplier: 0.3, summonedDamage: CURSE_SUMMONED_DAMAGE, statusType: "curse", effectType: "scorch", autocast: "on" },
  // The cavalry's charge: from 180 to 300 away, a slide that would carry the rider `drive` past the unit it meets (see
  // @@@charge), and a blow of twice the weapon's.
  charge: { behavior: "charge", minRange: 180, range: 300, plannerRange: 288, cooldown: seconds(15), damageMultiplier: 2, drive: 100, effectType: "chargeTrail", autocast: "on" },
  // @@@creep-abilities - The creeps' own, cast by themselves only: a granite golem's stomp stuns every enemy unit within
  // 160 for 1.5s, every 12s; an ogre mage's bloodlust quickens a fighting ally's blows by 30% for 15s, every 20s; a spider
  // queen's web roots one enemy within 220 in place for 2s, every 10s.
  stomp: { behavior: "stomp", range: 160, plannerRange: 150, cooldown: seconds(12), effectDuration: seconds(1.5), effectType: "stomp", autocast: "on" },
  bloodlust: { behavior: "bloodlust", range: 300, plannerRange: 280, cooldown: seconds(20), effectDuration: seconds(15), attackSpeed: 1.3, effectType: "bloodlust", autocast: "on" },
  web: { behavior: "web", range: 220, plannerRange: 200, cooldown: seconds(10), effectDuration: seconds(2), effectType: "web", autocast: "on" },
};

// A spell, as against a blow of the body like the charge: what a caster is, and what the ash chieftain hunts.
export function isSpell(ability: AbilityKind) {
  return ABILITY_DEFS[ability].behavior !== "charge" && ABILITY_DEFS[ability].behavior !== "weapon";
}

export function hasSpell(kind: UnitKind) {
  return UNIT_DEFS[kind].abilities.some(isSpell);
}

export const BUILDING_RULES = {
  townHall: { hp: 900, radius: 48, cost: 400, buildTime: seconds(28), researches: ["buildingDurability"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 8 },
  barracks: { race: "grove", hp: 620, radius: 40, cost: 170, buildTime: seconds(11), researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  archeryRange: { race: "grove", hp: 520, radius: 38, cost: 150, buildTime: seconds(10), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  stables: { race: "grove", hp: 560, radius: 42, cost: 175, buildTime: seconds(11.5), researches: ["speedTraining"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  sanctum: { race: "grove", hp: 500, radius: 38, cost: 175, buildTime: seconds(11.25), researches: ["leadership"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  workshop: { hp: 580, radius: 42, cost: 205, buildTime: seconds(12.5), researches: ["rangeTraining"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  defenseTower: { neutralDamageMultiplier: 0.5, hp: 200, radius: 30, cost: 125, buildTime: seconds(6.5), researches: [], attackDamage: 16, attackRange: 480, attackCooldown: seconds(1.5), supplyProvided: 0 },
  moonWell: { race: "grove", hp: 300, radius: 30, cost: 115, buildTime: seconds(8.5), researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  emberForge: { race: "ember", hp: 560, radius: 40, cost: 165, buildTime: seconds(10.5), researches: ["weaponTraining", "reinforcedPlating"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  cinderSpire: { race: "ember", hp: 500, radius: 38, cost: 170, buildTime: seconds(10.75), researches: ["speedTraining", "rangeTraining", "leadership"], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  emberShrine: { race: "ember", hp: 280, radius: 30, cost: 115, buildTime: seconds(8.5), researches: [], attackDamage: 0, attackRange: 210, attackCooldown: seconds(1.5), supplyProvided: 0 },
  // Ember's heavy-unit hall, its stables and workshop in one: one building for both heavies, priced above either.
  ashenHall: { race: "ember", hp: 600, radius: 42, cost: 215, buildTime: seconds(13), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0 },
  // Supply is the tech (see unit-tiers), so it is dear: a farm's 6 cost 120, a hall's 8 are priced the same inside its 400.
  farm: { hp: 320, radius: 30, cost: 120, buildTime: seconds(7), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 6 },
  // Ships are built here (see @@@naval); every race builds it, as it does a tower or a farm.
  shipyard: { hp: 600, radius: 44, cost: 170, buildTime: seconds(12), researches: [], attackDamage: 0, attackRange: 0, attackCooldown: seconds(0.05), supplyProvided: 0, shore: true },
} satisfies Record<string, BuildingRules>;

export const BUILDABLE_BUILDING_KINDS = Object.keys(BUILDING_RULES) as BuildingKind[];

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = Object.fromEntries(
  BUILDABLE_BUILDING_KINDS.map((kind) => [kind, { ...BUILDING_RULES[kind], trains: TRAINABLE_UNIT_KINDS.filter((unit) => UNIT_DEFS[unit].trainedAt === kind) }]),
) as Record<BuildingKind, BuildingDef>;

const ORDINARY_COMBAT_UNITS = TRAINABLE_UNIT_KINDS.filter((kind) => kind !== "worker");

// @@@share-of-own-stats - Weapons and plating scale each unit's own attack and health, as speed and range already do. A flat
// +2 attack / +10 health was worth a tenth of a raider's price but a thirtieth of a knight's (plating: 1% of a knight's, 0
// of a chieftain's), so tech pushed every army toward cheap mass. Each +15% level is worth 8-11% of the gold of the units it
// reaches (equal-gold mirror duels, ten unit kinds, 8 to 24 units), and a level reaches every unit alive when it completes
// or trained after: about 3,500 gold of units for an army that keeps fighting, 2-5 times what stands at that moment. The
// prices return about 1.8 times their gold on that reach, as weapons I and II already did for light units.

export const UPGRADE_DEFS: Record<UpgradeKind, UpgradeDef> = {
  weaponTraining: {
    researchBuildingKinds: ["barracks", "emberForge"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 150, researchTime: seconds(34.5), attackMultiplier: 1.15 },
      { cost: 175, researchTime: seconds(46.5), attackMultiplier: 1.3 },
      { cost: 200, researchTime: seconds(60), attackMultiplier: 1.45 },
    ],
  },
  reinforcedPlating: {
    researchBuildingKinds: ["barracks", "emberForge"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 180, researchTime: seconds(40.5), maxHpMultiplier: 1.15 },
      { cost: 210, researchTime: seconds(52.5), maxHpMultiplier: 1.3 },
      { cost: 240, researchTime: seconds(66), maxHpMultiplier: 1.45 },
    ],
  },
  buildingDurability: {
    researchBuildingKinds: ["townHall"],
    affectedUnitKinds: [],
    levels: [
      { cost: 200, researchTime: seconds(54), buildingMaxHpMultiplier: 1.2 },
    ],
  },
  // A tenth faster a level: at a quarter a level (1.25, 1.38, 1.5) a footman at the third outran a raider untrained (4.5
  // against 82), and the riders' speed was theirs no more.
  speedTraining: {
    researchBuildingKinds: ["stables", "cinderSpire"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 185, researchTime: seconds(46), speedMultiplier: 1.1 },
      { cost: 285, researchTime: seconds(60), speedMultiplier: 1.2 },
      { cost: 420, researchTime: seconds(76), speedMultiplier: 1.3 },
    ],
  },
  rangeTraining: {
    researchBuildingKinds: ["workshop", "cinderSpire"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    levels: [
      { cost: 195, researchTime: seconds(48), attackRangeMultiplier: 1.15 },
      { cost: 305, researchTime: seconds(64), attackRangeMultiplier: 1.25 },
      { cost: 450, researchTime: seconds(82), attackRangeMultiplier: 1.35 },
    ],
  },
  leadership: {
    researchBuildingKinds: ["sanctum", "cinderSpire"],
    affectedUnitKinds: ORDINARY_COMBAT_UNITS,
    // @@@leadership-by-stars - A second and a third star are worth more than the first. One star regenerates 1, 2 and 3
    // health a second by the research's level, as it always did; two stars 3, 5 and 7; three stars 6, 9 and 12. A single
    // three-star veteran repays the first level on its own: 6 a second for 200 gold, where a moon well gives 3.3 for 115.
    // Each later level adds one a second per star, for armies with many veterans. At one a second per star for 220 gold,
    // the two to four stars a gauntlet army carries at 5-13 minutes regenerated half of what a well bought for the gold.
    levels: [
      { cost: 200, researchTime: seconds(52), veteranRegenByStars: [1, 3, 6] },
      { cost: 300, researchTime: seconds(70), veteranRegenByStars: [2, 5, 9] },
      { cost: 450, researchTime: seconds(90), veteranRegenByStars: [3, 7, 12] },
    ],
  },
};

export const UPGRADE_KINDS: UpgradeKind[] = ["weaponTraining", "reinforcedPlating", "buildingDurability", "speedTraining", "rangeTraining", "leadership"];
export const MAX_UPGRADE_LEVEL = 3;
export function maxUpgradeLevel(upgradeKind: UpgradeKind) {
  return UPGRADE_DEFS[upgradeKind].levels.length;
}

// @@@construction-hp - A building under construction starts at a tenth of its health and gains the rest as the work goes
// (Warcraft III's rule): a site is easy to knock down, and what it lost while rising stays lost when it stands. A site used
// to stand at full health from the first second, so a hall still rising took as long to kill as a finished one.
export const CONSTRUCTION_START_HP_SHARE = 0.1;

export function constructionStartHp(maxHp: number) {
  return Math.max(1, Math.round(maxHp * CONSTRUCTION_START_HP_SHARE));
}

export const RACE_IDS: RaceId[] = ["grove", "ember"];

function raceDef(id: RaceId, name: string, note: string): RaceDef {
  const owns = (race: RaceId | undefined) => race === undefined || race === id;
  return {
    id,
    name,
    note,
    trainableUnits: TRAINABLE_UNIT_KINDS.filter((kind) => owns(UNIT_DEFS[kind].race)),
    buildableBuildings: BUILDABLE_BUILDING_KINDS.filter((kind) => owns(BUILDING_DEFS[kind].race)),
    upgrades: UPGRADE_KINDS,
  };
}

export const RACE_DEFS: Record<RaceId, RaceDef> = {
  grove: raceDef("grove", "Grove Kin", "Durable line holders, conventional ranged units, heavy tech, and moon-well recovery."),
  ember: raceDef("ember", "Ember Pact", "Faster fragile fighters, early support casters, ashen-hall heavies, and ember-shrine recovery."),
};

export const HEALING_BUILDING_KINDS: BuildingKind[] = ["moonWell", "emberShrine"];

export function isHealingBuildingKind(kind: string): kind is BuildingKind {
  return (HEALING_BUILDING_KINDS as readonly string[]).includes(kind);
}

export function healingBuildingKindForRace(race: RaceId): BuildingKind {
  return race === "ember" ? "emberShrine" : "moonWell";
}
