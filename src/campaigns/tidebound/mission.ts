import { BEACON, LANDING, MAGE, SEAL, CITADEL } from './world';

export const CHAPTERS = [
  { title: '熄灭的灯塔', speaker: '港务长 · 伊蕾', line: '舰队还在雾外等信号。先清掉岸上的袭击队，再让工程兵修复灯塔；灯不亮，补给船就进不来。', summary: '守住后方，修复航标', target: BEACON },
  { title: '风暴航线', speaker: '船长 · 赫恩', line: '两艘船，装着北线整个月的粮食。我们走西侧水道，护住船队。你的人可以乘登陆舰先上岸。', summary: '护送粮船，建立登陆场', target: LANDING },
  { title: '诸港之火', speaker: '海军议会', line: '北线有了粮，南线却快撑不住了。夺取两座海峡港口，并让它们持续运转。白盐港的法师还活着——找到她，巨龙就不再不可阻挡。', summary: '争夺港口，营救法师', target: MAGE },
  { title: '王座的裂隙', speaker: '统帅 · 艾登', line: '王廷的护城结界由潮汐枢纽供能。主力会牵制正面，你率精锐摧毁枢纽，再让攻城队打进王廷。', summary: '破坏结界，协同攻城', target: SEAL },
  { title: '潮退之前', speaker: '港务长 · 伊蕾', line: '堡垒倒了，敌军的舰队还没有。守住两处港口，直到最后一艘撤离船回到灯塔。工事、修理和舰队，现在一样也不能少。', summary: '守住航路，掩护撤离', target: CITADEL },
] as const;

export type MissionObjective = { id: string; title: string; detail: string; done: boolean; optional?: boolean; x: number; y: number };
export type MissionState = {
  revision: 2;
  stage: number;
  stageTick: number;
  completed: string[];
  raiders: string[];
  cargo: { id: string; waypoint: number; delivered: boolean; lost: boolean }[];
  convoySpawned: boolean;
  portHold: number;
  mageRescued: boolean;
  sealBroken: boolean;
  evacuation?: { id: string; waypoint: number; arrived: boolean; delivered?: boolean; lost: boolean };
  objectives: MissionObjective[];
  dialogue: { tick: number; speaker: string; text: string }[];
  dispatchTick: number;
  finalMobilized: boolean;
  rewardGold: number;
};

export function initialMission(): MissionState {
  return { revision: 2, stage: 0, stageTick: 0, completed: [], raiders: [], cargo: [], convoySpawned: false, portHold: 0, mageRescued: false, sealBroken: false, objectives: [], dialogue: [{ tick: 0, speaker: CHAPTERS[0].speaker, text: CHAPTERS[0].line }], dispatchTick: -1200, finalMobilized: false, rewardGold: 0 };
}
