// Dev-only catalog page (unit-sheet.html): draws every unit and building with
// the in-game painters, grouped by faction and art tier, at gameplay scale.
import { drawAtlasBuilding, drawAtlasUnit } from "./atlas-art";
import { BUILDING_GLYPHS } from "./building-glyphs";
import { unitGlyphScale } from "./glyphs";
import { createI18n, type LabelKey } from "./i18n";
import { UNIT_ART, type UnitArtTier } from "./unit-art";
import { BUILDABLE_BUILDING_KINDS, UNIT_DEFS } from "../shared/catalog";
import type { BuildingKind, UnitKind } from "../shared/types";

const zh = createI18n("zh");
const CREEP_NAMES: Partial<Record<UnitKind, string>> = {
  wildling: "林间野人",
  mossGnawer: "苔鼠",
  thornSlinger: "荆刺射手",
  barkMender: "树皮医者",
  stonebackBrute: "石背蛮兽",
  gladeWitch: "林间女巫",
  ancientStag: "远古巨鹿",
};
const TIER_LABELS: Record<UnitArtTier, string> = { civilian: "平民", basic: "初级", advanced: "进阶", elite: "精英" };
const TIER_NOTES: Record<UnitArtTier, string> = {
  civilian: "工具与布衣",
  basic: "≤120 金 · 布甲皮甲、朴素武器、无金饰",
  advanced: "130–160 金 · 镶边长袍、法器、黄铜徽记",
  elite: "≥190 金 · 3+ 人口 · 板甲、披风、羽饰、更大体型",
};
const CREEP_NOTES: Record<UnitArtTier, string> = {
  civilian: "",
  basic: "营地食物 1 · 小型、无装备",
  advanced: "营地食物 2 · 专精的射手与医者",
  elite: "营地食物 3–5 · 大型野兽与首领",
};

const GROUPS: { title: string; kinds: UnitKind[]; color: string; creep?: boolean; summon?: boolean }[] = [
  { title: "林野族 · Grove Kin", color: "#387d72", kinds: ["worker", "footman", "archer", "lancer", "groveWarden", "raider", "priest", "summoner", "witch", "knight", "golem"] },
  { title: "余烬盟约 · Ember Pact", color: "#a85644", kinds: ["worker", "emberRavager", "cinderRunner", "sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"] },
  { title: "雇佣兵 · Hired Swords", color: "#387d72", kinds: ["mercenary", "contractArcher", "fieldMedic"] },
  { title: "召唤物 · Summoned", color: "#387d72", summon: true, kinds: ["spirit"] },
  { title: "中立生物 · Wildlings", color: "#704a33", creep: true, kinds: ["wildling", "mossGnawer", "thornSlinger", "barkMender", "stonebackBrute", "gladeWitch", "ancientStag"] },
];

function unitName(kind: UnitKind) {
  return CREEP_NAMES[kind] ?? zh.label(kind as LabelKey);
}

function unitStats(kind: UnitKind) {
  const def = UNIT_DEFS[kind];
  const parts = [`${def.hp} HP`, `${def.attackDamage} 攻`];
  if (def.creepFoodPower) parts.push(`食物 ${def.creepFoodPower}`);
  else if (def.cost) parts.push(`${def.cost} 金`, `${def.supplyUsed} 人口`);
  else parts.push("召唤");
  if (UNIT_ART[kind].bearing === "mounted") parts.push("骑乘");
  return parts.join(" · ");
}

function canvasCard(label: string, sub: string, stats: string, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const card = document.createElement("figure");
  card.className = "sheet-card";
  const canvas = document.createElement("canvas");
  const ratio = 2;
  canvas.width = 150 * ratio; canvas.height = 140 * ratio;
  const c = canvas.getContext("2d")!;
  c.scale(ratio, ratio);
  paint(c, 150, 140);
  const caption = document.createElement("figcaption");
  caption.innerHTML = `<b>${label}</b><span>${sub}</span>${stats ? `<em>${stats}</em>` : ""}`;
  card.append(canvas, caption);
  return card;
}

function unitCard(kind: UnitKind, color: string) {
  return canvasCard(unitName(kind), kind, unitStats(kind), (c, w, h) => {
    // Same scale rule as the battlefield, enlarged 1.25× for the sheet.
    drawAtlasUnit(c, kind, { x: w / 2, y: h * 0.66 }, Math.min(1.75, unitGlyphScale(UNIT_DEFS[kind].radius) * 1.25), color);
  });
}

function buildingCard(kind: BuildingKind) {
  return canvasCard(zh.label(kind as LabelKey), kind, "", (c, w, h) => {
    drawAtlasBuilding(c, BUILDING_GLYPHS[kind], { x: w / 2, y: h * 0.55 }, 82, "#387d72");
  });
}

function section(index: number, title: string) {
  const el = document.createElement("section");
  el.innerHTML = `<h2><small>0${index} /</small> ${title}</h2>`;
  return el;
}

function render() {
  const root = document.querySelector<HTMLElement>("#sheet")!;
  root.innerHTML = `<header><p>SKETCH RTS / THE WOODLAND ATLAS</p><h1>林野战记 · 兵种图鉴</h1>
    <p class="lede">同一套画法，用于战场、建造菜单、训练队列与选中头像。按价格与人口分级：初级兵轻装，进阶兵有镶边与法器，精英才有板甲、披风和坐骑甲胄。只有马厩训练的掠袭者与骑士骑马。体型按实际碰撞半径缩放。</p></header>`;
  GROUPS.forEach((group, groupIndex) => {
    const el = section(groupIndex + 1, group.title);
    const tiers = [...new Set(group.kinds.map((kind) => UNIT_ART[kind].tier))];
    for (const tier of tiers) {
      const row = document.createElement("div");
      row.className = `sheet-row tier-${tier}`;
      const label = document.createElement("div");
      label.className = "sheet-tier";
      label.innerHTML = group.summon ? "<b>召唤</b><span>召唤师与薪火召唤者的技能产物，限时存在</span>" : `<b>${TIER_LABELS[tier]}</b><span>${(group.creep ? CREEP_NOTES : TIER_NOTES)[tier]}</span>`;
      const cards = document.createElement("div");
      cards.className = "sheet-cards";
      for (const kind of group.kinds.filter((k) => UNIT_ART[k].tier === tier)) cards.append(unitCard(kind, group.color));
      row.append(label, cards);
      el.append(row);
    }
    root.append(el);
  });
  const buildings = section(GROUPS.length + 1, "建筑与防御工事 · Buildings");
  const cards = document.createElement("div");
  cards.className = "sheet-cards";
  for (const kind of BUILDABLE_BUILDING_KINDS) cards.append(buildingCard(kind));
  buildings.append(cards);
  root.append(buildings);
  document.body.dataset.ready = "true";
}

const style = document.createElement("style");
style.textContent = `
  body { margin: 0; background: #e8e2c8; color: #2f4a3c; font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
  #sheet { width: 1360px; padding: 44px 56px 56px; }
  header p:first-child { letter-spacing: .25em; font-size: 11px; color: #9a8558; margin: 0 0 8px; }
  h1 { font-size: 46px; margin: 0 0 10px; font-weight: 600; }
  .lede { font-size: 13px; color: #6f7a5e; margin: 0 0 18px; max-width: 980px; line-height: 1.6; }
  h2 { font-size: 15px; font-weight: 500; letter-spacing: .12em; margin: 26px 0 12px; padding-top: 18px; border-top: 1px solid #c9bf9c; }
  h2 small { color: #8a8a6a; font-size: 13px; }
  .sheet-row { display: grid; grid-template-columns: 150px 1fr; gap: 14px; align-items: stretch; margin-bottom: 10px; }
  .sheet-tier { border-left: 3px solid #b9ad84; padding: 10px 12px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
  .sheet-tier b { font-size: 18px; }
  .sheet-tier span { font-size: 11px; color: #7b806a; line-height: 1.5; }
  .tier-basic .sheet-tier { border-color: #a7ad8f; }
  .tier-advanced .sheet-tier { border-color: #c9a863; }
  .tier-elite .sheet-tier { border-color: #cf8f4f; background: #efe3bf; }
  .sheet-cards { display: flex; flex-wrap: wrap; gap: 10px; }
  .sheet-card { margin: 0; width: 150px; background: #efe8d0; border: 1px solid #ddd3b3; }
  .tier-elite .sheet-card { border-color: #d7b77a; }
  .sheet-card canvas { width: 150px; height: 140px; display: block; }
  figcaption { text-align: center; padding: 0 4px 8px; display: flex; flex-direction: column; gap: 2px; }
  figcaption b { font-size: 13px; font-weight: 500; }
  figcaption span { font-size: 10px; color: #8a8a70; }
  figcaption em { font-style: normal; font-size: 10px; color: #6d6a52; }
`;
document.head.append(style);
render();
