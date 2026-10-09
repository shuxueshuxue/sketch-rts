import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from './sim';
import { boardUnit, deckPlacement, syncDecks } from './decks';
import { SHIP_HULL_COST, SHIP_WEAPONS, bestFiringHeading, shipGunCanAim, damageShipParts, installedWeapons, repairShipParts, shipMounts, shipNeedsRepair, shipPartMax } from './ship-equipment';
import { UNIT_DEFS } from './catalog';
import { SIM_TICKS_PER_SECOND, seconds } from './time';
import { ITEM_DEFS } from './equipment';
import { weaponRules } from './equipment';
import { combatCapability } from './combat-capabilities';
import { localToWorld, shipProfile, SHIP_SIZE_MULTIPLIER } from './ship-geometry';
import { sailToward, turnShipToward } from './sailing';
import { checksumGame } from './sim/checksum';
import type { WorldItem } from './types';
import { createBuilding } from './map';
import { TRANSPORT_COMBAT } from './transport-role';
function match() { const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.items = []; game.buildings = []; game.scriptedVictory = true; delete game.map.terrain; game.players.player!.gold = 3000; return game; }
function run(game: ReturnType<typeof match>, ticks: number) { for (let i = 0; i < ticks; i++)
    stepGame(game); }
describe('physical ship equipment', () => {
    it('keeps the hull free of reticles while each working mounted cannon aims and fires',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','transport',1270,800);
        enemy.hp=enemy.maxHp=10000;enemy.order={type:'hold',x:enemy.x,y:enemy.y};
        const cannon=installedWeapons(game,ship)[0]!;
        issuePlayerCommand(game,'player',{type:'aim',unitIds:[ship.id],x:1100,y:800});
        expect(ship.order.type).not.toBe('aim');
        issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[ship.id]});
        run(game,seconds(.4));expect(ship.aim).toBeUndefined();expect(cannon.aim?.tracking).toBe(true);expect(enemy.hp).toBe(10000);
        run(game,seconds(5));expect(ship.aim).toBeUndefined();expect(enemy.hp).toBeLessThan(10000);
    });
    it('never fires an intrinsic ranged attack from an unarmed hull',()=>{
        for(const kind of ['warship','transport','bombardShip','fireShip','carrier'] as const){
            const game=match(),ship=game.spawnUnit('player',kind,900,800),enemy=game.spawnUnit('enemy','transport',1120,800);
            game.items=[];ship.fittings=[];enemy.order={type:'hold',x:enemy.x,y:enemy.y};
            issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[ship.id]});
            run(game,seconds(5));expect(ship.aim).toBeUndefined();expect(game.projectiles).toHaveLength(0);expect(enemy.hp).toBe(enemy.maxHp);
        }
    });
    it.each(['attack','attackMove','hold','idle'] as const)('fires the cutter’s own arrows with empty fittings under %s orders',mode=>{
        const game=match(),ship=game.spawnUnit('player','cutter',900,800),enemy=game.spawnUnit('enemy','transport',1120,800);
        enemy.hp=enemy.maxHp=2000;enemy.order={type:'hold',x:enemy.x,y:enemy.y};
        if(mode==='attack')issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:enemy.id});
        else if(mode==='attackMove')issuePlayerCommand(game,'player',{type:'attackMove',unitIds:[ship.id],x:1500,y:800});
        else if(mode==='hold')issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[ship.id]});
        expect(ship.fittings).toEqual([]);expect(combatCapability(game,ship).armed).toBe(true);
        const arrows=new Set<string>();
        for(let i=0;i<seconds(5);i++){stepGame(game);for(const shot of game.projectiles)if(shot.attackerId===ship.id&&shot.attackKind==='arrow')arrows.add(shot.id);}
        expect(arrows.size).toBeGreaterThanOrEqual(3);expect(enemy.hp).toBeLessThan(2000);expect(ship.aim).toBeDefined();
    });
    it('keeps cutter arrows and a fitted cannon independently armed, aimed and cooled down',()=>{
        const game=match(),ship=game.spawnUnit('player','cutter',900,800),enemy=game.spawnUnit('enemy','transport',1120,800);
        enemy.hp=enemy.maxHp=5000;enemy.order={type:'hold',x:enemy.x,y:enemy.y};
        const cannon:WorldItem={id:'cutter-gun',kind:'shipCannon',shipId:ship.id,mountId:'bow',x:ship.x,y:ship.y,durability:90,cooldownRemaining:0};
        game.items.push(cannon);ship.fittings=[{...shipMounts(ship)[0]!,id:cannon.id}];
        issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:enemy.id});
        const shots={arrow:new Set<string>(),cannon:new Set<string>()};
        for(let i=0;i<seconds(6);i++){stepGame(game);for(const shot of game.projectiles)if(shot.attackerId===ship.id&&(shot.attackKind==='arrow'||shot.attackKind==='cannon'))shots[shot.attackKind].add(shot.id);}
        expect(shots.arrow.size).toBeGreaterThanOrEqual(4);expect(shots.cannon.size).toBeGreaterThanOrEqual(2);
        expect(ship.aim).toBeDefined();expect(cannon.aim).toBeDefined();expect(ship.aim).not.toBe(cannon.aim);
        expect(weaponRules(game,ship).attackDamage).toBe(UNIT_DEFS.cutter.attackDamage);
        cannon.durability=0;expect(combatCapability(game,ship).armed).toBe(true);expect(combatCapability(game,ship).range).toBe(UNIT_DEFS.cutter.attackRange);
        restoreSnapshotIntoGame(game,snapshotGame(game),game.nextId);expect(combatCapability(game,game.units.find(unit=>unit.id===ship.id)!).armed).toBe(true);
    });
    it('revises an automatic naval engagement while preserving a player-chosen attack target',()=>{
        for(const automatic of [false,true]){
            const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','warship',1150,880),farm=createBuilding('farm','enemy','farm',1200,800,true);
            ship.hp=ship.maxHp=10000;enemy.hp=enemy.maxHp=10000;enemy.order={type:'hold',x:enemy.x,y:enemy.y};farm.hp=farm.maxHp=5000;game.buildings.push(farm);
            issuePlayerCommand(game,'player',automatic?{type:'attackMove',unitIds:[ship.id],x:farm.x,y:farm.y}:{type:'attack',unitIds:[ship.id],targetId:farm.id});
            run(game,seconds(5));
            if(automatic){expect(enemy.hp).toBeLessThan(10000);expect(farm.hp).toBe(5000);}
            else expect(farm.hp).toBeLessThan(5000);
        }
    });
    it('turns a holding ship toward an approaching enemy without moving its guard position',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','transport',900,1100);
        enemy.hp=enemy.maxHp=2000;enemy.order={type:'hold',x:enemy.x,y:enemy.y};
        issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[ship.id]});
        run(game,seconds(12));expect(enemy.hp).toBeLessThan(2000);expect(ship.order.type).toBe('hold');
        expect(ship.x).toBe(900);expect(ship.y).toBe(800);
    });
    it('keeps firing at the next reachable threat after its original ship target sinks',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','transport',1130,800),yard=createBuilding('next-yard','enemy','shipyard',1290,800,true);
        enemy.hp=1;yard.hp=yard.maxHp=5000;game.buildings.push(yard);
        issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:enemy.id});
        run(game,seconds(20));expect(game.units.some(unit=>unit.id===enemy.id)).toBe(false);
        expect(yard.hp).toBeLessThan(5000-SHIP_WEAPONS.shipCannon.damage*2);
        expect(ship.shipParts!.rigging).toBe(shipPartMax(ship).rigging);
    });
    it('guards an idle player ship with the same aiming and target rules as combat orders',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','transport',1250,800);
        enemy.hp=enemy.maxHp=2000;enemy.order={type:'hold',x:enemy.x,y:enemy.y};
        stepGame(game);expect(enemy.hp).toBe(2000);expect(installedWeapons(game,ship)[0]!.aim?.tracking).toBe(true);
        run(game,seconds(5));expect(enemy.hp).toBeLessThan(2000);
        expect(ship.x).toBe(900);expect(ship.y).toBe(800);expect(ship.order.type).toBe('idle');
    });
    it('fires at the reachable building wall even when its center is beyond cannon range',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),yard=createBuilding('yard','enemy','shipyard',1290,800,true);
        yard.hp=yard.maxHp=5000;game.buildings.push(yard);
        issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:yard.id});
        run(game,seconds(10));expect(yard.hp).toBeLessThan(5000);
    });
    it('fires opportunistically while continuing an unloading task and proceeds after its path clears',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','warship',1100,800);
        ship.hp=ship.maxHp=10000;enemy.hp=enemy.maxHp=10000;
        enemy.order={type:'attack',targetId:ship.id};
        issuePlayerCommand(game,'player',{type:'unload',unitIds:[ship.id],x:1500,y:800});
        run(game,seconds(5));expect(enemy.hp).toBeLessThan(10000);expect(ship.order).toMatchObject({type:'unload',x:1500,y:800});
        expect(ship.x).toBeGreaterThan(900);
        game.units=game.units.filter(unit=>unit!==enemy);run(game,seconds(1));expect(ship.x).toBeGreaterThan(900);
    });
    it('keeps an explicit withdrawal moving instead of being trapped in automatic retaliation',()=>{
        const game=match(),ship=game.spawnUnit('player','warship',900,800),enemy=game.spawnUnit('enemy','warship',1100,800);
        ship.sailing!.heading=Math.PI;
        enemy.hp=enemy.maxHp=10000;enemy.order={type:'attack',targetId:ship.id};
        issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:700,y:800,avoidCombat:true});
        run(game,seconds(3));expect(ship.x).toBeLessThan(900);expect(enemy.hp).toBe(10000);
    });
    it('keeps a ship move to occupied water free of passenger deck coordinates',()=>{
        const game=match(),a=game.spawnUnit('player','transport',900,800),b=game.spawnUnit('player','warship',1200,800);
        issuePlayerCommand(game,'player',{type:'move',unitIds:[b.id],x:a.x,y:a.y});
        expect(b.order).toEqual({type:'move',x:a.x,y:a.y});
    });
    it('bounds turning per second, slows under cargo and rudder damage, and rotates crew with the hull', () => {
        const game = match(), ship = game.spawnUnit('player', 'transport', 900, 800), crew = game.spawnUnit('player', 'footman', 900, 800);
        boardUnit(ship, crew, game.units);
        syncDecks(game.units);
        ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
        for (let i = 0; i < SIM_TICKS_PER_SECOND; i++)
            turnShipToward(ship, Math.PI, game.map, game.units);
        expect(Math.abs(ship.sailing.heading)).toBeCloseTo(shipProfile(ship)!.turnRate);
        expect(crew.x).toBeCloseTo(localToWorld(ship, crew.deck!).x);
        expect(crew.y).toBeCloseTo(localToWorld(ship, crew.deck!).y);
        ship.sailing.heading = 0;
        ship.sailing.load = shipProfile(ship)!.loadCapacity;
        ship.shipParts!.rudder = shipPartMax(ship).rudder / 2;
        for (let i = 0; i < SIM_TICKS_PER_SECOND; i++)
            turnShipToward(ship, Math.PI, game.map, game.units);
        expect(Math.abs(ship.sailing.heading)).toBeCloseTo(shipProfile(ship)!.turnRate * .5 / 1.35);
        ship.shipParts!.rudder = 0;
        const before = ship.sailing.heading;
        turnShipToward(ship, -1, game.map, game.units);
        expect(ship.sailing.heading).toBe(before);
    });
    it('shares one turning budget between sailing into range and bringing guns to bear', () => {
        const game = match(), ship = game.spawnUnit('player', 'warship', 900, 800), enemy = game.spawnUnit('enemy', 'golem', 1211, 870);
        ship.sailing = { heading: -1, speed: 0, load: 0, balance: 0 };
        enemy.cooldown = 9999;
        enemy.order = { type: 'hold', x: enemy.x, y: enemy.y };
        game.items.push({ id: 'side', kind: 'shipCannon', shipId: ship.id, mountId: 'port0', durability: 90, x: ship.x, y: ship.y, cooldownRemaining: 0 });
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: enemy.id });
        for (let i = 0; i < seconds(8); i++) {
            const before = ship.sailing.heading;
            stepGame(game);
            expect(Math.abs(ship.sailing.heading - before)).toBeLessThanOrEqual(shipProfile(ship)!.turnRate / SIM_TICKS_PER_SECOND + 1e-8);
        }
    });
    it('refuses shots beyond the mount arc and turns a multi-gun broadside toward an attack target', () => {
        const game = match(), ship = game.spawnUnit('player', 'warship', 900, 800), enemy = game.spawnUnit('enemy', 'golem', 1150, 800);
        ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
        enemy.cooldown = 9999;
        enemy.order = { type: 'hold', x: enemy.x, y: enemy.y };
        for (const mountId of ['port0', 'port1'])
            game.items.push({ id: `side-${mountId}`, kind: 'shipCannon', shipId: ship.id, mountId, durability: 90, x: ship.x, y: ship.y, cooldownRemaining: 0 });
        game.items=game.items.filter(item=>item.mountId!=='bow');
        const side = game.items.find(item => item.id === 'side-port0')!;
        expect(shipGunCanAim(ship, side, enemy)).toBe(false);
        expect(Math.abs(bestFiringHeading(game, ship, enemy))).toBeGreaterThan(Math.PI / 4);
        expect(Math.abs(bestFiringHeading(game, ship, enemy))).toBeLessThan(Math.PI / 2);
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: enemy.id });
        let sideShots = 0;
        for (let i = 0; i < seconds(5); i++) {
            stepGame(game);
            if (game.effects.some(effect => effect.type === 'muzzleFlash' && effect.itemId === side.id))
                sideShots++;
        }
        expect(Math.abs(ship.sailing.heading)).toBeGreaterThan(Math.PI / 4);
        expect(sideShots).toBeGreaterThan(0);
        expect(shipGunCanAim(ship, side, enemy)).toBe(true);
    });
    it('plans a turn for a target inside veteran cannon range but outside the untrained battery range', () => {
        const game = match(), ship = game.spawnUnit('player', 'warship', 900, 800);
        const bow = shipMounts(ship).find(mount => mount.id === 'bow')!;
        const target = { x: ship.x + bow.x + SHIP_WEAPONS.shipCannon.range * 1.05, y: ship.y };
        ship.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
        expect(bestFiringHeading(game, ship, target)).toBe(Math.PI / 2);
        ship.veteranSkill = 'veteranSiegeDrill';
        const heading = bestFiringHeading(game, ship, target);
        expect(Math.abs(heading)).toBeLessThan(Math.PI / 2);
        ship.sailing.heading = heading;
        const pivot = localToWorld(ship, bow);
        expect(Math.hypot(target.x - pivot.x, target.y - pivot.y)).toBeGreaterThan(SHIP_WEAPONS.shipCannon.range);
        expect(Math.hypot(target.x - pivot.x, target.y - pivot.y)).toBeLessThanOrEqual(SHIP_WEAPONS.shipCannon.range * 1.1 + 1e-7);
        expect(shipGunCanAim(ship, installedWeapons(game, ship)[0]!, target)).toBe(true);
    });
    it('keeps veteran mortars subject to their original minimum range while planning turns', () => {
        const game = match(), ship = game.spawnUnit('player', 'bombardShip', 900, 800);
        ship.veteranSkill = 'veteranSiegeDrill';
        ship.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
        const bow = shipMounts(ship).find(mount => mount.id === 'bow')!;
        const centerDistance = SHIP_WEAPONS.shipMortar.weapon.minRange! - Math.hypot(bow.x, bow.y) - 1;
        // This point remains inside minimum range under every possible hull rotation.
        expect(bestFiringHeading(game, ship, { x: ship.x + centerDistance, y: ship.y })).toBe(Math.PI / 2);
    });
    it('uses a close-range side gun instead of retreating because its bow mortar is inside minimum range',()=>{
        const game=match(),ship=game.spawnUnit('player','bombardShip',900,800),enemy=game.spawnUnit('enemy','footman',1010,800);
        enemy.hp=enemy.maxHp=1000;enemy.cooldown=9999;enemy.order={type:'hold',x:enemy.x,y:enemy.y};
        game.items.push({id:'close-cannon',kind:'shipCannon',shipId:ship.id,mountId:'port0',durability:90,x:ship.x,y:ship.y,cooldownRemaining:0});
        issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:enemy.id});run(game,seconds(8));
        expect(ship.x).toBe(900);expect(ship.y).toBe(800);expect(enemy.hp).toBeLessThan(1000);
    });
    it('closes on a moving occupied deck without restarting an in-place waypoint every tick',()=>{
        const game=match();game.map.terrain={cell:40,cols:50,rows:40,cells:'~'.repeat(2000)};game.map.width=2000;game.map.height=1600;
        const ship=game.spawnUnit('player','warship',500,800),target=game.spawnUnit('enemy','transport',940,800),crew=game.spawnUnit('enemy','footman',940,800);
        boardUnit(target,crew,game.units);crew.order={type:'hold',x:crew.x,y:crew.y};crew.cooldown=9999;syncDecks(game.units);
        target.order={type:'move',x:1450,y:850};issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:target.id});run(game,seconds(8));
        expect(ship.x).toBeGreaterThan(650);
    });
    it('bursts a cannonball across nearby deck crew and damages their hull only once', () => {
        const game = match(), gun = game.spawnUnit('player', 'warship', 700, 800), ship = game.spawnUnit('enemy', 'transport', 950, 800);
        const a = game.spawnUnit('enemy', 'footman', 950, 800), b = game.spawnUnit('enemy', 'footman', 950, 800);
        for (const [unit, point] of [[a, { x: -5, y: 18 }], [b, { x: 20, y: -15 }]] as const) {
            boardUnit(ship, unit, game.units);
            unit.deck = { shipId: ship.id, ...deckPlacement(ship, unit, game.units, point)! };
            unit.order = { type: 'hold', x: unit.x, y: unit.y };
            unit.cooldown = 9999;
        }
        syncDecks(game.units);
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [gun.id], targetId: ship.id });
        for (let i = 0; i < seconds(3) && !game.projectiles.length; i++)
            stepGame(game);
        const shot = game.projectiles[0]!, hull = ship.hp, hpa = a.hp, hpb = b.hp;
        gun.cooldown = 9999;
        run(game, shot.remaining);
        expect(a.hp).toBeLessThan(hpa);
        expect(b.hp).toBeLessThan(hpb);
        expect(ship.hp).toBeCloseTo(hull - Math.round(shot.damage * SHIP_WEAPONS.shipCannon.weapon.hullDamageShare! * TRANSPORT_COMBAT.rangedDamageTaken));
    });
    it('prices bundled weapons as paid equipment plus a nonzero hull', () => {
        for (const [ship, weapon] of [['warship', 'shipCannon'], ['bombardShip', 'shipMortar'], ['fireShip', 'flameProjector']] as const) {
            expect(UNIT_DEFS[ship].cost).toBe(SHIP_HULL_COST[ship] + SHIP_WEAPONS[weapon].cost);
            expect(UNIT_DEFS[ship].cost).toBeGreaterThan(SHIP_WEAPONS[weapon].cost);
            const game = match(), unit = game.spawnUnit('player', ship, 900, 800);
            expect(installedWeapons(game, unit)).toHaveLength(1);
            const saved = snapshotGame(game);
            restoreSnapshotIntoGame(game, saved, game.nextId);
            expect(installedWeapons(game, game.units[0]!)).toHaveLength(1);
        }
    });
    it('hauls the very same cannon using all four carrying positions and installs it on a transport', () => {
        const game = match(), source = game.spawnUnit('player', 'warship', 800, 800), target = game.spawnUnit('player', 'transport', 900, 800), worker = game.spawnUnit('player', 'worker', 850, 750), cannon = installedWeapons(game, source)[0]!;
        const weapon: WorldItem = {id:'carried-tool',kind:'greatSword',carrierId:worker.id,slot:'carry0',x:worker.x,y:worker.y,cooldownRemaining:0}; game.items.push(weapon);
        cannon.cooldownRemaining = 17;
        cannon.durability = 45;
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { unitId: worker.id, slot: 'carry0' } })).toThrow(/all four/);
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: weapon.id, destination: { shipId: source.id, slot: 0 } });
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { unitId: worker.id, slot: 'carry0' } });
        expect(worker.gearMass).toBe(160);
        expect(worker.speed).toBeLessThan(30);
        expect(worker.radius).toBe(worker.bodyRadius);
        expect(cannon.mountId).toBeUndefined();
        expect(source.attackDamage).toBe(0);
        Object.assign(worker,localToWorld(target,{x:0,y:-shipProfile(target)!.beam/2-20}));
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { shipId: target.id, mountId: 'bow', installerId: worker.id } });
        expect(cannon.shipId).toBe(target.id);
        expect(cannon.durability).toBe(45);
        expect(cannon.cooldownRemaining).toBe(17);
        expect(target.attackDamage).toBe(20);
        expect(worker.gearMass).toBe(0);
        expect(target.fittings?.[0]?.id).toBe(cannon.id);
    });
    it('checks mount compatibility, deck clearance and hold space without requiring a nearby crew member', () => {
        const game = match(), ship = game.spawnUnit('player', 'cutter', 900, 800), worker = game.spawnUnit('player', 'worker', 900, 760);
        const cannon: WorldItem = { id: 'mortar', kind: 'shipMortar', shipId: ship.id, holdSlot: 0, x: ship.x, y: ship.y, cooldownRemaining: 0 };
        game.items.push(cannon);
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { shipId: ship.id, mountId: 'bow', installerId: worker.id } })).toThrow(/does not fit/);
        cannon.kind = 'shipCannon';
        worker.x = 200;
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { shipId: ship.id, mountId: 'bow' } });
        expect(cannon.mountId).toBe('bow');
        issuePlayerCommand(game,'player',{type:'transferItem',itemId:cannon.id,destination:{shipId:ship.id,slot:0}});
        worker.x = 900;
        expect(shipMounts(ship)).toHaveLength(1);
        const transport = game.spawnUnit('player', 'transport', 700, 700), crew = game.spawnUnit('player', 'footman', 700, 700);
        boardUnit(transport, crew, game.units);
        crew.deck = { shipId: transport.id, ...deckPlacement(transport, crew, game.units, { x: 32, y: 0 })! };
        syncDecks(game.units);
        worker.x = 700;
        worker.y = 660;
        cannon.shipId = transport.id;
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { shipId: transport.id, mountId: 'bow', installerId: worker.id } })).toThrow(/Clear the deck/);
        const small = game.spawnUnit('player', 'cutter', 700, 660);
        small.deckScale=1/SHIP_SIZE_MULTIPLIER; // This fixture specifically tests an undersized four-cell hold at physical scale 1.
        expect(() => issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { shipId: small.id, slot: 1 } })).toThrow(/No room/);
    });
    it('gives a refitted transport a working independently aimed cannon with real muzzle effects', () => {
        const game = match(), ship = game.spawnUnit('player', 'transport', 900, 800), worker = game.spawnUnit('player', 'worker', 900, 740), enemy = game.spawnUnit('enemy', 'footman', 1100, 800);
        enemy.order = { type: 'hold', x: 1100, y: 800 };
        enemy.attackDamage = 0;
        const cannon: WorldItem = { id: 'cannon', kind: 'shipCannon', shipId: ship.id, holdSlot: 0, durability: 90, x: 900, y: 800, cooldownRemaining: 0 };
        game.items.push(cannon);
        issuePlayerCommand(game, 'player', { type: 'transferItem', itemId: cannon.id, destination: { shipId: ship.id, mountId: 'bow', installerId: worker.id } });
        issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: enemy.id });
        let flashed = false;
        for (let i = 0; i < 45; i++) {
            stepGame(game);
            flashed ||= game.effects.some(effect => effect.type === 'muzzleFlash' && effect.itemId === cannon.id);
        }
        expect(enemy.hp).toBeLessThan(enemy.maxHp);
        expect(flashed).toBe(true);
        expect(cannon.aim).toBeDefined();
    });
    it('separates hull, rigging, rudder and weapon damage, then repairs propulsion before hull damage', () => {
        const game = match(), ship = game.spawnUnit('player', 'warship', 900, 800), profile = shipProfile(ship)!, parts = shipPartMax(ship), cannon = installedWeapons(game, ship)[0]!;
        const mast = profile.obstacles.find(o => o.type === 'mast')!;
        damageShipParts(game, ship, localToWorld(ship, mast), 200);
        expect(ship.shipParts!.rigging).toBe(0);
        expect(ship.shipParts!.rudder).toBe(parts.rudder);
        expect(ship.hp).toBe(ship.maxHp);
        const before = { x: ship.x, y: ship.y };
        sailToward(ship, { x: 1300, y: 800 }, game.map, game.units);
        expect({ x: ship.x, y: ship.y }).toEqual(before);
        ship.hp -= 20;
        repairShipParts(game, ship, 5);
        expect(ship.shipParts!.rigging).toBe(5);
        expect(ship.hp).toBe(ship.maxHp - 20);
        damageShipParts(game, ship, localToWorld(ship, shipMounts(ship)[0]!), 300);
        expect(cannon.durability).toBe(0);
        expect(shipNeedsRepair(game, ship)).toBe(true);
        repairShipParts(game, ship, 1000);
        expect(shipNeedsRepair(game, ship)).toBe(false);
        expect(cannon.durability).toBe(SHIP_WEAPONS.shipCannon.hp);
    });
    it('walks a repair worker over from a touching friendly deck to rescue an immobilized ship', () => {
        const game = match();
        game.map.terrain = { cell: 40, cols: 50, rows: 40, cells: '~'.repeat(2000) };
        game.map.width = 2000;
        game.map.height = 1600;
        const rescue = game.spawnUnit('player', 'transport', 800, 800), ship = game.spawnUnit('player', 'transport', 800, 880), worker = game.spawnUnit('player', 'worker', 800, 800);
        ship.x=rescue.x;ship.y=rescue.y+shipProfile(rescue)!.beam+.05; // Adjacent non-overlapping hulls, rather than intersecting launch positions.
        boardUnit(rescue, worker, game.units);
        worker.deck = { shipId: rescue.id, ...deckPlacement(rescue, worker, game.units, { x: 20, y: 0 })! };
        syncDecks(game.units);
        ship.shipParts!.rigging = 0;
        issuePlayerCommand(game, 'player', { type: 'repairShip', unitIds: [worker.id], targetId: ship.id });
        run(game, 150);
        expect(worker.deck?.shipId).toBe(ship.id);
        expect(ship.shipParts!.rigging).toBeGreaterThan(0);
        expect(game.players.player!.gold).toBeLessThan(3000);
    });
    it('saves each mounted weapon without sharing mutable aim, durability or fitting arrays', () => {
        const game = match(), ship = game.spawnUnit('player', 'warship', 900, 800), enemy = game.spawnUnit('enemy', 'footman', 1100, 800);
        enemy.cooldown = 9999;
        enemy.order = { type: 'hold', x: 1100, y: 800 };
        run(game, 5);
        const snapshot = snapshotGame(game), cannon = installedWeapons(game, ship)[0]!;
        const saved = snapshot.items.find(item => item.id === cannon.id)!;
        expect(saved.aim).toBeDefined();
        cannon.aim!.x += 10;
        expect(saved.aim!.x).not.toBe(cannon.aim!.x);
        restoreSnapshotIntoGame(game, snapshot, game.nextId);
        const restored = match();
        restoreSnapshotIntoGame(restored, snapshot, game.nextId);
        game.scriptedVictory = true;
        restored.scriptedVictory = true;
        for (let i = 0; i < 50; i++) {
            stepGame(game);
            stepGame(restored);
            expect(checksumGame(game)).toBe(checksumGame(restored));
        }
    });
});
