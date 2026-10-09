import type { AbilityKind } from "../shared/types";
import type { VeteranSkillId } from "../shared/veteran-skills";
import { joinPublicPath } from "../shared/deployment-base";

export type AbilityIconId = AbilityKind | VeteranSkillId
  | "guardianScroll" | "statusSlow" | "statusPoison" | "statusStun";

/** Each command and status loads one small image; the review atlas is never shipped to the browser. */
export const ABILITY_ICON_FILES: Readonly<Record<AbilityIconId, string>> = {
  heal: "heal.webp", summon: "summon.webp", curse: "curse.webp",
  emberMend: "emberMend.webp", cinderSoul: "cinderSoul.webp", ashCurse: "ashCurse.webp",
  charge: "charge.webp", stomp: "stomp.webp", bloodlust: "bloodlust.webp", web: "web.webp",
  pinningBolt: "pinningBolt.webp", incendiaryFlume: "incendiaryFlume.webp",
  veteranResilience: "veteranResilience.webp", veteranMobility: "veteranMobility.webp",
  veteranCommand: "veteranCommand.webp", veteranVigilance: "veteranVigilance.webp",
  veteranRally: "veteranRally.webp", veteranPhalanx: "veteranPhalanx.webp",
  veteranSteadyAim: "veteranSteadyAim.webp", veteranMarch: "veteranMarch.webp",
  veteranHealingWave: "veteranHealingWave.webp", veteranInnerFire: "veteranInnerFire.webp",
  veteranRenewal: "veteranRenewal.webp", veteranSiegeDrill: "veteranSiegeDrill.webp",
  veteranEndurance: "veteranEndurance.webp", guardianScroll: "guardianScroll.webp",
  statusSlow: "statusSlow.webp", statusPoison: "statusPoison.webp", statusStun: "statusStun.webp",
};

export function abilityIconUrl(id: AbilityIconId, basePath = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/") {
  return joinPublicPath(basePath, `art/abilities/${ABILITY_ICON_FILES[id]}`);
}

export function abilityIconMarkup(id: AbilityIconId) {
  return `<img class="ability-symbol" src="${abilityIconUrl(id)}" width="64" height="64" alt="" aria-hidden="true" decoding="async">`;
}
