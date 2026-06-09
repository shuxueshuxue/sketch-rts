import type { PresetAiPolicyOptions } from "./types";

export function isTowerMercPolicy(options: PresetAiPolicyOptions) {
  return options.version === "v4-tr";
}

export function isV5HybridPolicy(options: PresetAiPolicyOptions) {
  return options.requestedVersion === "v5";
}
