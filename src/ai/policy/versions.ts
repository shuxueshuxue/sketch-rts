import type { UnitKind } from "../../shared/types";
import type { PresetAiPolicyOptions } from "./types";

export function isTowerMercPolicy(options: PresetAiPolicyOptions) {
  return options.version === "v4-tr";
}

// V5's hybrid playbook (economy, expansions, camps, towers, army control). V6 and V7 are built on it, so this is true for
// all three; what only V5 does is gated by isV5ShooterCorePolicy, what V6 built by isV6Policy.
export function isV5HybridPolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5" || options.requestedVersion === "v6" || options.requestedVersion === "v7";
}

export function isV5ShooterCorePolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5";
}

// @@@v6-no-shooters - V6 plays 1v2 against V3 plus V5 without ever training or hiring a shooter. Casters and towers are
// allowed: they are not shooters. V7 runs on the machinery V6 built (doctrine, economy, general, backline, raids), so this
// is true for V7 too; what only V7 does is gated by isV7Policy.
export function isV6Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v6" || options.requestedVersion === "v7";
}

// @@@v7-blind - V7 plays 1v2 against any pair of V3, V5 and V6, as either race, and must tell what it faces from the board
// alone: nothing in V7 may read which version an opponent is (not its id, not its agent), only what its units do.
export function isV7Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v7";
}

export const SHOOTER_UNIT_KINDS: ReadonlySet<UnitKind> = new Set(["archer", "sparkArcher", "contractArcher"]);
