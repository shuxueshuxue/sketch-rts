import {describe,expect,it} from 'vitest';
import {createUnit} from '../../shared/map';
import {bodyMass} from '../../shared/physical-body';
import {shipProfile} from '../../shared/ship-geometry';
import {boardUnit} from '../../shared/decks';
import {createGame,snapshotGame} from '../../shared/sim';
import {convoyCanCarry} from './convoy-load';

describe('physical convoy payload planning',()=>{
  it('asks for more lift when cavalry fit the weight limit but not the actual deck',()=>{
    const game=createGame('bareDuel'),boat=createUnit('a','player','carrier',500,500);
    const cavalry=Array.from({length:6},(_,i)=>createUnit(`rider-${i}`,'player','knight',0,0));
    game.units=[boat,...cavalry];
    expect(cavalry.reduce((mass,unit)=>mass+bodyMass(unit),0)).toBeLessThan(shipProfile(boat)!.loadCapacity);
    const snapshot=snapshotGame(game),before=JSON.stringify(snapshot);
    expect(convoyCanCarry(snapshot,[boat],cavalry)).toBe(false);
    const second=createUnit('b','player','carrier',900,500);
    expect(convoyCanCarry(snapshot,[boat,second],cavalry)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('counts existing occupants once and reserves their floor space',()=>{
    const game=createGame('bareDuel'),boat=createUnit('a','player','transport',500,500);
    const crew=createUnit('worker','player','worker',500,500);
    game.units=[boat,crew];expect(boardUnit(boat,crew,game.units)).toBe(true);
    expect(convoyCanCarry(snapshotGame(game),[boat],[crew,crew])).toBe(true);
  });
});
