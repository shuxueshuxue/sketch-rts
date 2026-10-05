import type { AbilityKind } from "../../shared/types";
import type { AbilityCard } from "./cards";

// The command card's spell buttons, in catalog order (see ABILITY_KINDS). Two abilities one race's units carry never
// share a hotkey: a selection can show all of them at once.
export const ABILITY_CARDS: Record<AbilityKind, AbilityCard> = {
  ramBreach: { name:{en:"Breach",zh:"破门撞击"},description:{en:"A heavy impact against an enemy structure.",zh:"猛击敌方建筑或障碍物，造成额外结构伤害。"},command:{icon:"↠",hotkey:"q"}},
  pinningBolt: { name:{en:"Pinning Bolt",zh:"钉射"},description:{en:"A piercing bolt that briefly roots units it hits.",zh:"沿直线射出穿透弩矢，命中的单位短暂定身；侧向移动可以躲避。"},command:{icon:"⤳",hotkey:"b"}},
  siegeBarrage: { name:{en:"Barrage",zh:"压制炮击"},description:{en:"Lob a larger explosive shot at a fixed point, outside the dead zone.",zh:"向固定地面落点抛射范围石弹或炮弹；近距离无法施放。"},command:{icon:"◉",hotkey:"p"}},
  grapeshot: { name:{en:"Grapeshot",zh:"霰射"},description:{en:"Sweep a wide forward cone; weak against structures.",zh:"朝目标方向释放宽角度霰射，克制步兵，对建筑较弱。"},command:{icon:"⋙",hotkey:"n"}},
  incendiaryFlume: { name:{en:"Burning Oil",zh:"燃油弹"},description:{en:"Lob oil that burns its fixed impact area for four seconds.",zh:"抛射燃油弹，落点持续燃烧四秒，影响区域内敌军。"},command:{icon:"♨",hotkey:"f"}},
  heal: {
    name: { en: "Heal", zh: "治疗" },
    description: { en: "Restores health to an allied unit in range.", zh: "为射程内的友方单位恢复生命。" },
    command: { icon: "+", hotkey: "h" },
  },
  summon: {
    name: { en: "Summon", zh: "召唤" },
    description: { en: "Creates a spirit at a nearby ground point.", zh: "在附近地面目标点召唤一个灵体。" },
    command: { icon: "◎", hotkey: "u" },
  },
  curse: {
    name: { en: "Curse", zh: "诅咒" },
    description: {
      en: "Weakens an enemy unit so its attacks deal less damage. A summoned unit also takes 100 damage.",
      zh: "削弱敌方单位，使其攻击造成更少伤害。召唤物还会受到 100 点伤害。",
    },
    command: { icon: "☾", hotkey: "c" },
  },
  emberMend: {
    name: { en: "Ember Mend", zh: "余烬疗愈" },
    description: { en: "Quickly restores health to an allied unit at shorter range.", zh: "以较短射程快速治疗友方单位。" },
    command: { icon: "+", hotkey: "m" },
  },
  cinderSoul: {
    name: { en: "Cinder Soul", zh: "余火魂灵" },
    description: { en: "Creates a shorter-lived spirit at a nearby ground point.", zh: "在附近地面目标点召唤一个持续时间较短的灵体。" },
    command: { icon: "◎", hotkey: "o" },
  },
  ashCurse: {
    name: { en: "Ash Curse", zh: "灰烬诅咒" },
    description: {
      en: "Weakens an enemy unit, and burns scorched targets down to a harsher damage penalty. A summoned unit also takes 100 damage.",
      zh: "削弱敌方单位；若目标已被灼烧，则进一步压低其伤害。召唤物还会受到 100 点伤害。",
    },
    command: { icon: "☾", hotkey: "x" },
  },
  charge: {
    name: { en: "Charge", zh: "冲锋" },
    description: {
      en: "Gallops at an enemy unit from a distance and strikes it for twice a normal blow.",
      zh: "从远处策马冲向一个敌方单位，造成两倍普通攻击的伤害。",
    },
    command: { icon: "↠", hotkey: "r" },
  },
  // The creeps' own (see @@@creep-abilities): no player's unit casts them, so their buttons never show.
  stomp: {
    name: { en: "Stomp", zh: "践踏" },
    description: { en: "Shakes the ground: every enemy unit close by is stunned.", zh: "震动地面，身边的敌方单位全部眩晕。" },
    command: { icon: "✷", hotkey: "j" },
  },
  bloodlust: {
    name: { en: "Bloodlust", zh: "嗜血" },
    description: { en: "Drives a fighting ally into a frenzy: its blows come faster.", zh: "让一个正在战斗的同伴狂暴，攻击变快。" },
    command: { icon: "♨", hotkey: "l" },
  },
  web: {
    name: { en: "Web", zh: "结网" },
    description: { en: "Binds an enemy unit in place with a web; it still strikes.", zh: "用蛛网把一个敌方单位定在原地，它仍能攻击。" },
    command: { icon: "#", hotkey: "k" },
  },
};

export function mapAbilityCards<T>(pick: (card: AbilityCard) => T): Record<AbilityKind, T> {
  return Object.fromEntries(Object.entries(ABILITY_CARDS).map(([kind, card]) => [kind, pick(card)])) as Record<AbilityKind, T>;
}
