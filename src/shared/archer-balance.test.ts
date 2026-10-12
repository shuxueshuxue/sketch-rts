import { describe, expect, it } from 'vitest';
import { createGame, refreshUnitStats, strikeUnit } from './sim';
import type { UnitKind } from './types';

function scene() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];
  game.scriptedVictory=true;
  delete game.map.terrain;
  return game;
}

describe('basic archer durability',()=>{
  it.each(['archer','sparkArcher'] as const)('%s survives five ordinary Footman blows before the sixth kills it',kind=>{
    const game=scene(),target=game.spawnUnit('player',kind,1000,1000);
    const attacker=game.spawnUnit('enemy','footman',1040,1000);
    expect(attacker.attackDamage).toBe(16);
    for(let hit=0;hit<5;hit++)strikeUnit(game,attacker,target,attacker.attackDamage,'melee');
    expect(target.hp).toBe(kind==='archer'?3:5);
    strikeUnit(game,attacker,target,attacker.attackDamage,'melee');
    expect(target.hp).toBeLessThanOrEqual(0);
  });

  it.each(['archer','sparkArcher'] as const)('%s survives four Ravager blows before the fifth kills it',kind=>{
    const game=scene(),target=game.spawnUnit('player',kind,1000,1000);
    const attacker=game.spawnUnit('enemy','emberRavager',1040,1000);
    expect(attacker.attackDamage).toBe(20);
    for(let hit=0;hit<4;hit++)strikeUnit(game,attacker,target,attacker.attackDamage,'melee');
    expect(target.hp).toBe(kind==='archer'?3:5);
    strikeUnit(game,attacker,target,attacker.attackDamage,'melee');
    expect(target.hp).toBeLessThanOrEqual(0);
  });

  it.each([
    {kind:'archer' as UnitKind,health:[83,111,138,166],damage:13},
    {kind:'sparkArcher' as UnitKind,health:[85,113,142,170],damage:9},
  ])('grows $kind health at each star without raising weapon damage',({kind,health,damage})=>{
    const game=scene(),unit=game.spawnUnit('player',kind,1000,1000);
    for(let star=0;star<4;star++){
      unit.level=star;refreshUnitStats(game,unit);
      expect(unit.maxHp).toBe(health[star]);
      expect(unit.hp).toBe(unit.maxHp);
      expect(unit.attackDamage).toBe(damage);
    }
  });

  it.each([
    {kind:'archer' as UnitKind,health:[83,95,108,120],veteranHealth:241},
    {kind:'sparkArcher' as UnitKind,health:[85,98,111,123],veteranHealth:247},
  ])('applies every HP research level and three-star growth to $kind through live stat refresh',({kind,health,veteranHealth})=>{
    const game=scene(),unit=game.spawnUnit('player',kind,1000,1000);
    for(let level=0;level<4;level++){
      game.players.player!.upgrades.reinforcedPlating=level;
      refreshUnitStats(game,unit);
      expect(unit.maxHp).toBe(health[level]);
      expect(unit.hp).toBe(unit.maxHp);
    }
    unit.level=3;refreshUnitStats(game,unit);
    expect(unit.maxHp).toBe(veteranHealth);
    expect(unit.hp).toBe(unit.maxHp);
  });
});
