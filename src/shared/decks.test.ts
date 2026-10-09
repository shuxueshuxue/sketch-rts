import { describe,expect,it } from "vitest";
import { aimAt,invalidateMovedAim,markAimShot } from "./aiming";
import { UNIT_DEFS } from "./catalog";
import { boardUnit,canBoard,deckLoad,deckPointFits,deckPlacement,deckStaticPathExists,moveOnDeck,restoreCargoDecks,syncDecks } from "./decks";
import { bodyMass } from "./physical-body";
import { localToWorld,shipPassengers,shipProfile } from "./ship-geometry";
import { createGame,issuePlayerCommand,snapshotGame,stepGame,restoreSnapshotIntoGame } from "./sim";
import { checksumGame } from "./sim/checksum";
import { cabinDoor } from './ship-cabin';

function battle() {
  const game=createGame("bareDuel");game.units=[];
  const ship=game.spawnUnit("player","transport",900,900);
  const archer=game.spawnUnit("player","archer",900,900);
  return {game,ship,archer};
}
describe("physical decks",()=>{
  it("keeps embarked soldiers live, targetable and counted once",()=>{
    const {game,ship,archer}=battle();
    const supply=game.players.player!.supplyUsed;
    issuePlayerCommand(game,"player",{type:"board",unitIds:[archer.id],transportId:ship.id});stepGame(game);
    expect(game.units).toContain(archer);expect(archer.deck?.shipId).toBe(ship.id);
    expect(game.players.player!.supplyUsed).toBe(supply);
    const enemy=game.spawnUnit("enemy","archer",archer.x+100,archer.y);
    issuePlayerCommand(game,"enemy",{type:"attack",unitIds:[enemy.id],targetId:archer.id});
    issuePlayerCommand(game,"player",{type:"attack",unitIds:[archer.id],targetId:enemy.id});
    for(let i=0;i<100;i++)stepGame(game);
    expect(archer.hp).toBeLessThan(archer.maxHp);expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
  it("fits circles around fittings and rejects geometric or weight overload",()=>{
    const {game,ship}=battle();
    for(let i=0;i<20;i++)boardUnit(ship,game.spawnUnit("player","archer",900,900),game.units);
    const crew=shipPassengers(game.units,ship);
    expect(crew.length).toBeGreaterThan(1);expect(crew.length).toBeLessThan(20);
    expect(deckLoad(game.units,ship)).toBeLessThanOrEqual(shipProfile(ship)!.loadCapacity);
    for(const unit of crew)expect(deckPointFits(ship,unit,unit.deck!,game.units)).toBe(true);
    const golem=game.spawnUnit("player","graniteGolem",900,900);
    expect(bodyMass(golem)).toBeGreaterThan(shipProfile(ship)!.loadCapacity);
    expect(canBoard(ship,golem,game.units)).toBe(false);
  });
  it("carries stationarity through translation and rotation, while deck walking resets aim",()=>{
    const {game,ship,archer}=battle();boardUnit(ship,archer,game.units);syncDecks(game.units);
    aimAt(archer,UNIT_DEFS.archer,{x:archer.x+10,y:archer.y},1);markAimShot(archer);
    const aim=archer.aim;
    ship.x+=200;ship.sailing!.heading=Math.PI/2;syncDecks(game.units);
    invalidateMovedAim(archer,UNIT_DEFS.archer);expect(archer.aim).toBe(aim);
    expect(archer.x).toBeCloseTo(localToWorld(ship,archer.deck!).x);
    archer.deck!.x+=10;syncDecks(game.units);invalidateMovedAim(archer,UNIT_DEFS.archer);
    expect(archer.aim).toBeUndefined();
  });
  it("constrains deck movement and lets selected crew receive normal orders",()=>{
    const {game,ship,archer}=battle();boardUnit(ship,archer,game.units);
    issuePlayerCommand(game,"player",{type:"holdPosition",unitIds:[archer.id]});
    expect(archer.order.type).toBe("hold");
    for(let i=0;i<100;i++)moveOnDeck(archer,ship,{x:5000,y:5000},game.units);
    expect(deckPointFits(ship,archer,archer.deck!,game.units)).toBe(true);
  });
  it('rejects a permanently sealed deck route even when its endpoint fits',()=>{
    const {game}=battle();game.units=[];
    const ship=game.spawnUnit('player','shipOfTheLine',900,900),large=game.spawnUnit('player','ogreLord',900,900),small=game.spawnUnit('player','footman',900,900);
    expect(boardUnit(ship,large,game.units)).toBe(true);expect(boardUnit(ship,small,game.units)).toBe(true);
    const largeGoal=deckPlacement(ship,large,game.units,cabinDoor(ship),false,2)!;
    const smallGoal=deckPlacement(ship,small,game.units,cabinDoor(ship),false,2)!;
    expect(deckPointFits(ship,large,largeGoal,game.units,false)).toBe(true);
    expect(deckStaticPathExists(ship,large,largeGoal)).toBe(false);
    expect(deckStaticPathExists(ship,small,smallGoal)).toBe(true);
    expect(deckStaticPathExists(ship,small,small.deck!)).toBe(true);
  });
  it("keeps an issued deck destination attached while its hull sails and turns",()=>{
    const {game,ship,archer}=battle();boardUnit(ship,archer,game.units);syncDecks(game.units);
    const point=deckPlacement(ship,archer,game.units,{x:42,y:16},false)!;
    issuePlayerCommand(game,"player",{type:"move",unitIds:[archer.id],...localToWorld(ship,point)});
    issuePlayerCommand(game,"player",{type:"move",unitIds:[ship.id],x:1200,y:1100});
    for(let i=0;i<100;i++)stepGame(game);
    expect(Math.hypot(archer.deck!.x-point.x,archer.deck!.y-point.y)).toBeLessThan(6);
    expect(ship.x).toBeGreaterThan(900);
  });
  it("summons onto free deck floor and preserves cooldown if nothing fits",()=>{
    const {game}=battle();game.units=[];
    const hull=game.spawnUnit("player","carrier",900,900),caster=game.spawnUnit("player","summoner",900,900);
    expect(boardUnit(hull,caster,game.units)).toBe(true);
    issuePlayerCommand(game,"player",{type:"cast",unitId:caster.id,ability:"summon",x:caster.x,y:caster.y});
    const spirit=game.units.find(unit=>unit.kind==="spirit")!;
    expect(spirit.deck?.shipId).toBe(hull.id);expect(deckPointFits(hull,spirit,spirit.deck!,game.units)).toBe(true);
    caster.abilityCooldowns=undefined;
    for(let i=0;i<20;i++)boardUnit(hull,game.spawnUnit("player","spirit",900,900),game.units);
    const count=game.units.filter(unit=>unit.kind==="spirit").length;
    issuePlayerCommand(game,"player",{type:"cast",unitId:caster.id,ability:"summon",x:caster.x,y:caster.y});
    expect(game.units.filter(unit=>unit.kind==="spirit")).toHaveLength(count);
    expect(caster.abilityCooldowns).toBeUndefined();
  });
  it("restores old nested cargo without lost IDs or duplicate supply",()=>{
    const {game,ship,archer}=battle();game.units=game.units.filter(u=>u!==archer);ship.cargo=[archer];
    restoreCargoDecks(game.units);
    expect(ship.cargo).toBeUndefined();expect(game.units.filter(u=>u.id===archer.id)).toHaveLength(1);
    expect(archer.deck?.shipId).toBe(ship.id);
  });
  it("preserves moving decks through snapshots and deterministic continuation",()=>{
    const {game,ship,archer}=battle();boardUnit(ship,archer,game.units);
    issuePlayerCommand(game,"player",{type:"move",unitIds:[ship.id],x:1200,y:1150});
    for(let i=0;i<20;i++)stepGame(game);
    const restored=createGame("bareDuel");restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<50;i++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
  });
  it("removes live crew exactly once when their hull sinks",()=>{
    const {game,ship,archer}=battle();boardUnit(ship,archer,game.units);ship.hp=0;stepGame(game);
    expect(game.units.some(u=>u.id===ship.id || u.id===archer.id)).toBe(false);
    expect(game.match.stats.unitsLost.player).toBe(2);
  });
});
