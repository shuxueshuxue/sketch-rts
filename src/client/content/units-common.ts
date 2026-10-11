import type { TrainableUnitKind } from "../../shared/types";
import type { TrainedUnitCard } from "./cards";
import { unitPainter } from "../art/painted-units";

export const COMMON_UNITS = {
  priest: {
    name: { en: "Priest", zh: "牧师" },
    description: { en: "Support caster with a targeted heal for wounded non-mechanical allies.", zh: "支援施法者，可以对受伤的非机械友军进行定点治疗。" },
    command: { icon: "+", hotkey: "p" },
    glyph: { silhouette: "priest-medallion", marks: ["halo", "cross", "satchel"] },
    art: { tier: "advanced", bearing: "foot", faction: "common" },
    paint: unitPainter("priest"),
  },
  summoner: {
    name: { en: "Summoner", zh: "召唤师" },
    description: { en: "Caster that creates a temporary spirit at a target point.", zh: "施法者，可以在目标点召唤临时灵体。" },
    command: { icon: "◎", hotkey: "u" },
    glyph: { silhouette: "summoner-ring", marks: ["outerRing", "innerSigil", "spark"] },
    art: { tier: "advanced", bearing: "foot", faction: "common" },
    paint: unitPainter("summoner"),
  },

  worker: {
    name: { en: "Worker", zh: "农民" },
    description: { en: "Worker. Gathers gold, builds structures, repairs the economy, and can defend itself only in a pinch.", zh: "农民。采集金矿、建造建筑、修理经济体系，紧急时也能勉强自卫。" },
    command: { icon: "⌘", hotkey: "w" },
    glyph: { silhouette: "worker-apron", marks: ["pick", "satchel", "coinSlash"] },
    art: { tier: "civilian", bearing: "foot", faction: "grove" },
    paint: unitPainter("worker"),
  },
  // Both races' ships (see @@@ships): a hull on the water, the owner's colour on the sail.
  transport: {
    name: { en: "Transport", zh: "运输船" },
    description: { en: "Open-deck ship with no built-in weapon. Crew can move, fight and cast aboard; footprint and payload limit embarkation. Unloads near shore; sinking loses its crew.", zh: "开放甲板运输船，无固定武器。乘员可在船上移动、战斗和施法；占地与载重共同限制人数。靠岸卸载，船沉时乘员一同损失。" },
    command: { icon: "⛴", hotkey: "t" },
    glyph: { silhouette: "transport-hull", marks: ["mast", "cargo", "flag"] },
    art: { tier: "advanced", bearing: "vessel", faction: "grove" },
    paint: unitPainter("transport"),
  },
  warship: {
    name: { en: "Warship", zh: "战船" },
    description: { en: "Ship. Shoots ships and anything on the shore within its range, about an archer's. A tower outranges it. Limited deck space supports embarked ranged troops or a healer.", zh: "船。攻击射程内的船和岸上目标，射程与弓手相当；防御塔比它打得远。有限甲板可搭载射手或治疗者协同作战。" },
    command: { icon: "⚔", hotkey: "w" },
    glyph: { silhouette: "warship-hull", marks: ["mast", "cannon", "flag"] },
    art: { tier: "elite", bearing: "vessel", faction: "grove" },
    paint: unitPainter("warship"),
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;
