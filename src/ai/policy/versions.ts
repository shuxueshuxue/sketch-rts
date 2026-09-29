import { ABILITY_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { UnitKind } from "../../shared/types";
import type { PresetAiPolicyOptions } from "./types";

export function isTowerMercPolicy(options: PresetAiPolicyOptions) {
  return options.version === "v4-tr";
}

// V5's hybrid playbook (economy, expansions, camps, towers, army control). V6 and V7 are built on it, so this is true for
// all three; what only V5 does is gated by isV5ShooterCorePolicy, what V6 built by isV6Policy.
export function isV5HybridPolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5" || options.requestedVersion === "v6" || options.requestedVersion === "v7" || options.requestedVersion === "v8" || options.requestedVersion === "v9";
}

export function isV5ShooterCorePolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5";
}

// @@@v6-no-shooters - V6 plays 1v2 against V3 plus V5 without ever training or hiring a shooter. Casters and towers are
// allowed: they are not shooters. V7 runs on the machinery V6 built (doctrine, economy, general, backline, raids), so this
// is true for V7 too; what only V7 does is gated by isV7Policy.
export function isV6Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v6" || options.requestedVersion === "v7" || options.requestedVersion === "v8" || options.requestedVersion === "v9";
}

// @@@v7-blind - V7 plays 1v2 against any pair of V3, V5 and V6, as either race, and must tell what it faces from the board
// alone: nothing in V7 may read which version an opponent is (not its id, not its agent), only what its units do.
// V8 runs on V7's machinery, so this is true for V8 too; what only V8 does is gated by isV8Policy, and a change meant for
// V8 alone must never go behind this gate (V7 is V8's frozen opponent).
export function isV7Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v7" || options.requestedVersion === "v8" || options.requestedVersion === "v9";
}

// @@@v8-blind - V8 plays 1v2 against any pair of V3, V5 and V7, as either race, under V7's blindness rule.
// V9 runs on V8's machinery, so this is true for V9 too; what only V9 does is gated by isV9Policy, and a change meant for
// V9 alone must never go behind this gate (V8 is V9's frozen opponent).
export function isV8Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v8" || options.requestedVersion === "v9";
}

// @@@v9-blind - V9 plays 1v3 against V5, V7 and V8 together, as either race, under V7's blindness rule, and may train or
// hire any unit: no kind is forbidden to it.
export function isV9Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v9";
}

export const SHOOTER_UNIT_KINDS: ReadonlySet<UnitKind> = new Set(["archer", "sparkArcher", "contractArcher"]);

// Units whose ability summons (the grove summoner, the Ember pyre caller, and any other): read from the catalog.
export const SUMMONING_UNIT_KINDS: ReadonlySet<UnitKind> = new Set(
  (Object.keys(UNIT_DEFS) as UnitKind[]).filter((kind) => UNIT_DEFS[kind].abilities.some((ability) => ABILITY_DEFS[ability].behavior === "summon")),
);

// @@@v8-forbidden-units - V8 never trains or hires a shooter or a summoner: its army fights at arm's length, with healers
// and cursers behind it (casters are not shooters, as for V6), and towers.
export const V8_FORBIDDEN_UNIT_KINDS: ReadonlySet<UnitKind> = new Set([...SHOOTER_UNIT_KINDS, ...SUMMONING_UNIT_KINDS]);
