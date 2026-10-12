import {boardUnit} from './decks';
import {checksumGame} from './sim/checksum';
import {describe,it,expect} from 'vitest';
import {createGame,stepGame,snapshotGame,restoreSnapshotIntoGame,removeUnit} from './sim';

describe('persistent remains',()=>{
 it('records each field death once, keeps it beyond effect lifetimes, and restores it without aliasing',()=>{
  const game=createGame('bareDuel');game.scriptedVictory=true;
  const unit=game.spawnUnit('player','knight',1700,1700);const id=unit.id;unit.hp=0;
  const nextId=game.nextId;stepGame(game);
  expect(game.corpses).toHaveLength(1);
  expect(game.corpses![0]).toMatchObject({unitId:id,kind:'knight',owner:'player',diedAtTick:1});
  expect(game.units.some(u=>u.id===id)).toBe(false);
  expect(game.nextId).toBe(nextId);
  const saved=snapshotGame(game),savedX=saved.corpses![0]!.x;
  const hash=checksumGame(game);game.corpses![0]!.x+=1;expect(checksumGame(game)).not.toBe(hash);expect(saved.corpses![0]!.x).toBe(savedX);
  restoreSnapshotIntoGame(game,saved,nextId);game.corpses![0]!.x+=2;
  expect(saved.corpses![0]!.x).toBe(savedX);
  for(let i=0;i<800;i++)stepGame(game);
  expect(game.corpses).toHaveLength(1);
  expect(game.entityById?.has(id)).toBe(false);
  const older={...saved};delete older.corpses;
  restoreSnapshotIntoGame(game,older,nextId);expect(game.corpses).toBeUndefined();
 });
 it('captures a surviving ship attachment without aliasing live, saved or restored state',()=>{
  const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
  const ship=game.spawnUnit('player','transport',1700,1700),crew=game.spawnUnit('player','footman',1700,1700);
  expect(boardUnit(ship,crew,game.units)).toBe(true);const deck={...crew.deck!};crew.hp=0;stepGame(game);
  const corpse=game.corpses!.find(c=>c.unitId===crew.id)!;expect(corpse.deck).toEqual(deck);
  crew.deck!.x+=11;expect(corpse.deck).toEqual(deck);
  const saved=snapshotGame(game);corpse.deck!.x+=17;expect(saved.corpses!.find(c=>c.unitId===crew.id)!.deck).toEqual(deck);
  restoreSnapshotIntoGame(game,saved,game.nextId);game.corpses!.find(c=>c.unitId===crew.id)!.deck!.y+=19;
  expect(saved.corpses!.find(c=>c.unitId===crew.id)!.deck).toEqual(deck);
  const passenger=game.spawnUnit('player','footman',ship.x,ship.y);const restoredShip=game.units.find(u=>u.id===ship.id)!;
  expect(boardUnit(restoredShip,passenger,game.units)).toBe(true);restoredShip.hp=0;stepGame(game);
  expect(game.corpses!.some(c=>c.unitId===passenger.id)).toBe(false);
 });
 it('does not mistake expiry, a scripted exit, or passengers aboard a wreck for field corpses',()=>{
  const game=createGame('bareDuel');game.scriptedVictory=true;
  const spirit=game.spawnUnit('player','spirit',1600,1600);spirit.expiresTick=game.tick+1;
  const extra=game.spawnUnit('player','footman',1600,1650);removeUnit(game,extra.id);
  const boat=game.spawnUnit('player','transport',1700,1700);
  const passenger=game.spawnUnit('player','footman',1700,1700);
  game.units=game.units.filter(u=>u.id!==passenger.id);boat.cargo=[passenger];boat.hp=0;
  stepGame(game);
  expect(game.corpses?.map(c=>c.unitId)).toEqual([boat.id]);
 });
});
