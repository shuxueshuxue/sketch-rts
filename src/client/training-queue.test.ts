import { describe, expect, it } from "vitest";
import { trainingProgressButtonsForSelection, trainingProgressText, trainingQueueCountText } from "./training-queue";
import type { Building } from "../shared/types";
import { createBuilding, createUnit } from "../shared/map";
import { SHIP_KINDS } from "../shared/ship-geometry";
import { createGame, issuePlayerCommand, stepGame } from "../shared/sim";
import { createI18n } from "./i18n";
import { formatRemaining } from "./format-remaining";
import { BUILDING_DEFS } from "../shared/catalog";

describe("training queue presentation", () => {
  it("shows a stack count only when a building has multiple queued jobs", () => {
    expect(trainingQueueCountText(0)).toBe("");
    expect(trainingQueueCountText(1)).toBe("");
    expect(trainingQueueCountText(5)).toBe("×5");
  });

  it("reports the active and queued production jobs for selected buildings", () => {
    expect(trainingProgressButtonsForSelection([building()])).toMatchObject([
      { buildingId: "barracks-1", unitKind: "footman", status: "training", progress: expect.any(Number) },
      { buildingId: "barracks-1", unitKind: "lancer", status: "queued", progress: 0 },
    ]);
  });

  it("shows a building's upgrade as a job of its queue, labelled as an upgrade", () => {
    const tower = createBuilding("tower", "player", "defenseTower", 304, 624, true);
    tower.queue = [{ kind: "upgrade", id: "up", to: "fortifiedTower", remaining: 60, paidGold: 100 }];
    const [progress] = trainingProgressButtonsForSelection([tower]);
    expect(progress).toMatchObject({ product: "upgrade", upgradeTo: "fortifiedTower", jobId: "up", status: "training", progress: 1 - 60 / BUILDING_DEFS.fortifiedTower.buildTime });
    expect(trainingProgressText(progress!, createI18n("en")).label).toBe("Upgrading to Fortified Tower");
  });

  it.each(SHIP_KINDS)('marks a completed %s at the head as awaiting launch without changing the job',kind=>{
    const dock=createBuilding('dock','player','shipyard',304,624,true);
    dock.queue=[{id:'ready-ship',unitKind:kind,remaining:0}];
    const before=JSON.stringify(dock);Object.freeze(dock.queue[0]);Object.freeze(dock.queue);Object.freeze(dock);
    expect(trainingProgressButtonsForSelection([dock])).toMatchObject([{buildingId:dock.id,jobId:'ready-ship',unitKind:kind,remaining:0,progress:1,status:'awaitingLaunch'}]);
    expect(JSON.stringify(dock)).toBe(before);
  });

  it('keeps queued ships, unfinished ships, incomplete yards and ordinary units distinct from a ready hull',()=>{
    const dock=createBuilding('dock','player','shipyard',304,624,true);
    dock.queue=[{unitKind:'transport',remaining:1},{unitKind:'carrier',remaining:0}];
    expect(trainingProgressButtonsForSelection([dock])).toMatchObject([{status:'training'},{status:'queued',progress:0}]);
    dock.complete=false;dock.queue[0]!.remaining=0;
    expect(trainingProgressButtonsForSelection([dock])[0]?.status).toBe('training');
    const barracks=building();barracks.queue[0]!.remaining=0;
    expect(trainingProgressButtonsForSelection([barracks])[0]).toMatchObject({status:'training',progress:1});
  });

  it('shows the actual completed ship waiting for pier traffic, then returns to ordinary training after launch',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});
    game.map={...game.map,width:1600,height:1280,terrain:{cell:32,cols:50,rows:40,cells:Array.from({length:40},()=>'.'.repeat(10)+'~'.repeat(40)).join('')}};
    game.units=[];game.items=[];game.resources=[];game.mercenaryCamps=[];game.shops=[];game.scriptedVictory=true;
    const dock=createBuilding('dock','player','shipyard',304,624,true);game.buildings=[dock,createBuilding('hall','player','townHall',96,96,true)];game.players.player.gold=10000;game.players.player.supplyCap=8;
    for(let i=0;i<2;i++)issuePlayerCommand(game,'player',{type:'train',buildingId:dock.id,unitKind:'transport'});
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      const blocker=createUnit(`traffic-${row}-${col}`,'player','carrier',396+col*146,328+row*296);
      blocker.sailing={heading:Math.PI/2,speed:0,load:0,balance:0};blocker.order={type:'hold',x:blocker.x,y:blocker.y};game.units.push(blocker);
    }
    const job=dock.queue[0]!;job.remaining=1;const balance=game.players.player.gold;
    for(let tick=0;tick<3;tick++)stepGame(game);
    expect(job.remaining).toBe(0);expect(dock.queue).toHaveLength(2);
    expect(trainingProgressButtonsForSelection([dock])).toMatchObject([{jobId:job.id,status:'awaitingLaunch',progress:1},{status:'queued',progress:0}]);
    expect(game.units.some(unit=>unit.kind==='transport')).toBe(false);expect(game.players.player.gold).toBe(balance);
    for(const blocker of game.units){blocker.x+=700;blocker.order={type:'hold',x:blocker.x,y:blocker.y};}
    stepGame(game);
    expect(game.units.some(unit=>unit.kind==='transport')).toBe(true);expect(dock.queue).toHaveLength(1);
    expect(trainingProgressButtonsForSelection([dock])).toMatchObject([{status:'training',progress:0}]);
    expect(game.players.player.gold).toBe(balance);
  });

  it('explains completed hulls in both locales while preserving ordinary training and queue text',()=>{
    const dock=createBuilding('dock','player','shipyard',304,624,true);dock.queue=[{unitKind:'transport',remaining:0}];
    const ready=trainingProgressButtonsForSelection([dock])[0]!;
    const zh=trainingProgressText(ready,createI18n('zh')),en=trainingProgressText(ready,createI18n('en'));
    expect(zh.label).toContain('已造好 · 等待下水');expect(zh.badge).toBe('待下水');expect(zh.hint).toContain('如果有船挤在船厂旁');expect(zh.hint).toContain('自动下水');
    expect(en.label).toContain('built · awaiting launch');expect(en.badge).toBe('Ready');expect(en.hint).toContain('If nearby ships');expect(en.hint).toContain('launch automatically');
    const [active,queued]=trainingProgressButtonsForSelection([building()]);
    expect(trainingProgressText(active!,createI18n('en'))).toMatchObject({label:'Training Footman',badge:formatRemaining(active!.remaining),hint:undefined});
    expect(trainingProgressText(queued!,createI18n('zh'))).toMatchObject({badge:'排队',hint:undefined});
  });
});

function building(): Building {
  return {
    id: "barracks-1",
    owner: "player",
    kind: "barracks",
    x: 0,
    y: 0,
    hp: 620,
    maxHp: 620,
    radius: 40,
    complete: true,
    buildProgress: 0,
    buildTime: 0,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 1,
    cooldown: 0,
    rallyX: 0,
    rallyY: 0,
    queue: [
      { unitKind: "footman", remaining: 80 },
      { unitKind: "lancer", remaining: 140 },
    ],
    researchQueue: [],
  };
}
