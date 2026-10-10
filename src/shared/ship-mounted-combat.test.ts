import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, stepGame } from './sim';
import { boardUnit, syncDecks } from './decks';
import { bestFiringHeading, installedWeapons, mountedFireLaneClear, mountedTargetPoint, mountedWeaponPose, shipGunCanAim, SHIP_WEAPONS } from './ship-equipment';
import { shipFireLaneClear } from './ship-fire-control';
import { hullContact } from './ship-geometry';
import { shipTraffic } from './ship-avoidance';
import { hullPassageClear } from './ship-navigation';
import { inWeaponCone } from './weapons';
import { createUnit } from './map';
import { shipPursuitGoal } from './ship-pursuit';

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.scriptedVictory = true;
  game.map.width = game.map.height = 6000;
  game.map.terrain = { cell: 40, cols: 150, rows: 150, cells: '~'.repeat(22500) };
  game.map.wind = { direction: Math.PI / 2, speed: 80 };
  return game;
}

const movingCases = [
  { label: 'bow cannon', kind: 'warship', x: 2330, y: 2100, heading: 0, firstBy: 1.5 },
  { label: 'cannon against a moving occupied deck', kind: 'warship', x: 2360, y: 2060, heading: 0, crew: true, firstBy: 2 },
  { label: 'bow mortar', kind: 'bombardShip', x: 2600, y: 2000, heading: Math.PI / 2, firstBy: 2.5 },
  { label: 'flame projector', kind: 'fireShip', x: 2245, y: 2000, heading: Math.PI / 2, firstBy: 3 },
] as const;

describe('mounted weapons in live sailing combat', () => {
  it('turns a held single-gun broadside into a clear interval whose two firing boundaries are obstructed', () => {
    const game=sea(),ship=game.spawnUnit('player','shipOfTheLine',1000,1000),target=game.spawnUnit('enemy','transport',1420,1000);
    ship.sailing!.heading=target.sailing!.heading=Math.PI/2;
    const blockers=[game.spawnUnit('player','cutter',1176.7485918849707,1038.0384407471865),game.spawnUnit('player','cutter',1255.8803045144305,905.2789421752095)];
    blockers[0]!.sailing!.heading=1.3005927374679722;blockers[1]!.sailing!.heading=2.8028941755186776;
    const gun=installedWeapons(game,ship).find(item=>item.mountId==='port0')!;
    // Use the real uninstall command. The other three cannons occupy their
    // normal four-cell hold positions and retain their mass and cooldowns.
    for(const [index,item]of installedWeapons(game,ship).filter(item=>item!==gun).entries())
      issuePlayerCommand(game,'player',{type:'transferItem',itemId:item.id,destination:{shipId:ship.id,slot:index*4}});
    expect(installedWeapons(game,ship)).toEqual([gun]);
    for(const unit of game.units)unit.order={type:'hold',x:unit.x,y:unit.y};
    const start={x:ship.x,y:ship.y,heading:Math.PI/2},end={...start,heading:2*Math.PI/3};
    expect(shipTraffic(ship,game.units,Infinity)(start,end)).toBe(true);
    expect(hullPassageClear(game.map,ship,start,end)).toBe(true);
    const headed=(heading:number)=>({...ship,sailing:{...ship.sailing!,heading}});
    const heading=bestFiringHeading(game,ship,target,0,(_item,point,heading)=>mountedFireLaneClear(headed(heading),gun,point,blockers));
    const aimed=headed(heading),point=mountedTargetPoint(game,aimed,gun,target);
    expect(heading).toBeGreaterThan(Math.PI/2);
    expect(shipGunCanAim(aimed,gun,point)).toBe(true);
    expect(mountedFireLaneClear(aimed,gun,point,blockers)).toBe(true);
    let first:number|undefined;
    for(let tick=0;tick<120;tick++){
      const cooldown=gun.cooldownRemaining;stepGame(game);
      if(gun.cooldownRemaining<=cooldown)continue;
      first??=game.tick/20;
      const shot=game.projectiles.find(shot=>shot.attackerId===ship.id)!;
      const to={x:shot.toX,y:shot.toY},pose=mountedWeaponPose(ship,gun)!;
      expect(shipGunCanAim(ship,gun,to)).toBe(true);
      expect(Math.hypot(to.x-pose.pivot.x,to.y-pose.pivot.y)).toBeLessThanOrEqual(SHIP_WEAPONS.shipCannon.range);
      expect(shipFireLaneClear({x:shot.fromX,y:shot.fromY},to,SHIP_WEAPONS.shipCannon.weapon,blockers)).toBe(true);
    }
    expect(first).toBeDefined();expect(first!).toBeLessThanOrEqual(6);
    expect({x:ship.x,y:ship.y}).toEqual({x:1000,y:1000});expect(ship.order.type).toBe('hold');
  });

  it('brings a rear broadside battery into a clear firing station while forward peers are already engaged', () => {
    const game=sea(),target=game.spawnUnit('enemy','shipOfTheLine',4000,3000);
    const fleet=[game.spawnUnit('player','shipOfTheLine',2700,3000),game.spawnUnit('player','shipOfTheLine',2200,3000),game.spawnUnit('player','warship',2000,3400)];
    // Keep this steering/clearance fixture running after either battery would
    // normally sink. Ordinary-HP combat is measured separately; gun damage,
    // cooldowns, arcs, movement and terrain are the unchanged product rules.
    for(const unit of [target,...fleet])unit.invulnerable=true;
    target.order={type:'hold',x:target.x,y:target.y};
    for(const unit of fleet)issuePlayerCommand(game,'player',{type:'attack',unitIds:[unit.id],targetId:target.id});
    const counts=new Map(fleet.map(unit=>[unit.id,{shots:0,first:undefined as number|undefined}]));
    for(let tick=0;tick<1800;tick++){
      const cooldowns=new Map(fleet.flatMap(unit=>installedWeapons(game,unit).map(item=>[item.id,item.cooldownRemaining] as const)));
      stepGame(game);
      for(const unit of fleet)for(const item of installedWeapons(game,unit)){
        if(item.cooldownRemaining<=cooldowns.get(item.id)!)continue;
        const state=counts.get(unit.id)!;state.shots++;state.first??=game.tick/20;
        const flash=game.effects.find(effect=>effect.type==='muzzleFlash'&&effect.itemId===item.id&&effect.unitId===unit.id)!;
        const to={x:flash.toX!,y:flash.toY!},pose=mountedWeaponPose(unit,item)!,def=SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
        expect(shipGunCanAim(unit,item,to)).toBe(true);
        expect(Math.hypot(to.x-pose.pivot.x,to.y-pose.pivot.y)).toBeLessThanOrEqual(def.range);
        expect(shipFireLaneClear({x:flash.fromX!,y:flash.fromY!},to,def.weapon,fleet.filter(other=>other!==unit))).toBe(true);
      }
    }
    for(const state of counts.values())expect(state.shots).toBeGreaterThanOrEqual(3);
    const rear=counts.get(fleet[1]!.id)!;
    expect(rear.first).toBeDefined();expect(rear.first!).toBeLessThanOrEqual(85);
    expect(fleet[1]!.sailing!.pursuit?.targetId).toBe(target.id);
  },30_000);

  it('waits for another player’s allied hull to clear its cannon lane, then fires without moving its held hull', () => {
    const game=createGame('bareDuel',{players:['player','ally','enemy'],aiPlayers:[],teams:{player:'blue',ally:'blue',enemy:'red'}});
    game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
    game.map={...game.map,width:6000,height:6000,wind:{direction:Math.PI/2,speed:80},
      terrain:{cell:40,cols:150,rows:150,cells:'~'.repeat(22500)}};
    const ship=game.spawnUnit('player','warship',2000,2000),ally=game.spawnUnit('ally','transport',2180,2000),target=game.spawnUnit('enemy','transport',2360,2000);
    ally.sailing!.heading=Math.PI/2;
    for(const unit of [ship,ally,target])unit.order={type:'hold',x:unit.x,y:unit.y};
    expect(hullContact(ship,ally)).toBeUndefined();expect(hullContact(ally,target)).toBeUndefined();
    const gun=installedWeapons(game,ship)[0]!,originalHp=target.hp;
    for(let tick=0;tick<40;tick++){
      stepGame(game);
      expect(gun.cooldownRemaining).toBe(0);
      expect(game.projectiles.some(shot=>shot.attackerId===ship.id)).toBe(false);
    }
    expect(target.hp).toBe(originalHp);
    issuePlayerCommand(game,'ally',{type:'move',unitIds:[ally.id],x:2180,y:2600,avoidCombat:true});
    let first:number|undefined,shots=0;
    for(let tick=0;tick<160;tick++){
      const cooldown=gun.cooldownRemaining;stepGame(game);
      if(gun.cooldownRemaining<=cooldown)continue;
      shots++;first??=game.tick/20;
      const shot=game.projectiles.find(shot=>shot.attackerId===ship.id)!;
      const to={x:shot.toX,y:shot.toY},pose=mountedWeaponPose(ship,gun)!;
      expect(shipGunCanAim(ship,gun,to)).toBe(true);
      expect(Math.hypot(to.x-pose.pivot.x,to.y-pose.pivot.y)).toBeLessThanOrEqual(SHIP_WEAPONS.shipCannon.range);
      expect(shipFireLaneClear({x:shot.fromX,y:shot.fromY},to,SHIP_WEAPONS.shipCannon.weapon,[ally])).toBe(true);
    }
    expect(first).toBeDefined();expect(first!).toBeLessThanOrEqual(6);
    expect(shots).toBeGreaterThanOrEqual(2);expect(target.hp).toBeLessThan(originalHp);
    expect({x:ship.x,y:ship.y}).toEqual({x:2000,y:2000});expect(ship.order.type).toBe('hold');
  });

  for (const fixture of movingCases) it(`fires its ${fixture.label} promptly while both vessels make way`, () => {
    const game = sea(), ship = game.spawnUnit('player', fixture.kind, 2000, 2000);
    const hasCrew = 'crew' in fixture && fixture.crew;
    const target = game.spawnUnit('enemy', hasCrew ? 'carrier' : 'transport', fixture.x, fixture.y);
    target.hp = target.maxHp = 10000; target.sailing!.heading = fixture.heading;
    if (hasCrew) {
      const crew = game.spawnUnit('enemy', 'footman', target.x, target.y);
      crew.hp = crew.maxHp = 10000; crew.cooldown = 99999;
      expect(boardUnit(target, crew, game.units)).toBe(true); syncDecks(game.units);
      crew.order = { type: 'hold', x: crew.x, y: crew.y };
    }
    issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [target.id], x: target.x + Math.cos(fixture.heading) * 2200, y: target.y + Math.sin(fixture.heading) * 2200, avoidCombat: true });
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
    const gun = installedWeapons(game, ship)[0]!;
    const enemyHp = () => game.units.filter(unit => unit.owner === 'enemy').reduce((sum, unit) => sum + unit.hp, 0);
    const beforeHp = enemyHp(), launched = new Map<string, { x: number; y: number }>();
    let first: number | undefined, shots = 0, distanceAtFirst = 0;
    for (let tick = 0; tick < 240; tick++) {
      const before = gun.cooldownRemaining; stepGame(game);
      for (const projectile of game.projectiles.filter(shot => shot.attackerId === ship.id)) {
        const initial = launched.get(projectile.id);
        if (initial) expect({ x: projectile.toX, y: projectile.toY }).toEqual(initial);
        else launched.set(projectile.id, { x: projectile.toX, y: projectile.toY });
      }
      if (gun.cooldownRemaining > before) {
        if (first === undefined) { first = game.tick / 20; distanceAtFirst = Math.hypot(ship.x - 2000, ship.y - 2000); }
        shots++;
      }
    }
    expect(first).toBeDefined(); expect(first!).toBeLessThanOrEqual(fixture.firstBy);
    expect(distanceAtFirst).toBeGreaterThan(6);
    expect(shots).toBeGreaterThanOrEqual(fixture.kind === 'bombardShip' ? 2 : 3);
    expect(enemyHp()).toBeLessThan(beforeHp);
    expect(ship.sailing!.pursuit?.targetId).toBe(target.id);
  });

  it('does not latch both combatants into moving pursuit after they stop', () => {
    const a = createUnit('a', 'player', 'warship', 1000, 1000), b = createUnit('b', 'enemy', 'warship', 1300, 1000);
    for (const unit of [a, b]) unit.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
    a.order = { type: 'attack', targetId: b.id }; b.order = { type: 'attack', targetId: a.id };
    a.sailing!.pursuit = { targetId: b.id, phase: 'engage', moving: true };
    b.sailing!.pursuit = { targetId: a.id, phase: 'engage', moving: true };
    expect(shipPursuitGoal(a, b, [a, b], 312)).toBeUndefined();
    expect(shipPursuitGoal(b, a, [a, b], 312)).toBeUndefined();
    expect(a.sailing!.pursuit?.moving).toBe(false); expect(b.sailing!.pursuit?.moving).toBe(false);
  });

  it('uses an otherwise idle gun against a nearby enemy without replacing the ordered chase', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2000, 2000);
    const far = game.spawnUnit('enemy', 'transport', 2800, 2000), near = game.spawnUnit('enemy', 'transport', 2280, 2040);
    for (const target of [far, near]) { target.order = { type: 'hold', x: target.x, y: target.y }; target.hp = target.maxHp = 10000; }
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: far.id });
    let firedAt: string | undefined;
    for (let tick = 0; tick < 40 && !firedAt; tick++) { stepGame(game); firedAt = game.projectiles.find(shot => shot.attackerId === ship.id)?.targetId; }
    expect(firedAt).toBe(near.id);
    expect(ship.order).toMatchObject({ type: 'attack', targetId: far.id });
    expect(ship.sailing!.pursuit?.targetId).toBe(far.id);
  });

  it('keeps avoidCombat movement free of opportunistic fire', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2000, 2000), target = game.spawnUnit('enemy', 'transport', 2300, 2020);
    target.order = { type: 'hold', x: target.x, y: target.y };
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 3500, y: 2000, avoidCombat: true });
    let fired = false;
    for (let tick = 0; tick < 80; tick++) { stepGame(game); fired ||= installedWeapons(game, ship).some(gun => gun.cooldownRemaining > 0); }
    expect(fired).toBe(false); expect(ship.order.type).toBe('move');
  });

  for (const kind of ['transport', 'carrier'] as const) it(`burns the reachable ${kind} hull even when its center is outside the flame`, () => {
    const game = sea(), ship = game.spawnUnit('player', 'fireShip', 2000, 2000), target = game.spawnUnit('enemy', kind, 2260, 2000);
    target.hp = target.maxHp = 10000;
    for (const unit of [ship, target]) unit.order = { type: 'hold', x: unit.x, y: unit.y };
    const before = target.hp, gun = installedWeapons(game, ship)[0]!;
    let shots = 0;
    for (let tick = 0; tick < 100; tick++) { const cooldown = gun.cooldownRemaining; stepGame(game); if (gun.cooldownRemaining > cooldown) shots++; }
    expect(shots).toBeGreaterThanOrEqual(3); expect(target.hp).toBeLessThan(before);
    expect(ship.x).toBe(2000); expect(ship.y).toBe(2000);
  });

  it('clips flames to the actual hull, cone angle and range', () => {
    const hull = createUnit('hull', 'enemy', 'carrier', 200, 100);
    hull.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
    const from = { x: 0, y: 0 }, toward = { x: 100, y: 0 };
    expect(inWeaponCone(from, toward, hull, 190, SHIP_WEAPONS.flameProjector.weapon.coneAngle!)).toBe(true);
    expect(inWeaponCone(from, toward, hull, 100, SHIP_WEAPONS.flameProjector.weapon.coneAngle!)).toBe(false);
    expect(inWeaponCone(from, { x: -100, y: 0 }, hull, 400, SHIP_WEAPONS.flameProjector.weapon.coneAngle!)).toBe(false);
  });
});
