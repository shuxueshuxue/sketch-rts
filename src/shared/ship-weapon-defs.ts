import type { WeaponDef } from "./catalog";
import type { ShipEquipmentKind } from "./types";
import { seconds } from "./time";

// Complete trained ships cost about 40% more, rounded to 20 gold; troop hulls
// cost 50% more for their larger compartment. Included guns retain item prices.
export const SHIP_HULL_COST = { cutter: 160, transport: 240, warship: 320, bombardShip: 470, fireShip: 340, carrier: 420, shipOfTheLine: 1080 } as const;
/** Prices paid by unfinished jobs in saves written before paidGold was recorded. */
export const PREVIOUS_SHIP_TRAIN_COST = { cutter:120, transport:160, warship:390, bombardShip:570, fireShip:370, carrier:280, shipOfTheLine:1400 } as const;
export const SHIP_WEAPONS: Record<ShipEquipmentKind, {
    cost: number;
    mass: number;
    hp: number;
    damage: number;
    range: number;
    cooldown: number;
    aimSpeed: number;
    aimRangeBuffer?: number;
    weapon: WeaponDef;
    art: 'warship' | 'bombardShip' | 'fireShip';
}> = {
    // @@@cannon-min-range - A broadside cannot be depressed onto a hull lying alongside. A gun reckons a ship and its deck
    // by the whole hull (see @@@hull-reach), so the dead zone has only to cover the hull of a ship grappled for boarding:
    // side by side at most GANGWAY_MAX_GAP (36) apart and at most MAX_HEADING_DELTA (8.6 degrees) askew, the farthest
    // its nearest side lies from any gun whose traverse covers it is 104.6 (a ship of the line's after gun against a
    // cutter; measured over every pair of kinds, both sides). With room for the hulls to work at the bridge, 125: a
    // fight at the rail is the crews' own, and from 125 to 312 the broadsides duel. (240 was set when a gun could
    // still fire across a deck at the crew on its far side.)
    shipCannon: { cost: 220, mass: 160, hp: 90, damage: 20, range: 312, cooldown: seconds(2), aimSpeed: 440, weapon: { presentation:'cannon', delivery: 'bolt', radius: 8, blastRadius: 48, maxHits: 1, minRange: 125, navalMultiplier: 2, hullDamageShare: 1.25 }, art: 'warship' },
    shipMortar: { cost: 330, mass: 240, hp: 100, damage: 36, range: 576, cooldown: seconds(3.6), aimSpeed: 400, weapon: { presentation:'mortar', delivery: 'shell', radius: 75, minRange: 180, buildingMultiplier: 2, navalMultiplier: 1.7, hullDamageShare: 1.5 }, art: 'bombardShip' },
    flameProjector: { cost: 180, mass: 120, hp: 80, damage: 10, range: 144, cooldown: seconds(1.2), aimSpeed: 480, weapon: { presentation:'flame', delivery: 'cone', coneAngle: .85, buildingMultiplier: .7 }, art: 'fireShip' },
};
