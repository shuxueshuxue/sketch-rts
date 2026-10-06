import type { GlyphMark } from "../glyphs";
import type { TrainedUnitCard } from "./cards";
import { warfarePainter } from "../art/warfare-units";
const EN: Record<string, string> = {
    cutter: "Fast scouting vessel; useful for pursuit and harassment, vulnerable to heavy ships.",
    bombard: "Lobs shells at fixed ground positions. Strong against coastal buildings, with a minimum firing range.",
    fireship: "Short range flame fan punishes clustered ships. Incendiary shells leave a burning area.",
    carrier: "Armored transport carrying a large army. Slow and dependent on escorts; sinking loses its passengers.",
    ram: "Armored melee siege engine. Its ordinary strikes deal bonus structure damage.",
    ballista: "Bolts pierce aligned targets. Pinning bolts briefly root targets; lateral movement can dodge them.",
    mortar: "Fixed-position stone shells deal splash and bonus structure damage. Needs protection inside its dead zone.",
    organ: "Directional burst volleys suppress clustered infantry; weak against buildings."
};
const MARKS: Record<string, GlyphMark[]> = { cutter: ["mast", "flag", "arrow"], bombard: ["mast", "cannon", "blockSeams", "flag"], fireship: ["mast", "spark", "cannon", "flag"], carrier: ["mast", "cargo", "shieldBar", "flag"], ram: ["blockSeams", "towerShield", "reins"], ballista: ["blockSeams", "bow", "arrow"], mortar: ["blockSeams", "cargo", "flag"], organ: ["blockSeams", "cannon", "arrow", "spark"] };
function card(en: string, zh: string, description: string, model: string, hotkey: string, naval = false): TrainedUnitCard {
    return { name: { en, zh }, description: { en: EN[model]!, zh: description }, command: { icon: naval ? "⚓" : "⚙", hotkey },
        glyph: { silhouette: naval ? "warship-hull" : "golem-block", marks: MARKS[model]! },
        art: { tier: model === "cutter" ? "basic" : "elite", bearing: naval ? "vessel" : "construct", faction: ["ram", "mortar", "organ"].includes(model) ? "ember" : "grove" }, paint: warfarePainter(model) };
}
export const WARFARE_UNITS = {
    cutter: card("Cutter", "巡海快艇", "轻型快速舰艇，适合侦察、追击和骚扰；不宜与重舰正面对射。", "cutter", "q", true),
    bombardShip: card("Bombard Ship", "臼炮舰", "抛射炮弹轰击海岸建筑；炮弹落点固定，有近程死角。", "bombard", "b", true),
    fireShip: card("Fire Ship", "焚潮舰", "近距离扇形喷火，克制密集舰队；燃油弹在落点留下持续燃烧区。", "fireship", "f", true),
    carrier: card("Heavy Transport", "远洋运兵舰", "载运大量陆军，船体重甲且航速较慢；需护航，船沉时乘员一同损失。", "carrier", "c", true),
    siegeRam: card("Siege Ram", "铁甲冲车", "重甲近战攻城器械，普通撞击对建筑造成额外伤害。", "ram", "q"),
    ballista: card("Ballista", "床弩", "射出能穿透直线目标的弩矢；钉射命中后短暂定身。避开快速侧向移动的目标。", "ballista", "b"),
    catapult: card("Catapult", "重型投石机", "抛射固定落点的石弹，范围伤害并擅长拆建筑；近程死角需要友军保护。", "mortar", "p"),
    organGun: card("Organ Gun", "连弩炮车", "扇形连射压制密集步兵，对建筑较弱。", "organ", "n"),
};
