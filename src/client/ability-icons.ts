import type { AbilityKind } from "../shared/types";
import type { VeteranSkillId } from "../shared/veteran-skills";
import { joinPublicPath } from "../shared/deployment-base";

export type AbilityIconId = AbilityKind | VeteranSkillId
  | "guardianScroll" | "statusSlow" | "statusPoison" | "statusStun";

/** Each command and status loads one self-contained hand-authored SVG; authoring sources and the review sheet stay outside the runtime. */
export const ABILITY_ICON_FILES: Readonly<Record<AbilityIconId, string>> = {
  heal: "heal.svg", summon: "summon.svg", curse: "curse.svg",
  emberMend: "emberMend.svg", cinderSoul: "cinderSoul.svg", ashCurse: "ashCurse.svg",
  charge: "charge.svg", stomp: "stomp.svg", bloodlust: "bloodlust.svg", web: "web.svg",
  pinningBolt: "pinningBolt.svg", incendiaryFlume: "incendiaryFlume.svg",
  veteranResilience: "veteranResilience.svg", veteranMobility: "veteranMobility.svg",
  veteranCommand: "veteranCommand.svg", veteranVigilance: "veteranVigilance.svg",
  veteranRally: "veteranRally.svg", veteranPhalanx: "veteranPhalanx.svg",
  veteranSteadyAim: "veteranSteadyAim.svg", veteranMarch: "veteranMarch.svg",
  veteranHealingWave: "veteranHealingWave.svg", veteranInnerFire: "veteranInnerFire.svg",
  veteranRenewal: "veteranRenewal.svg", veteranSiegeDrill: "veteranSiegeDrill.svg",
  veteranEndurance: "veteranEndurance.svg", guardianScroll: "guardianScroll.svg",
  statusSlow: "statusSlow.svg", statusPoison: "statusPoison.svg", statusStun: "statusStun.svg",
};

export function abilityIconUrl(id: AbilityIconId, basePath = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/") {
  return joinPublicPath(basePath, `art/abilities/${ABILITY_ICON_FILES[id]}`);
}

export function abilityIconMarkup(id: AbilityIconId) {
  return `<img class="ability-symbol" src="${abilityIconUrl(id)}" width="64" height="64" alt="" aria-hidden="true" decoding="async">`;
}
