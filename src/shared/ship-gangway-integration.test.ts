import { describe, expect, it } from 'vitest';
import { boardUnit, deckPlacement, deckPointFits, syncDecks } from './decks';
import { createUnit } from './map';
import { cabinDoor, enterCabinStep, isInCabin } from './ship-cabin';
import { GANGWAY_COOLDOWN_TICKS, GANGWAY_HP, GANGWAY_HULL_DAMAGE_SHARE, GANGWAY_SETUP_TICKS, gangwaySurface } from './ship-gangway';
import { distanceToHull, hullContact, localToWorld, shipProfile } from './ship-geometry';
import { hullFits } from './ship-navigation';
import { checksumGame } from './sim/checksum';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, strikeUnit, type Game } from './sim';
import { perTick } from './time';
import type { Unit, UnitKind } from './types';

function sea() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[]; game.items=[]; game.buildings=[]; game.resources=[]; game.mercenaryCamps=[]; game.obstacles=[];
  game.effects=[]; game.projectiles=[]; game.scriptedVictory=true;
  game.map={...game.map,width:4096,height:4096,wind:{direction:Math.PI/2,speed:80},terrain:{cell:32,cols:128,rows:128,cells:'~'.repeat(128*128)}};
  return game;
}
function pair(kind:'transport'|'carrier'='transport',owner:Unit['owner']='enemy') {
  const game=sea(), source=game.spawnUnit('player',kind,1500,1500), target=game.spawnUnit(owner,kind,1500,1900);
  source.sailing!.heading=target.sailing!.heading=0;
  target.y=source.y+(shipProfile(source)!.beam+shipProfile(target)!.beam)/2+12;
  for(const ship of [source,target])ship.order={type:'hold',x:ship.x,y:ship.y};
  expect(hullFits(game.map,source)&&hullFits(game.map,target)).toBe(true); expect(hullContact(source,target)).toBeUndefined();
  return {game,source,target};
}
function crew(game:Game,ship:Unit,kind:UnitKind='footman') {
  const unit=createUnit(`crew-${game.units.length}-${kind}`,ship.owner,kind,ship.x,ship.y); game.units.push(unit);
  expect(boardUnit(ship,unit,game.units)).toBe(true);
  unit.order={type:'hold',x:unit.x,y:unit.y}; return unit;
}
function until(game:Game,condition:()=>boolean,limit=600) {
  for(let tick=0;tick<limit&&!condition();tick++)stepGame(game);
  expect(condition()).toBe(true);
}
function begin(game:Game,source:Unit,target:Unit) {
  issuePlayerCommand(game,'player',{type:'boardShip',unitIds:[source.id],targetId:target.id});
}
function ready(game:Game,source:Unit,target:Unit) {
  begin(game,source,target); until(game,()=>source.sailing?.gangway?.phase==='ready',100);
  expect(gangwaySurface(source,target)?.phase).toBe('ready');
}
function crossing(game:Game,source:Unit,target:Unit,unit:Unit) {
  ready(game,source,target);
  issuePlayerCommand(game,'player',{type:'board',unitIds:[unit.id],transportId:target.id});
  until(game,()=>!!unit.gangway,400);
}

describe('boarding balance through real simulation commands',()=>{
  it('sails an actual approach, then spends three seconds setting up without instant capture',()=>{
    const {game,source,target}=pair(), soldier=crew(game,source), sourceStart={x:source.x-600,y:source.y};
    source.x=sourceStart.x; source.order={type:'hold',...sourceStart}; syncDecks(game.units);
    const targetStart={x:target.x,y:target.y}, hp=[source.hp,target.hp];
    begin(game,source,target); expect(source.sailing?.gangway).toBeUndefined(); stepGame(game);
    expect(source.sailing!.gangway?.phase).toBe('approach'); expect(soldier.deck?.shipId).toBe(source.id);
    expect(target.owner).toBe('enemy');
    until(game,()=>source.sailing?.gangway?.phase==='deploying',1800);
    expect(source.x).toBeGreaterThan(sourceStart.x+100); expect(target).toMatchObject(targetStart);
    const state=source.sailing!.gangway!, station={x:source.x,y:source.y};
    expect(state.readyAtTick-game.tick).toBe(GANGWAY_SETUP_TICKS);
    while(game.tick<state.readyAtTick-1){stepGame(game); expect(state.phase).toBe('deploying'); expect(target.owner).toBe('enemy');}
    expect(source).toMatchObject(station); stepGame(game);
    expect(state.phase).toBe('ready'); expect(target.owner).toBe('enemy'); expect(soldier.deck?.shipId).toBe(source.id);
    expect([source.hp,target.hp]).toEqual(hp); expect(hullContact(source,target)).toBeUndefined();
  });

  it('lets a moving enemy escape without taking over its course or holding it for the boarder',()=>{
    const {game,source,target}=pair(); crew(game,source);
    const x=target.x, goal={x:x+700,y:target.y};
    issuePlayerCommand(game,'enemy',{type:'move',unitIds:[target.id],...goal,avoidCombat:true}); begin(game,source,target);
    for(let tick=0;tick<300;tick++) {
      stepGame(game); expect(target.owner).toBe('enemy'); expect(hullContact(source,target)).toBeUndefined();
      if(tick<10)expect(target.order).toMatchObject({type:'move',...goal});
    }
    expect(target.x).toBeGreaterThan(x+50); expect(source.sailing?.gangway?.phase).not.toBe('ready');
  });

  it.each(['foredeck','aft port entrance'] as const)('walks infantry across the real water gap and captures only after counterdamage from the %s defender',position=>{
    const {game,source,target}=pair(), attackers=[crew(game,source),crew(game,source)], defender=crew(game,target);
    if(position==='foredeck') {
      const defense=localToWorld(target,deckPlacement(target,defender,game.units,{x:60,y:0},true,2)!);
      issuePlayerCommand(game,'enemy',{type:'move',unitIds:[defender.id],...defense,avoidCombat:true});
      until(game,()=>defender.arrivedAt?.x===defense.x&&defender.arrivedAt?.y===defense.y,400);
      issuePlayerCommand(game,'enemy',{type:'holdPosition',unitIds:[defender.id]});
    }
    const initialHp=[source.hp,target.hp], hits:{source:string;target:string;damage:number}[]=[];
    game.observer={hit:(from,to,damage)=>hits.push({source:from.id,target:to.id,damage})};
    begin(game,source,target); let waterCrossing=false, crossed=false, queuedCrew=false, wounded=false;
    for(let tick=0;tick<1200 && target.owner==='enemy';tick++) {
      const before=attackers.map(unit=>({x:unit.x,y:unit.y})); stepGame(game);
      if(position==='aft port entrance'&&!queuedCrew&&source.sailing?.gangway?.phase==='ready') {
        issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:attackers.map(unit=>unit.id),queued:true}); queuedCrew=true;
      }
      for(const [index,unit] of attackers.entries())if(unit.hp>0) {
        expect(Math.hypot(unit.x-before[index]!.x,unit.y-before[index]!.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        waterCrossing ||= !!unit.gangway && distanceToHull(source,unit)>0 && distanceToHull(target,unit)>0;
        crossed ||= unit.deck?.shipId===target.id;
        wounded ||= unit.hp<unit.maxHp;
        if(queuedCrew&&defender.hp>0){expect(unit.order.type).toBe('board'); expect(unit.orderQueue).toHaveLength(1);expect(unit.orderQueue![0]!.type).toBe('hold');}
      }
      if(defender.hp>0)expect(target.owner).toBe('enemy');
      expect(hullContact(source,target)).toBeUndefined();
    }
    expect(waterCrossing).toBe(true);
    expect(crossed).toBe(true);
    expect(defender.hp).toBeLessThanOrEqual(0);
    expect(hits.some(hit=>hit.source===defender.id&&attackers.some(unit=>unit.id===hit.target)&&hit.damage>0)).toBe(true);
    expect(wounded).toBe(true); expect(attackers.some(unit=>unit.hp>0)).toBe(true);
    expect(target.owner).toBe('player'); expect(target.hp).toBeGreaterThan(0);
    if(position==='foredeck')expect(source.hp).toBe(initialHp[0]);
    expect(source.hp).toBeGreaterThan(0); expect(target.hp).toBeLessThanOrEqual(initialHp[1]!);
    expect(game.units.filter(unit=>unit.id===target.id)).toHaveLength(1);
    if(queuedCrew) {
      const survivor=attackers.find(unit=>unit.hp>0)!;
      until(game,()=>survivor.order.type==='hold',400);
      expect(survivor.deck?.shipId).toBe(target.id); expect(survivor.orderQueue).toHaveLength(0);
    }
  });

  it('lets explicit attack-move infantry fight across a ready bridge, then physically board',()=>{
    const {game,source,target}=pair(), attackers=[crew(game,source),crew(game,source)], defender=crew(game,target);
    const hits:{source:string;target:string;damage:number}[]=[];
    game.observer={hit:(from,to,damage)=>hits.push({source:from.id,target:to.id,damage})};
    ready(game,source,target);
    issuePlayerCommand(game,'player',{type:'attackMove',unitIds:attackers.map(unit=>unit.id),x:target.x+60,y:target.y});
    let crossedWater=false;
    for(let tick=0;tick<1000&&defender.hp>0;tick++) {
      const before=attackers.map(unit=>({x:unit.x,y:unit.y}));stepGame(game);
      for(const [index,unit]of attackers.entries())if(unit.hp>0) {
        expect(Math.hypot(unit.x-before[index]!.x,unit.y-before[index]!.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        crossedWater ||= !!unit.gangway&&distanceToHull(source,unit)>0&&distanceToHull(target,unit)>0;
      }
      if(defender.hp>0)expect(target.owner).toBe('enemy');
      expect(hullContact(source,target)).toBeUndefined();
    }
    expect(defender.hp).toBeLessThanOrEqual(0);
    expect(hits.some(hit=>hit.source===defender.id&&attackers.some(unit=>unit.id===hit.target)&&hit.damage>0)).toBe(true);
    expect(hits.some(hit=>attackers.some(unit=>unit.id===hit.source)&&hit.target===defender.id&&hit.damage>0)).toBe(true);
    expect(target.owner).toBe('enemy');
    issuePlayerCommand(game,'player',{type:'board',unitIds:attackers.filter(unit=>unit.hp>0).map(unit=>unit.id),transportId:target.id});
    for(let tick=0;tick<400&&target.owner==='enemy';tick++) {
      const before=attackers.map(unit=>({x:unit.x,y:unit.y}));stepGame(game);
      for(const [index,unit]of attackers.entries())if(unit.hp>0) {
        expect(Math.hypot(unit.x-before[index]!.x,unit.y-before[index]!.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        crossedWater ||= !!unit.gangway&&distanceToHull(source,unit)>0&&distanceToHull(target,unit)>0;
      }
    }
    expect(crossedWater).toBe(true);expect(target.owner).toBe('player');
    expect(attackers.some(unit=>unit.hp>0&&unit.deck?.shipId===target.id)).toBe(true);
  });

  it('strikes a reachable entrance blocker while a rear archer fires, preserving the boarders queued orders',()=>{
    const {game,source,target}=pair(), attackers=[crew(game,source),crew(game,source)], blocker=crew(game,target), rear=crew(game,target,'archer');
    syncDecks(game.units);
    const rearGoal=localToWorld(target,deckPlacement(target,rear,game.units,{x:60,y:0},true,2)!);
    issuePlayerCommand(game,'enemy',{type:'move',unitIds:[rear.id],...rearGoal,avoidCombat:true});
    until(game,()=>rear.arrivedAt?.x===rearGoal.x&&rear.arrivedAt?.y===rearGoal.y,400);
    expect(deckPointFits(target,rear,rear.deck!,game.units)).toBe(true);
    issuePlayerCommand(game,'enemy',{type:'attack',unitIds:[rear.id],targetId:attackers[0]!.id});
    const rearHp=rear.hp, blockerHp=blocker.hp, hits:{source:string;target:string;damage:number}[]=[];
    game.observer={hit:(from,to,damage)=>hits.push({source:from.id,target:to.id,damage})};
    const attackerHit=()=>hits.find(hit=>attackers.some(unit=>unit.id===hit.source)&&[blocker.id,rear.id].includes(hit.target)&&hit.damage>0);
    begin(game,source,target);let queued=false;
    for(let tick=0;tick<500&&!attackerHit()&&attackers.some(unit=>unit.hp>0);tick++) {
      const before=attackers.map(unit=>({x:unit.x,y:unit.y}));stepGame(game);
      if(!queued&&source.sailing?.gangway?.phase==='ready') {
        issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:attackers.map(unit=>unit.id),queued:true});queued=true;
      }
      for(const [index,unit]of attackers.entries())if(unit.hp>0) {
        expect(Math.hypot(unit.x-before[index]!.x,unit.y-before[index]!.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        if(queued){expect(unit.order).toMatchObject({type:'board',transportId:target.id});expect(unit.orderQueue).toHaveLength(1);expect(unit.orderQueue![0]!.type).toBe('hold');}
      }
      expect(target.owner).toBe('enemy');expect(hullContact(source,target)).toBeUndefined();
    }
    expect(queued).toBe(true);expect(attackerHit()?.target).toBe(blocker.id);expect(blocker.hp).toBeLessThan(blockerHp);
    expect(rear.hp).toBe(rearHp);expect(rear.hp).toBeGreaterThan(0);
    expect(hits.some(hit=>hit.source===rear.id&&hit.target===attackers[0]!.id&&hit.damage>0)).toBe(true);
    expect(source.sailing?.gangway?.phase).toBe('ready');
  });

  it.each(['archer','knight','golem','ogreLord','worker','sheltered'] as const)('keeps %s crew out of the automatic infantry assault',kind=>{
    const {game,source,target}=pair('carrier'), infantry=crew(game,source), excluded=crew(game,source,kind==='sheltered'?'footman':kind);
    if(kind==='sheltered') {
      const point=deckPlacement(source,excluded,game.units,cabinDoor(source),true,2)!;
      expect(point).toBeDefined(); excluded.deck={shipId:source.id,...point};Object.assign(excluded,localToWorld(source,point));
      issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[excluded.id]}); enterCabinStep(game,excluded); expect(isInCabin(excluded)).toBe(true);
    }
    const defender=crew(game,target); ready(game,source,target);
    expect(infantry.order).toMatchObject({type:'board',transportId:target.id});
    expect(excluded.order.type).not.toBe('board'); expect(excluded.deck?.shipId).toBe(source.id);
    expect(defender.hp).toBeGreaterThan(0); expect(target.owner).toBe('enemy');
  });

  it('breaks the 60-HP passage from real hull damage, retreats its walker and enforces the twenty-second cooldown',()=>{
    const {game,source,target}=pair('transport','player'), soldier=crew(game,source);
    crossing(game,source,target,soldier); expect(soldier.gangway!.t).toBeLessThan(.5);
    const state=source.sailing!.gangway!, cooldown=state.cooldownUntilTick, deploymentTick=state.readyAtTick-GANGWAY_SETUP_TICKS;
    expect(state.hp).toBe(GANGWAY_HP); expect(cooldown-deploymentTick).toBe(GANGWAY_COOLDOWN_TICKS);
    const initialHp=source.hp, ownHp=soldier.hp, losses=game.match.stats.unitsLost.player;
    strikeUnit(game,{id:'enemy-cannon',owner:'enemy',x:source.x,y:source.y-500},source,40,'spell');
    expect(state.hp).toBeCloseTo(GANGWAY_HP-(initialHp-source.hp)*GANGWAY_HULL_DAMAGE_SHARE);
    for(let shot=0;source.sailing?.gangway&&shot<4;shot++)strikeUnit(game,{id:'enemy-cannon',owner:'enemy',x:source.x,y:source.y-500},source,40,'spell');
    expect(source.sailing?.gangway).toBeUndefined(); expect(source.hp).toBeGreaterThan(0); stepGame(game);
    expect(soldier.gangway).toBeUndefined(); expect(soldier.deck?.shipId).toBe(source.id); expect(soldier.hp).toBe(ownHp);
    expect(deckPointFits(source,soldier,soldier.deck!,game.units)).toBe(true); expect(game.match.stats.unitsLost.player).toBe(losses);
    issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[soldier.id]});
    expect(()=>begin(game,source,target)).toThrow(/cooling down/);
    while(game.tick<cooldown)stepGame(game);
    expect(()=>begin(game,source,target)).not.toThrow(); stepGame(game); expect(source.sailing?.gangway).toBeDefined();
  });

  it('honors a queued helm departure after setup and cancels the passage before leaving',()=>{
    const {game,source,target}=pair(); crew(game,source); begin(game,source,target); stepGame(game);
    const station={x:source.x,y:source.y}, goal={x:source.x+600,y:source.y};
    expect(source.sailing?.gangway?.phase).toBe('deploying');
    issuePlayerCommand(game,'player',{type:'move',unitIds:[source.id],...goal,queued:true,avoidCombat:true});
    for(let tick=0;tick<10;tick++){stepGame(game);expect(source.order.type).toBe('boardShip');expect(source).toMatchObject(station);}
    until(game,()=>source.order.type==='move',100);
    expect(source.sailing?.gangway).toBeUndefined(); expect(source.order).toMatchObject({type:'move',...goal});
    until(game,()=>source.arrivedAt?.x===goal.x&&source.arrivedAt?.y===goal.y&&source.order.type==='idle',1800);
    for(let tick=0;tick<120;tick++) {
      stepGame(game);expect(source.order.type).toBe('idle');expect(source.sailing?.gangway).toBeUndefined();
      expect(game.units.filter(unit=>unit.deck?.shipId===source.id).every(unit=>unit.order.type!=='board')).toBe(true);
    }
    expect(source.x).toBeGreaterThan(station.x+580);expect(Math.hypot(source.x-goal.x,source.y-goal.y)).toBeLessThan(20);
    expect(target.order.type).toBe('hold');
  });

  it('keeps a cancelled ready passage closed instead of restarting an implicit crew rendezvous',()=>{
    const {game,source,target}=pair('transport','player'), soldier=crew(game,source);
    crossing(game,source,target,soldier);const station={x:source.x,y:source.y}, hp=soldier.hp;
    issuePlayerCommand(game,'player',{type:'cancelBoardShip',unitIds:[source.id]});
    expect(source.sailing?.gangway).toBeUndefined();expect(soldier.gangway).toBeUndefined();
    expect(soldier.deck?.shipId).toBe(source.id);expect(deckPointFits(source,soldier,soldier.deck!,game.units)).toBe(true);
    for(let tick=0;tick<120;tick++) {
      stepGame(game);expect(source.order.type).toBe('idle');expect(soldier.order.type).not.toBe('board');
      expect(source.sailing?.gangway).toBeUndefined();expect(soldier.gangway).toBeUndefined();expect(soldier.deck?.shipId).toBe(source.id);
    }
    expect(source).toMatchObject(station);expect(soldier.hp).toBe(hp);expect(target.order.type).toBe('hold');
  });

  it('lets an explicit helm departure cancel a ready crossing and safely return its walker',()=>{
    const {game,source,target}=pair('transport','player'), soldier=crew(game,source);
    crossing(game,source,target,soldier); const hp=soldier.hp, targetPose={x:target.x,y:target.y};
    const goal={x:source.x+600,y:source.y};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[source.id],...goal,avoidCombat:true});
    expect(source.sailing?.gangway).toBeUndefined(); stepGame(game);
    expect(source.order).toMatchObject({type:'move',...goal}); expect(target.order.type).toBe('hold'); expect(target).toMatchObject(targetPose);
    expect(soldier.gangway).toBeUndefined(); expect(soldier.deck?.shipId).toBe(source.id); expect(soldier.hp).toBe(hp);
    expect(deckPointFits(source,soldier,soldier.deck!,game.units)).toBe(true);
  });

  it('continues a JSON save taken in the water gap with identical anchors, attachment and every checksum',()=>{
    const {game,source,target}=pair('transport','player'), soldier=crew(game,source); crossing(game,source,target,soldier);
    const saved=JSON.parse(JSON.stringify(snapshotGame(game))), original=JSON.stringify(saved), restored=sea();
    restoreSnapshotIntoGame(restored,saved,game.nextId);
    expect(restored.units.find(unit=>unit.id===soldier.id)!.gangway).toEqual(soldier.gangway);
    expect(restored.units.find(unit=>unit.id===source.id)!.sailing!.gangway).toEqual(source.sailing!.gangway);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    for(let tick=0;tick<300;tick++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
    expect(soldier.deck?.shipId).toBe(target.id); expect(soldier.gangway).toBeUndefined();
    expect(deckPointFits(target,soldier,soldier.deck!,game.units)).toBe(true); expect(JSON.stringify(saved)).toBe(original);
  });
});
