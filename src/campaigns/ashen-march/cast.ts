import { seconds } from "../../shared/time";
import { defineUnit, type CastBook } from "../../story/cast";
import type { Gear } from "../../story/rpg";
import * as art from "./models";

// Who walks the Ashen March. Every one is a variant of a catalog unit (see unit-variants): the base says what kind of
// fighter the AIs and the command card take it for, the rest are its own numbers. None of these numbers touches the
// catalog: a standard match never sees them.

// Experience a hero needs for each level past the first (kills pay the victim's xpReward; quests pay the rest).
const HERO_CURVE = [150, 400, 800, 1350, 2050, 2900, 3900, 5100] as const;

export const CAST = {
  lynn: defineUnit({
    id: "ashen/lynn",
    name: { zh: "林恩", en: "Lynn" },
    color: "#2f7d6d",
    rules: { base: "archer", heroic: true, hp: 300, attackDamage: 22, attackRange: 380, attackCooldown: seconds(1.3), speed: 66, radius: 17, supplyUsed: 0, xpReward: 80 },
    hero: { thresholds: HERO_CURVE, perLevel: { hp: 30, attackDamage: 2.5 } },
    model: { paint: art.paintLynn },
  }),
  du: defineUnit({
    id: "ashen/du",
    name: { zh: "杜伯", en: "Old Du" },
    color: "#6b5a2e",
    rules: { base: "footman", heroic: true, hp: 560, attackDamage: 26, attackRange: 52, attackCooldown: seconds(1.2), speed: 60, radius: 21, armor: "heavy", supplyUsed: 0, xpReward: 80 },
    hero: { thresholds: HERO_CURVE, perLevel: { hp: 55, attackDamage: 3 } },
    model: { paint: art.paintDu },
  }),
  tess: defineUnit({
    id: "ashen/tess",
    name: { zh: "苔丝", en: "Tess" },
    color: "#5d7a3a",
    rules: { base: "priest", heroic: true, hp: 240, attackDamage: 11, attackRange: 260, attackCooldown: seconds(1.7), speed: 62, radius: 16, supplyUsed: 0, xpReward: 80 },
    hero: { thresholds: HERO_CURVE, perLevel: { hp: 25, attackDamage: 1.5 } },
    model: { paint: art.paintTess },
  }),
  ig: defineUnit({
    id: "ashen/ig",
    name: { zh: "伊格", en: "Ig" },
    color: "#b8543a",
    rules: { base: "cinderRunner", heroic: true, hp: 280, attackDamage: 19, attackRange: 48, attackCooldown: seconds(0.9), speed: 86, radius: 17, supplyUsed: 0, xpReward: 80 },
    hero: { thresholds: HERO_CURVE, perLevel: { hp: 28, attackDamage: 2.2 } },
    model: { paint: art.paintIg },
  }),
  warden: defineUnit({
    id: "ashen/warden",
    name: { zh: "沼泽巡卫", en: "Fen Warden" },
    rules: { base: "footman", hp: 175, attackDamage: 16, attackRange: 62, speed: 62 },
    model: { paint: art.paintWarden },
  }),
  villager: defineUnit({
    id: "ashen/villager",
    name: { zh: "芦苇渡村民", en: "Reedholm villager" },
    rules: { base: "worker", hp: 60, attackDamage: 3, speed: 60, supplyUsed: 0, xpReward: 0 },
    model: { paint: art.paintVillager },
  }),
  villagerWoman: defineUnit({
    id: "ashen/villager-woman",
    name: { zh: "芦苇渡村妇", en: "Reedholm villager" },
    rules: { base: "worker", hp: 55, attackDamage: 2, speed: 60, supplyUsed: 0, xpReward: 0 },
    model: { paint: art.paintVillagerWoman },
  }),
  refugee: defineUnit({
    id: "ashen/refugee",
    name: { zh: "烬民难民", en: "Ember refugee" },
    rules: { base: "worker", hp: 55, attackDamage: 2, speed: 56, supplyUsed: 0, xpReward: 0 },
    model: { paint: art.paintRefugee },
  }),
  ashe: defineUnit({
    id: "ashen/ashe",
    name: { zh: "艾舍", en: "Ashe" },
    color: "#b8543a",
    rules: { base: "worker", hp: 70, attackDamage: 2, speed: 60, radius: 13, supplyUsed: 0, xpReward: 0 },
    model: { paint: art.paintAshe },
  }),
  fenWolf: defineUnit({
    id: "ashen/fen-wolf",
    name: { zh: "沼狼", en: "Fen wolf" },
    rules: { base: "mossGnawer", hp: 95, attackDamage: 10, attackCooldown: seconds(1.3), speed: 72, radius: 15, xpReward: 22, supplyUsed: 0 },
    model: { paint: art.paintFenWolf, shadow: "beast" },
  }),
  fenWolfAlpha: defineUnit({
    id: "ashen/fen-wolf-alpha",
    name: { zh: "独眼头狼", en: "One-eyed alpha" },
    rules: { base: "mossGnawer", hp: 260, attackDamage: 18, attackCooldown: seconds(1.2), speed: 76, radius: 19, xpReward: 60, supplyUsed: 0 },
    model: { paint: art.paintFenWolfAlpha, shadow: "beast" },
  }),
  cinderHound: defineUnit({
    id: "ashen/cinder-hound",
    name: { zh: "烬犬", en: "Cinder hound" },
    rules: { base: "cinderRunner", hp: 125, attackDamage: 13, attackCooldown: seconds(1), speed: 88, radius: 16, xpReward: 28, supplyUsed: 0 },
    model: { paint: art.paintCinderHound, shadow: "beast" },
  }),
  ashRaider: defineUnit({
    id: "ashen/ash-raider",
    name: { zh: "灰烬掠夺者", en: "Ash raider" },
    rules: { base: "emberRavager", hp: 150, attackDamage: 17, attackCooldown: seconds(1.25), speed: 72, xpReward: 34, supplyUsed: 0 },
    model: { paint: art.paintAshRaider },
  }),
  kharn: defineUnit({
    id: "ashen/kharn",
    name: { zh: "烙印者卡恩", en: "Kharn the Brand" },
    color: "#8e2a1c",
    rules: { base: "ashChieftain", hp: 900, attackDamage: 30, attackCooldown: seconds(1.4), speed: 64, radius: 24, xpReward: 220, supplyUsed: 0 },
    model: { paint: art.paintKharn },
  }),
  pyremancer: defineUnit({
    id: "ashen/pyremancer",
    name: { zh: "焚咒师", en: "Pyremancer" },
    rules: { base: "pyreCaller", hp: 140, attackDamage: 12, attackRange: 280, xpReward: 45, supplyUsed: 0 },
    model: { paint: art.paintPyremancer },
  }),
  oru: defineUnit({
    id: "ashen/oru",
    name: { zh: "焚咒师欧鲁", en: "Oru the Pyremancer" },
    color: "#b8401f",
    rules: { base: "pyreCaller", hp: 1100, attackDamage: 22, attackRange: 300, radius: 20, speed: 60, xpReward: 300, supplyUsed: 0 },
    model: { paint: art.paintOru },
  }),
  obsidianGuard: defineUnit({
    id: "ashen/obsidian-guard",
    name: { zh: "黑曜卫士", en: "Obsidian guard" },
    rules: { base: "ashChieftain", hp: 420, attackDamage: 22, attackRange: 70, speed: 56, radius: 21, xpReward: 60, supplyUsed: 0 },
    model: { paint: art.paintObsidianGuard },
  }),
  vashka: defineUnit({
    id: "ashen/vashka",
    name: { zh: "焚誓者瓦什卡", en: "Vashka the Unquenched" },
    color: "#a8321c",
    rules: { base: "cinderRevenant", hp: 3200, attackDamage: 40, attackRange: 70, attackCooldown: seconds(1.2), speed: 68, radius: 24, regenPerSecond: 4, xpReward: 800, supplyUsed: 0 },
    model: { paint: art.paintVashka },
  }),
  colossus: defineUnit({
    id: "ashen/colossus",
    name: { zh: "熔烬巨像", en: "The Cinder Colossus" },
    color: "#b8401f",
    rules: { base: "golem", hp: 7000, attackDamage: 80, attackRange: 110, attackCooldown: seconds(2.6), speed: 30, radius: 54, regenPerSecond: 0, xpReward: 1200, supplyUsed: 0 },
    model: { paint: art.paintColossus, shadow: "huge" },
  }),
  // What the colossus becomes once Ig breaks its seal: the same bulk, its obsidian cracked open (no heavy armor).
  brokenColossus: defineUnit({
    id: "ashen/colossus-broken",
    name: { zh: "熔烬巨像（封印破碎）", en: "The Cinder Colossus, unsealed" },
    color: "#b8401f",
    rules: { base: "stonebackBrute", hp: 7000, attackDamage: 70, attackRange: 110, attackCooldown: seconds(2.8), speed: 26, radius: 54, xpReward: 1200, goldBounty: 0, supplyUsed: 0 },
    model: { paint: art.paintColossusBroken, shadow: "huge" },
  }),
  elder: defineUnit({
    id: "ashen/elder",
    name: { zh: "苔藓长老", en: "Elder Moss" },
    color: "#4f7a3a",
    rules: { base: "golem", hp: 2400, attackDamage: 45, attackRange: 80, attackCooldown: seconds(2), speed: 40, radius: 34, xpReward: 0, supplyUsed: 0 },
    model: { paint: art.paintElder, shadow: "huge" },
  }),
  treant: defineUnit({
    id: "ashen/treant",
    name: { zh: "心木树人", en: "Heartwood treant" },
    rules: { base: "golem", hp: 520, attackDamage: 28, attackRange: 62, attackCooldown: seconds(1.8), speed: 50, radius: 24, xpReward: 0, supplyUsed: 0 },
    model: { paint: art.paintTreant, shadow: "huge" },
  }),
  groveRider: defineUnit({
    id: "ashen/grove-rider",
    name: { zh: "林地骑手", en: "Grove rider" },
    rules: { base: "knight", hp: 300, attackDamage: 26, speed: 76, supplyUsed: 0 },
    model: { paint: art.paintGroveRider, shadow: "mounted" },
  }),
} as const satisfies CastBook;

export const GEAR = {
  heartwoodString: { id: "heartwoodString", name: { zh: "心木弓弦", en: "Heartwood bowstring" }, note: { zh: "射程与力道都更进一步。", en: "Longer reach, harder draw." }, stats: { attackRange: 60, attackDamage: 3 } },
  accordShield: { id: "accordShield", name: { zh: "盟约之盾", en: "Shield of the Accord" }, note: { zh: "上一场战争结束时铸的盾，刻着两族的名字。", en: "Forged when the last war ended, both peoples' names on its rim." }, stats: { hp: 180, regenPerSecond: 2 } },
  emberSalve: { id: "emberSalve", name: { zh: "余烬药膏", en: "Ember salve" }, note: { zh: "艾舍的母亲教她的方子。", en: "Ashe's mother's recipe." }, stats: { hp: 40, regenPerSecond: 3 } },
  ashesCharm: { id: "ashesCharm", name: { zh: "艾舍的护符", en: "Ashe's charm" }, note: { zh: "一枚烧黑的铜片，他一直带在身上。", en: "A blackened copper disc he never takes off." }, stats: { attackDamage: 3, speed: 8 } },
  moonpetalSatchel: { id: "moonpetalSatchel", name: { zh: "月瓣药囊", en: "Moonpetal satchel" }, note: { zh: "苔丝在篝火边配的，闻一闻能多撑一会儿。", en: "Tess made it by the fire; a breath of it keeps you standing." }, stats: { hp: 30, regenPerSecond: 2 } },
  dawnstarQuiver: { id: "dawnstarQuiver", name: { zh: "晨星箭袋", en: "Dawnstar quiver" }, note: { zh: "守望塔的老物件，箭羽上缝着晨星。", en: "An old watch heirloom, a morning star stitched on every fletching." }, stats: { attackCooldown: -5 } },
} as const satisfies Record<string, Gear>;

export type CastKey = keyof typeof CAST;
