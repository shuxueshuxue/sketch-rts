import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim';
import type { Corpse } from '../shared/types';
import { deckRemainsByShip, deckRemainsPose, remainsOpacity, remainsVariant } from './deck-remains';

function fixture() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  const ship=game.spawnUnit('player','warship',300,400);
  const corpse:Corpse={id:'fallen-crew',unitId:'crew',kind:'footman',owner:'player',x:310,y:420,radius:18,diedAtTick:10,deck:{shipId:ship.id,x:10,y:20}};
  return {ship,corpse};
}

describe('deck remains support',()=>{
  it('follows the displayed hull translation and rotation without mutating death facts',()=>{
    const {ship,corpse}=fixture(),before=JSON.stringify(corpse);
    const pose=deckRemainsPose(corpse,ship,{x:700,y:900,heading:Math.PI/2})!;
    expect(pose.x).toBeCloseTo(680);expect(pose.y).toBeCloseTo(910);
    expect(pose.heading).toBe(Math.PI/2);expect(pose.height).toBeGreaterThan(0);
    expect(JSON.stringify(corpse)).toBe(before);
    expect(deckRemainsPose(corpse,ship,{x:800,y:500,heading:0})).toMatchObject({x:810,y:520,heading:0});
  });
  it('hides a missing or sunk support without falling back to saved ground coordinates',()=>{
    const {ship,corpse}=fixture();
    expect(deckRemainsPose(corpse,undefined)).toBeUndefined();
    expect(deckRemainsPose(corpse,{...ship,id:'different'})).toBeUndefined();
    expect(deckRemainsPose(corpse,{...ship,hp:0})).toBeUndefined();
    const ground={...corpse};delete ground.deck;
    expect(deckRemainsPose(ground,ship)).toBeUndefined();
  });
  it('keeps immutable support indexing and pose choice independent of weather opacity',()=>{
    const {corpse}=fixture(),corpses=[corpse];
    const groups=deckRemainsByShip(corpses),variant=remainsVariant(corpse.id);
    expect(deckRemainsByShip(corpses)).toBe(groups);
    expect(groups.get(corpse.deck!.shipId)).toEqual([corpse]);
    expect(remainsOpacity(10,10)).toBeCloseTo(.58);
    expect(remainsOpacity(10000,10)).toBeCloseTo(.4);
    expect(remainsVariant(corpse.id)).toBe(variant);
    const ground={...corpse,id:'ground'};delete ground.deck;
    corpses.push(ground);
    expect(deckRemainsByShip(corpses).get(corpse.deck!.shipId)).toEqual([corpse]);
  });
});
