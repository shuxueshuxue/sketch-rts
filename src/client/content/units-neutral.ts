import type { UnitKind } from "../../shared/types";
import type { UnitCard } from "./cards";
import { unitPainter } from "../art/painted-units";

export const NEUTRAL_UNITS = {
  spirit: {
    name: { en: "Spirit", zh: "灵体" },
    glyph: { silhouette: "spirit-wisp", marks: ["tail", "spark", "halo"] },
    art: { tier: "basic", bearing: "spirit", faction: "summoned" },
    paint: unitPainter("spirit"),
  },
  mercenary: {
    name: { en: "Mercenary", zh: "雇佣兵" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "shortSword", "scar"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" },
    paint: unitPainter("mercenary"),
  },
  contractArcher: {
    name: { en: "Contract Archer", zh: "契约弓手" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "bow", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" },
    paint: unitPainter("contractArcher"),
  },
  fieldMedic: {
    name: { en: "Field Medic", zh: "战地医师" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "halo", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" },
    paint: unitPainter("fieldMedic"),
  },
  wildling: {
    name: { en: "Wildling", zh: "林间野人" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "curseSlash"] },
    art: { tier: "basic", bearing: "foot", faction: "wild" },
    paint: unitPainter("wildling"),
  },
  mossGnawer: {
    name: { en: "Moss Gnawer", zh: "苔鼠" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "shortSword"] },
    art: { tier: "basic", bearing: "beast", faction: "wild" },
    paint: unitPainter("mossGnawer"),
  },
  thornSlinger: {
    name: { en: "Thorn Slinger", zh: "荆刺射手" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "bow", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" },
    paint: unitPainter("thornSlinger"),
  },
  barkMender: {
    name: { en: "Bark Mender", zh: "树皮医者" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "halo", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" },
    paint: unitPainter("barkMender"),
  },
  stonebackBrute: {
    name: { en: "Stoneback Brute", zh: "石背蛮兽" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "blockSeams", "shieldBar"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint: unitPainter("stonebackBrute"),
  },
  gladeWitch: {
    name: { en: "Glade Witch", zh: "林间女巫" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "crescent", "curseSlash"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
    paint: unitPainter("gladeWitch"),
  },
  ancientStag: {
    name: { en: "Ancient Stag", zh: "远古巨鹿" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "visor", "halo"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint: unitPainter("ancientStag"),
  },
} satisfies Partial<Record<UnitKind, UnitCard>>;
