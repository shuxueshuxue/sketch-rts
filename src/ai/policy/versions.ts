import type { UnitKind } from "../../shared/types";
import type { PresetAiPolicyOptions } from "./types";

export function isTowerMercPolicy(options: PresetAiPolicyOptions) {
  return options.version === "v4-tr";
}

// V5's hybrid playbook (economy, expansions, camps, towers, army control). V6 is built on it, so this is true for both;
// what only V5 does is gated by isV5ShooterCorePolicy, what only V6 does by isV6Policy.
export function isV5HybridPolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5" || options.requestedVersion === "v6";
}

export function isV5ShooterCorePolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5";
}

// @@@v6-no-shooters - V6 plays 1v2 against V3 plus V5 without ever training or hiring a shooter. Casters and towers are
// allowed: they are not shooters.
export function isV6Policy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v6";
}

export const SHOOTER_UNIT_KINDS: ReadonlySet<UnitKind> = new Set(["archer", "sparkArcher", "contractArcher"]);
