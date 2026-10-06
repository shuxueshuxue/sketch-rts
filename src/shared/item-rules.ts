import { seconds } from "./time";

// Item simulation and localized descriptions read these same values.
export const LIGHTNING_ROD = { range: 280, damage: 84, hits: 3, bounceRange: 170, decay: 0.68, minimumDamage: 18, cooldown: seconds(18) };
export const STORM_STAFF = { range: 320, radius: 145, impactDamage: 24, pulseDamage: 6, pulseEvery: seconds(1.2), duration: seconds(4.8), cooldown: seconds(27) };
export const FLAME_CLOAK = { radius: 90, damage: 12, interval: seconds(2) };
export const GUARDIAN_SCROLL = { radius: 280, duration: seconds(7) };
export const BREACH_CHARGE = { range: 280, damage: 260 };
export const IVORY_TOWER_HP_SHARE = 0.5;
