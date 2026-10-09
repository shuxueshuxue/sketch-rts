import { describe, expect, it } from 'vitest';
import { boardUnit, deckLoad, deckPlacement, deckPointFits, deckStaticPathExists, syncDecks } from './decks';
import { createUnit } from './map';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave } from './savegame';
import { cabinDoor, cabinEntryRefusal, cabinExitPoint, canEnterCabin, enterCabinStep, isCabinProtected, isInCabin, leaveCabin, shipCabinCapacity, updateCabinPassengers } from './ship-cabin';
import { localToWorld, shipPassengers, shipProfile } from './ship-geometry';
import { installedWeapons, rebuildShipFittings, shipMounts, SHIP_WEAPONS } from './ship-equipment';
import { perTick } from './time';
import { bodyMass } from './physical-body';
import { createGame, issuePlayerCommand, snapshotGame, stepGame, strikeUnit } from './sim';
import { checksumGame } from './sim/checksum';
import { commandValidationError } from './sim/command-validation';
import { isGameCommand } from './command-schema';
import { buildVeteranFrame } from './veteran-runtime';
import { DAMAGE_PROFILES } from './damage-types';
import type { GameCommand, Unit } from './types';

function sea() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=game.map.height=4000;
  game.map.terrain={cell:40,cols:100,rows:100,cells:'~'.repeat(10000)};
  return game;
}
function crew(game:ReturnType<typeof sea>, ship:Unit, kind:Unit['kind']='priest') {
  const unit=game.spawnUnit(ship.owner,kind,ship.x,ship.y);
  expect(boardUnit(ship,unit,game.units)).toBe(true);
  unit.order={type:'hold',x:unit.x,y:unit.y};
  return unit;
}
function shelter(game:ReturnType<typeof sea>,ship:Unit,unit:Unit) {
  const point=deckPlacement(ship,unit,game.units,cabinDoor(ship),true,2)!;
  expect(point).toBeDefined();
  unit.deck={shipId:ship.id,...point};Object.assign(unit,localToWorld(ship,point));
  issuePlayerCommand(game,unit.owner as 'player',{type:'enterCabin',unitIds:[unit.id]});
  enterCabinStep(game,unit);
  expect(isInCabin(unit)).toBe(true);
}
function fullBattery(game:ReturnType<typeof sea>,ship:Unit) {
  for(const mount of shipMounts(ship)) if(!installedWeapons(game,ship).some(item=>item.mountId===mount.id)) game.items.push({
    id:`full-${mount.id}`,kind:'shipCannon',x:ship.x,y:ship.y,shipId:ship.id,mountId:mount.id,durability:SHIP_WEAPONS.shipCannon.hp,cooldownRemaining:0,
  });
  rebuildShipFittings(game,ship);
  expect(installedWeapons(game,ship)).toHaveLength(8);
}

describe('real cabin shelter and evacuation',()=>{
  it('rejects a warm cached cabin route during real bridge crossing and restores admission after physically walking back',()=>{
    const game=sea(),ship=game.spawnUnit('player','transport',1500,1500),target=game.spawnUnit('player','transport',1500,1900);
    ship.sailing!.heading=target.sailing!.heading=0;
    target.y=ship.y+(shipProfile(ship)!.beam+shipProfile(target)!.beam)/2+12;
    for(const hull of [ship,target])hull.order={type:'hold',x:hull.x,y:hull.y};
    const unit=crew(game,ship,'footman');expect(canEnterCabin(game,unit)).toBe(true);
    issuePlayerCommand(game,'player',{type:'boardShip',unitIds:[ship.id],targetId:target.id});
    for(let tick=0;tick<100&&ship.sailing?.gangway?.phase!=='ready';tick++)stepGame(game);
    expect(ship.sailing?.gangway?.phase).toBe('ready');
    issuePlayerCommand(game,'player',{type:'board',unitIds:[unit.id],transportId:target.id});
    for(let tick=0;tick<400&&(!unit.gangway||unit.gangway.t<.25);tick++)stepGame(game);
    expect(unit.gangway).toBeDefined();expect(deckPointFits(ship,unit,unit.deck!,[],false)).toBe(false);
    const room={...createRoom({id:'cabin-crossing',host:{id:'host',name:'Host'},mapId:'bareDuel'}),status:'inMatch' as const};
    const saved=JSON.parse(JSON.stringify(createSaveGameRecord(game,room,{id:'cabin-crossing'}))), original=JSON.stringify(saved);
    const restored=restoreGameFromSave(saved), copy=restored.units.find(other=>other.id===unit.id)!, copyShip=restored.units.find(other=>other.id===ship.id)!;
    restored.scriptedVictory=true;
    expect(checksumGame(restored)).toBe(checksumGame(game));
    const enter:GameCommand={type:'enterCabin',unitIds:[unit.id]};
    for(const [world,passenger,hull]of [[game,unit,ship],[restored,copy,copyShip]]as const) {
      expect(cabinEntryRefusal(world,passenger)).toBe('crossing');expect(canEnterCabin(world,passenger)).toBe(false);
      expect(commandValidationError(world,'player',enter)).toMatch(/cabin/i);
      expect(()=>issuePlayerCommand(world,'player',enter)).toThrow(/cabin/i);
      const position={x:passenger.x,y:passenger.y};
      // An already saved entry order must also stop instead of waiting forever in the water gap.
      passenger.order={type:'enterCabin',shipId:hull.id};enterCabinStep(world,passenger);
      expect(passenger.order.type).toBe('idle');expect(passenger).toMatchObject(position);expect(passenger.gangway).toBeDefined();
    }
    const goal=localToWorld(ship,cabinExitPoint(game,ship,unit)!);
    for(const world of [game,restored])issuePlayerCommand(world,'player',{type:'move',unitIds:[unit.id],...goal,avoidCombat:true});
    for(let tick=0;tick<300&&(unit.gangway||!deckPointFits(ship,unit,unit.deck!,[],false));tick++) {
      const before={x:unit.x,y:unit.y};stepGame(game);stepGame(restored);
      expect(Math.hypot(unit.x-before.x,unit.y-before.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(unit.gangway).toBeUndefined();expect(unit.deck?.shipId).toBe(ship.id);expect(deckPointFits(ship,unit,unit.deck!,[],false)).toBe(true);
    expect(canEnterCabin(game,unit)).toBe(true);expect(canEnterCabin(restored,copy)).toBe(true);
    for(const world of [game,restored])issuePlayerCommand(world,'player',enter);
    for(let tick=0;tick<300&&!isInCabin(unit);tick++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
    expect(isInCabin(unit)&&isInCabin(copy)).toBe(true);expect(JSON.stringify(saved)).toBe(original);
  });

  it('rechecks a positive cabin cache when the same hull receives crew in a disconnected deck region',()=>{
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1500,1500),unit=crew(game,ship,'ogreLord');
    const aft={...unit.deck!}, profile=shipProfile(ship)!, door=cabinExitPoint(game,ship,unit)!;
    expect(door).toBeDefined();expect(deckPointFits(ship,unit,aft,[],false)).toBe(true);
    expect(deckStaticPathExists(ship,unit,door)).toBe(false);
    unit.deck={shipId:ship.id,...door};Object.assign(unit,localToWorld(ship,door));
    expect(canEnterCabin(game,unit)).toBe(true);
    // Connected-surface transfer can reattach a body to a different region of the same unchanged hull.
    unit.deck=aft;Object.assign(unit,localToWorld(ship,aft));
    expect(shipProfile(ship)).toBe(profile);expect(deckPointFits(ship,unit,aft,[],false)).toBe(true);
    expect(cabinEntryRefusal(game,unit)).toBe('door');expect(canEnterCabin(game,unit)).toBe(false);
  });

  it('lets an idle default-boarded companion walk aside while a priest reaches the cabin on a moving eight-gun ship',()=>{
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1600,1600);fullBattery(game,ship);
    const priest=game.spawnUnit('player','priest',ship.x,ship.y),footman=game.spawnUnit('player','footman',ship.x,ship.y);
    expect(boardUnit(ship,priest,game.units)).toBe(true);expect(boardUnit(ship,footman,game.units)).toBe(true);
    const initialFootman={...footman.deck!};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:2400,y:1600});
    for(let tick=0;tick<60;tick++)stepGame(game);
    const shipStart={x:ship.x,y:ship.y};
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[priest.id]});
    for(let tick=0;tick<200&&!isInCabin(priest);tick++){
      const before=[priest,footman].map(unit=>({...unit.deck!}));stepGame(game);
      for(const [i,unit] of [priest,footman].entries()){
        expect(Math.hypot(unit.deck!.x-before[i]!.x,unit.deck!.y-before[i]!.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        if(!isInCabin(unit))expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
      }
    }
    expect(isInCabin(priest)).toBe(true);expect(isInCabin(footman)).toBe(false);
    expect(footman.order).toEqual({type:'idle'});expect(footman.deck).not.toEqual(initialFootman);
    expect(Math.hypot(ship.x-shipStart.x,ship.y-shipStart.y)).toBeGreaterThan(1);
  });
  it.each(['default landing','foredeck'] as const)('queues all four crew from $0 under one command without clipping their bodies or spending twice their movement allowance',location=>{
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1600,1600);fullBattery(game,ship);
    const people:Unit[]=[];
    for(const kind of ['footman','priest','footman','priest'] as const){
      const unit=game.spawnUnit('player',kind,ship.x,ship.y);expect(boardUnit(ship,unit,game.units)).toBe(true);
      if(location==='foredeck'){
        const point=deckPlacement(ship,unit,game.units,{x:shipProfile(ship)!.length*.3,y:0},true,2)!;
        expect(point).toBeDefined();unit.deck={shipId:ship.id,...point};Object.assign(unit,localToWorld(ship,point));
      }
      people.push(unit);
    }
    expect(people.every(unit=>canEnterCabin(snapshotGame(game),unit))).toBe(true);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:2500,y:2000});
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:people.map(unit=>unit.id)});
    expect(people.every(unit=>unit.order.type==='enterCabin')).toBe(true);
    for(let tick=0;tick<500&&!people.every(isInCabin);tick++){
      const before=people.map(unit=>({...unit.deck!}));stepGame(game);
      for(const [i,unit] of people.entries()){
        expect(Math.hypot(unit.deck!.x-before[i]!.x,unit.deck!.y-before[i]!.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        if(!isInCabin(unit))expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
        else expect(Math.hypot(unit.deck!.x-cabinDoor(ship)!.x,unit.deck!.y-cabinDoor(ship)!.y)).toBeLessThanOrEqual(unit.radius*2+6);
      }
    }
    expect(people.every(isInCabin)).toBe(true);
    expect(installedWeapons(game,ship)).toHaveLength(8);
  });
  it.each([{kind:'priest' as const,radius:16},{kind:'footman' as const,radius:18},{kind:'footman' as const,radius:20}])('walks a newly boarded $kind of radius $radius through all eight fittings from the actual default landing',({kind,radius})=>{
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1600,1600);
    for(const mount of shipMounts(ship)) if(!installedWeapons(game,ship).some(item=>item.mountId===mount.id)) game.items.push({
      id:`full-${mount.id}`,kind:'shipCannon',x:ship.x,y:ship.y,shipId:ship.id,mountId:mount.id,durability:SHIP_WEAPONS.shipCannon.hp,cooldownRemaining:0,
    });
    rebuildShipFittings(game,ship);
    const unit=game.spawnUnit('player',kind,ship.x,ship.y);unit.radius=unit.bodyRadius=radius;
    expect(boardUnit(ship,unit,game.units)).toBe(true);expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
    const landing={...unit.deck!};
    expect(canEnterCabin(snapshotGame(game),unit)).toBe(true);
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[unit.id]});
    for(let tick=0;tick<300&&!isInCabin(unit);tick++){
      const from={...unit.deck!};stepGame(game);
      expect(Math.hypot(unit.deck!.x-from.x,unit.deck!.y-from.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
      if(!isInCabin(unit))expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
    }
    expect(isInCabin(unit)).toBe(true);expect(unit.deck).not.toEqual(landing);
    expect(Math.hypot(unit.deck!.x-cabinDoor(ship)!.x,unit.deck!.y-cabinDoor(ship)!.y)).toBeLessThanOrEqual(unit.radius*2+6);
    issuePlayerCommand(game,'player',{type:'leaveCabin',unitIds:[unit.id]});
    expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
  });
  it('walks four crew from the foredeck through a fully fitted eight-gun battery to its real cabin door',()=>{
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1600,1600);
    const before=shipProfile(ship)!;
    for(const mount of shipMounts(ship)) if(!installedWeapons(game,ship).some(item=>item.mountId===mount.id)) game.items.push({
      id:`full-${mount.id}`,kind:'shipCannon',x:ship.x,y:ship.y,shipId:ship.id,mountId:mount.id,durability:SHIP_WEAPONS.shipCannon.hp,cooldownRemaining:0,
    });
    rebuildShipFittings(game,ship);
    expect(installedWeapons(game,ship)).toHaveLength(8);
    expect(shipProfile(ship)).not.toBe(before);
    expect(shipProfile(ship)!.obstacles.filter(obstacle=>obstacle.type==='weapon')).toHaveLength(8);
    const occupants:Unit[]=[];
    for(const kind of ['footman','priest','footman','priest'] as const){
      const unit=crew(game,ship,kind),point=deckPlacement(ship,unit,game.units,{x:shipProfile(ship)!.length*.3,y:0},true,2)!;
      expect(point).toBeDefined();expect(point.x).toBeGreaterThan(shipProfile(ship)!.length*.15);
      unit.deck={shipId:ship.id,...point};Object.assign(unit,localToWorld(ship,point));
      expect(canEnterCabin(snapshotGame(game),unit)).toBe(true);
      issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[unit.id]});
      for(let tick=0;tick<500&&!isInCabin(unit);tick++){
        const from={...unit.deck!};stepGame(game);
        expect(Math.hypot(unit.deck!.x-from.x,unit.deck!.y-from.y)).toBeLessThanOrEqual(perTick(unit.speed)+1e-6);
        if(!isInCabin(unit))expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
      }
      expect(isInCabin(unit)).toBe(true);
      const door=cabinDoor(ship)!;expect(Math.hypot(unit.deck!.x-door.x,unit.deck!.y-door.y)).toBeLessThanOrEqual(unit.radius*2+6);
      occupants.push(unit);
    }
    expect(occupants).toHaveLength(4);
    for(const unit of occupants){
      issuePlayerCommand(game,'player',{type:'leaveCabin',unitIds:[unit.id]});
      expect(isInCabin(unit)).toBe(false);expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
      const door=cabinDoor(ship)!;expect(Math.hypot(unit.deck!.x-door.x,unit.deck!.y-door.y)).toBeLessThanOrEqual(unit.radius*2+6);
      issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[unit.id]});stepGame(game);expect(isInCabin(unit)).toBe(true);
    }
    expect(installedWeapons(game,ship)).toHaveLength(8);
  });
  it('gives the heavy broadside hull four usable sheltered infantry places without changing its batteries',()=>{
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1600,1600),guns=installedWeapons(game,ship).map(item=>item.id);
    expect(shipCabinCapacity(ship)).toBe(8);
    const occupants:Unit[]=[];
    for(let i=0;i<4;i++){const unit=crew(game,ship,'footman');shelter(game,ship,unit);occupants.push(unit);}
    const waiting=crew(game,ship,'priest');expect(canEnterCabin(game,waiting)).toBe(false);
    expect(occupants.every(unit=>isCabinProtected(game,unit))).toBe(true);
    expect(installedWeapons(game,ship).map(item=>item.id)).toEqual(guns);
    expect(guns).toHaveLength(4);
  });
  it('walks to the compartment before entering, keeps payload, and returns to real clear floor',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1600,1600),unit=crew(game,ship);
    const load=deckLoad(game.units,ship),start={...unit.deck!};
    issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[unit.id]});
    stepGame(game);
    expect(isInCabin(unit)).toBe(false);expect(unit.deck).not.toEqual(start);
    for(let i=0;i<120&&!isInCabin(unit);i++)stepGame(game);
    expect(isInCabin(unit)).toBe(true);expect(unit.order.type).toBe('idle');
    expect(deckLoad(game.units,ship)).toBe(load);expect(shipPassengers(game.units,ship).filter(u=>u.id===unit.id)).toHaveLength(1);
    expect(game.units.filter(u=>u.id===unit.id)).toHaveLength(1);
    const snapshot=snapshotGame(game);snapshot.units.find(u=>u.id===unit.id)!.cabin!.breached=true;
    expect(unit.cabin!.breached).toBeUndefined();
    issuePlayerCommand(game,'player',{type:'leaveCabin',unitIds:[unit.id]});
    expect(isInCabin(unit)).toBe(false);expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
    expect(deckLoad(game.units,ship)).toBe(load);
  });
  it('rejects full, absent, hostile, mounted and oversized cabin access without spending or teleporting',()=>{
    const game=sea(),ship=game.spawnUnit('player','fireShip',1600,1600),a=crew(game,ship);shelter(game,ship,a);
    const b=crew(game,ship,'worker');shelter(game,ship,b);const c=crew(game,ship);
    const gold=game.players.player!.gold,point={...c.deck!};
    expect(shipCabinCapacity(ship)).toBe(3);expect(canEnterCabin(game,c)).toBe(false);
    expect(()=>issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[c.id]})).toThrow(/available cabin/);
    expect(c.deck).toEqual(point);expect(game.players.player!.gold).toBe(gold);
    const cutter=game.spawnUnit('player','cutter',2100,1600),small=crew(game,cutter,'worker');
    expect(canEnterCabin(game,small)).toBe(false);
    const carrier=game.spawnUnit('player','carrier',2200,2000),rider=crew(game,carrier,'knight');
    expect(canEnterCabin(game,rider)).toBe(false);
    const machine=crew(game,carrier,'ballista');expect(canEnterCabin(game,machine)).toBe(false);
    const intruder=crew(game,carrier,'footman');intruder.owner='enemy';
    expect(canEnterCabin(game,rider,carrier)).toBe(false);
  });
  it('retains attached crew through ship movement without occupying exposed deck space',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);const local={...unit.deck!},load=deckLoad(game.units,ship);
    const newcomer=crew(game,ship);
    expect(deckPointFits(ship,newcomer,local,game.units,false)).toBe(true);
    ship.x+=300;ship.sailing!.heading=Math.PI/2;syncDecks(game.units);
    expect({x:unit.x,y:unit.y}).toEqual(localToWorld(ship,unit.deck!));
    expect(deckLoad(game.units,ship)).toBeGreaterThan(load);
  });
  it('keeps the sheltered crew mass at the aft compartment through save restore and exit',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship),profile=shipProfile(ship)!;
    const load=deckLoad(game.units,ship),cabin=profile.obstacles.find(obstacle=>obstacle.type==='cabin')!;
    shelter(game,ship,unit);syncDecks(game.units);
    const balance=Math.hypot(cabin.x,cabin.y)*bodyMass(unit)/load/(profile.length/2);
    expect(ship.sailing!.load).toBe(load);expect(ship.sailing!.balance).toBeCloseTo(balance);expect(balance).toBeGreaterThan(.1);
    const room={...createRoom({id:'cabin-mass',host:{id:'host',name:'Host'},mapId:'bareDuel'}),status:'inMatch' as const};
    const restored=restoreGameFromSave(createSaveGameRecord(game,room,{id:'cabin-mass'})),copy=restored.units.find(u=>u.id===ship.id)!;
    expect(copy.sailing!.load).toBe(load);expect(copy.sailing!.balance).toBeCloseTo(balance);
    issuePlayerCommand(game,'player',{type:'leaveCabin',unitIds:[unit.id]});syncDecks(game.units);
    expect(ship.sailing!.load).toBe(load);
    expect(ship.sailing!.balance).toBeCloseTo(Math.hypot(unit.deck!.x,unit.deck!.y)*bodyMass(unit)/load/(profile.length/2));
  });
  it('blocks targeted actions, repairs, item use and unloading while sheltered',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship,'worker');
    shelter(game,ship,unit);
    const commands:GameCommand[]=[
      {type:'move',unitIds:[unit.id],x:100,y:100},{type:'attack',unitIds:[unit.id],targetId:ship.id},
      {type:'repairShip',unitIds:[unit.id],targetId:ship.id},{type:'pickupItem',unitId:unit.id,itemId:'missing'},
      {type:'useItem',unitId:unit.id,itemId:'missing'},{type:'unloadPassenger',transportId:ship.id,passengerId:unit.id},
    ];
    for(const command of commands){expect(commandValidationError(game,'player',command)).toMatch(/cabin/);expect(()=>issuePlayerCommand(game,'player',command)).toThrow(/cabin/);}
    expect(isInCabin(unit)).toBe(true);
    const witch=crew(game,ship,'witch');shelter(game,ship,witch);
    expect(()=>issuePlayerCommand(game,'player',{type:'cast',unitId:witch.id,ability:'curse',targetId:'missing'})).toThrow(/cabin/);
  });
  it('prevents protected crew being manually targeted or hit by a shot already in flight',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    const shooter=game.spawnUnit('enemy','archer',unit.x+140,unit.y);
    game.projectiles.push({id:'incoming',owner:'enemy',attackerId:shooter.id,targetId:unit.id,fromX:shooter.x,fromY:shooter.y,toX:unit.x,toY:unit.y,damage:40,remaining:1,duration:1,sourceKind:'archer',damageProfile:{...DAMAGE_PROFILES.RANGED_PIERCE}});
    shelter(game,ship,unit);const hp=unit.hp;
    expect(commandValidationError(game,'enemy',{type:'attack',unitIds:[shooter.id],targetId:unit.id})).toMatch(/cannot be targeted/);
    strikeUnit(game,shooter,unit,80,'ranged');stepGame(game);
    expect(unit.hp).toBe(hp);expect(game.projectiles).not.toContainEqual(expect.objectContaining({id:'incoming'}));
    expect(shooter.order.type==='attack' && shooter.order.targetId===unit.id).toBe(false);
  });
  it('keeps hidden crew out of shell, blast and continuous spell damage, while the hull is still vulnerable',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);const hp=unit.hp,hullHp=ship.hp;
    const shooter=game.spawnUnit('enemy','bombardShip',1900,1500);
    game.projectiles.push({id:'shell',owner:'enemy',attackerId:shooter.id,targetId:ship.id,fromX:1900,fromY:1500,toX:unit.x,toY:unit.y,damage:45,remaining:1,duration:1,weapon:{...SHIP_WEAPONS.shipMortar.weapon},sourceKind:'bombardShip'});
    game.effects.push({id:'storm',type:'storm',x:unit.x,y:unit.y,owner:'enemy',remaining:40,duration:40,radius:100,damage:10,tickEvery:1});
    game.effects.push({id:'burn',type:'burningGround',x:unit.x,y:unit.y,owner:'enemy',remaining:40,duration:40,radius:100,damage:10,tickEvery:1});
    stepGame(game);expect(unit.hp).toBe(hp);expect(ship.hp).toBeLessThan(hullHp);
  });
  it('continues an existing poison rather than cleansing it on entry',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    unit.effects=[{type:'poison',remaining:21,sourceOwner:'enemy'}];
    shelter(game,ship,unit);const hp=unit.hp;stepGame(game);
    expect(unit.hp).toBeLessThan(hp);expect(unit.effects.some(e=>e.type==='poison')).toBe(true);
  });
  it('stops attack, autocast and outgoing veteran auras without deleting learned skills',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship),ally=crew(game,ship,'footman');
    unit.veteranSkill='veteranCommand';
    expect(buildVeteranFrame(game).get(ally.id)?.attackSpeedMultiplier).toBe(1.08);
    shelter(game,ship,unit);ally.hp-=30;const hp=ally.hp;
    const enemy=game.spawnUnit('enemy','footman',2100,1500);
    const enemyHp=enemy.hp;strikeUnit(game,unit,enemy,80,'spell');expect(enemy.hp).toBe(enemyHp);
    unit.order={type:'attack',targetId:enemy.id};
    expect(buildVeteranFrame(game).get(ally.id)).toBeUndefined();
    for(let i=0;i<30;i++)stepGame(game);
    expect(ally.hp).toBe(hp);expect(game.projectiles.some(p=>p.attackerId===unit.id)).toBe(false);
    expect(unit.veteranSkill).toBe('veteranCommand');
  });
  it.each(['breach','boarding'] as const)('evacuates on %s into a legal free deck point and preserves statuses',reason=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);unit.effects=[{type:'slow',remaining:100}];
    if(reason==='breach')ship.shipParts!.cabin=0;
    else {const enemy=crew(game,ship,'footman');enemy.owner='enemy';}
    updateCabinPassengers(game);
    expect(isInCabin(unit)).toBe(false);expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
    expect(unit.effects).toEqual([{type:'slow',remaining:100}]);
  });
  it('never stacks a blocked evacuation, removes protection, then retries when a real exit opens',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);
    const blockers:Unit[]=[];
    for(let i=0;i<80;i++){
      const blocker=createUnit(`packed-${i}`,'player',unit.kind,ship.x,ship.y),point=deckPlacement(ship,blocker,game.units,cabinDoor(ship),true,2);
      if(!point)break;
      blocker.deck={shipId:ship.id,...point};Object.assign(blocker,localToWorld(ship,point));blocker.order={type:'hold',x:blocker.x,y:blocker.y};game.units.push(blocker);blockers.push(blocker);
    }
    expect(deckPlacement(ship,unit,game.units,cabinDoor(ship),true,2)).toBeUndefined();
    ship.shipParts!.cabin=0;updateCabinPassengers(game);
    expect(unit.cabin?.breached).toBe(true);expect(isCabinProtected(game,unit)).toBe(false);
    expect(leaveCabin(game,unit)).toBe(false);
    const attacker=game.spawnUnit('enemy','archer',2100,1500),hp=unit.hp;
    strikeUnit(game,attacker,ship,20,'ranged');expect(unit.hp).toBeLessThan(hp);
    game.units=game.units.filter(other=>!blockers.includes(other));updateCabinPassengers(game);
    expect(isInCabin(unit)).toBe(false);expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
  });
  it('counts sheltered defenders against capture and kills them exactly once when their ship sinks',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);
    const enemy=crew(game,ship,'footman');enemy.owner='enemy';stepGame(game);expect(ship.owner).toBe('player');
    const lost=game.match.stats.unitsLost.player;
    ship.hp=0;stepGame(game);expect(game.units.some(other=>other.id===unit.id || other.id===ship.id)).toBe(false);
    expect(game.match.stats.unitsLost.player-lost).toBe(2);
    expect(game.corpses?.filter(corpse=>corpse.unitId===unit.id) ?? []).toHaveLength(0);
  });
  it('restores shelter, queue, compartment HP and the deterministic next ticks without duplication',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);ship.shipParts!.cabin=31;
    const walking=crew(game,ship,'footman');issuePlayerCommand(game,'player',{type:'enterCabin',unitIds:[walking.id]});
    syncDecks(game.units);
    const room={...createRoom({id:'cabin',host:{id:'host',name:'Host'},mapId:'bareDuel'}),status:'inMatch' as const};
    const save=createSaveGameRecord(game,room,{id:'cabin'}),original=JSON.stringify(save),restored=restoreGameFromSave(save);
    restored.scriptedVictory=true;
    expect(JSON.stringify(save)).toBe(original);expect(checksumGame(restored)).toBe(checksumGame(game));
    for(let i=0;i<30;i++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
    expect(restored.units.filter(u=>u.id===unit.id)).toHaveLength(1);
    expect(installedWeapons(restored,restored.units.find(u=>u.id===ship.id)!)).toHaveLength(installedWeapons(game,ship).length);
  });
  it('fills only the missing compartment in old saves without adding mounted weapons or changing orders',()=>{
    const game=sea(),ship=game.spawnUnit('player','warship',1500,1500),unit=crew(game,ship);
    const room={...createRoom({id:'old-cabin',host:{id:'host',name:'Host'},mapId:'bareDuel'}),status:'inMatch' as const},save=createSaveGameRecord(game,room,{id:'old-cabin'});
    save.runtime.checksumVersion=13;delete save.snapshot.units.find(u=>u.id===ship.id)!.shipParts!.cabin;
    const restored=restoreGameFromSave(save),copy=restored.units.find(u=>u.id===ship.id)!;
    expect(copy.shipParts!.cabin).toBeGreaterThan(0);expect(copy.order).toEqual(ship.order);
    expect(restored.items.map(item=>item.id)).toEqual(game.items.map(item=>item.id));
    expect(restored.units.find(u=>u.id===unit.id)!.deck).toEqual(unit.deck);
  });
  it('admits cabin commands through the shared schema and rejects unavailable queued variants',()=>{
    for(const type of ['enterCabin','leaveCabin']){
      expect(isGameCommand({type,unitIds:['crew']})).toBe(true);
      expect(isGameCommand({type,unitIds:[1]})).toBe(false);
      expect(isGameCommand({type,unitIds:['crew'],queued:true})).toBe(false);
    }
  });
  it('uses the actual door rather than free floor at the bow when its approach is blocked',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    shelter(game,ship,unit);const door=cabinDoor(ship)!;
    // Legal circles fill only the hatch approach. The opposite end remains empty.
    for(let i=0;i<60;i++){
      const blocker=createUnit(`door-${i}`,'player',unit.kind,ship.x,ship.y),point=cabinExitPoint(game,ship,blocker);
      if(!point)break;
      blocker.deck={shipId:ship.id,...point};Object.assign(blocker,localToWorld(ship,point));blocker.order={type:'hold',x:blocker.x,y:blocker.y};game.units.push(blocker);
    }
    const distant=deckPlacement(ship,unit,game.units,door,true,2);
    expect(distant).toBeDefined();expect(Math.hypot(distant!.x-door.x,distant!.y-door.y)).toBeGreaterThan(unit.radius*2+6);
    expect(cabinExitPoint(game,ship,unit)).toBeUndefined();expect(leaveCabin(game,unit)).toBe(false);
    const waiting=crew(game,ship);
    expect(canEnterCabin(game,waiting)).toBe(false);
    expect(()=>issuePlayerCommand(game,'player',{type:'leaveCabin',unitIds:[unit.id]})).toThrow(/cabin door/);
    expect(isInCabin(unit)).toBe(true);
  });
  it('protects against new poison-area attacks while keeping existing scorch and poison statuses',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship);
    unit.effects=[{type:'scorch',remaining:100},{type:'poison',remaining:40,sourceOwner:'enemy'}];
    shelter(game,ship,unit);const hp=unit.hp;
    game.effects.push({id:'poison-area',type:'burningGround',x:unit.x,y:unit.y,owner:'enemy',remaining:40,duration:40,radius:100,damage:30,tickEvery:1,damageProfile:{...DAMAGE_PROFILES.POISON}});
    stepGame(game);expect(unit.hp).toBe(hp);expect(unit.effects.map(e=>e.type)).toEqual(['scorch','poison']);
    issuePlayerCommand(game,'player',{type:'leaveCabin',unitIds:[unit.id]});
    expect(unit.effects.map(e=>e.type)).toEqual(['scorch','poison']);
  });
  it('preserves a personal regeneration item but suspends cloak damage and consumable activation',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),unit=crew(game,ship,'footman');
    unit.veteranSkill='veteranResilience';
    game.items.push({id:'ring',kind:'regenRing',carrierId:unit.id,slot:'head',x:unit.x,y:unit.y,cooldownRemaining:0},
      {id:'cloak',kind:'flameCloak',carrierId:unit.id,slot:'body',x:unit.x,y:unit.y,cooldownRemaining:0},
      {id:'scroll',kind:'healingScroll',carrierId:unit.id,slot:'carry0',x:unit.x,y:unit.y,cooldownRemaining:0});
    shelter(game,ship,unit);unit.hp-=40;
    expect(buildVeteranFrame(game).get(unit.id)?.reductions.length).toBeGreaterThan(0);
    const enemy=game.spawnUnit('enemy','footman',unit.x+30,unit.y);enemy.order={type:'hold',x:enemy.x,y:enemy.y};enemy.attackDamage=0;
    const hp=unit.hp,enemyHp=enemy.hp;
    expect(()=>issuePlayerCommand(game,'player',{type:'useItem',unitId:unit.id,itemId:'scroll'})).toThrow(/cabin/);
    for(let i=0;i<20;i++)stepGame(game);
    expect(unit.hp).toBeGreaterThan(hp);expect(enemy.hp).toBe(enemyHp);
    expect(game.items.some(item=>item.id==='scroll')).toBe(true);
    expect(game.items.find(item=>item.id==='cloak')!.cooldownRemaining).toBe(0);
  });
  it('does not let chain lightning bounce into the compartment or hidden casters emit it',()=>{
    const game=sea(),ship=game.spawnUnit('player','carrier',1500,1500),hidden=crew(game,ship),exposed=crew(game,ship,'footman');
    shelter(game,ship,hidden);
    const caster=game.spawnUnit('enemy','witch',exposed.x+180,exposed.y),hp=hidden.hp;
    game.items.push({id:'rod',kind:'lightningRod',carrierId:caster.id,slot:'carry0',x:caster.x,y:caster.y,cooldownRemaining:0});
    issuePlayerCommand(game,'enemy',{type:'useItem',unitId:caster.id,itemId:'rod',targetId:exposed.id});
    expect(hidden.hp).toBe(hp);expect(exposed.hp).toBeLessThan(exposed.maxHp);
    expect(game.effects.some(e=>e.type==='chainLightning' && e.x===hidden.x && e.y===hidden.y)).toBe(false);
    expect(commandValidationError(game,'enemy',{type:'cast',unitId:caster.id,ability:'curse',targetId:hidden.id})).toMatch(/cannot be targeted/);
  });
});
