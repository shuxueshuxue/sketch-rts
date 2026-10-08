import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MAP_POOL } from '../../shared/map-pool';
import { createGame } from '../../shared/sim';
import { terrainBlocksPlacement } from '../../shared/build-placement';
import { requiredSupplyCap } from '../../shared/catalog';
import { bootstrapGame, bootstrapMatches, BOOTSTRAP_OPPONENTS } from './benchmark';
import { BOOTSTRAP_DOCTRINES } from './policy';

describe('bootstrap_1 acceptance matrix',()=>{
  it('plays every subject against all nine groups on every named map, as both races and both sides',()=>{
    const matches=bootstrapMatches('audit');
    expect(matches).toHaveLength(MAP_POOL.length*3*9*2*2);
    for(const map of MAP_POOL)for(const subject of Object.keys(BOOTSTRAP_DOCTRINES)){
      const games=matches.filter(match=>match.mapId===map.id&&match.subject===subject);
      expect(new Set(games.map(match=>Object.values(match.agents).slice(1).map(agent=>agent.version).join('+')))).toEqual(new Set(BOOTSTRAP_OPPONENTS.map(group=>group.join('+'))));
    }
  });
  it.each(MAP_POOL.map(map=>[map.id] as const))('preserves %s geometry and gives each independent player a valid starting hall and three workers',mapId=>{
    const pool=MAP_POOL.find(map=>map.id===mapId)!;
    const original=createGame(mapId,{players:Array.from({length:pool.players},(_,index)=>`seat${index}`),aiPlayers:[]});
    const matches=bootstrapMatches('audit',[mapId]).filter(match=>match.subject==='v9_archer'&&Object.keys(match.agents).length===3&&match.agents.p0!.race==='grove').slice(0,2);
    for(const match of matches){
      const game=bootstrapGame(match);
      expect(game.map).toEqual(original.map);
      for(const owner of Object.keys(match.agents)){
        const halls=game.buildings.filter(building=>building.owner===owner);
        expect(halls).toHaveLength(1);
        expect(terrainBlocksPlacement(game.map,'townHall',halls[0]!)).toBe(false);
        expect(game.units.filter(unit=>unit.owner===owner&&unit.kind==='worker')).toHaveLength(3);
        expect(game.players[owner]!.gold).toBe(500);
      }
      const mains=game.buildings.map(hall=>[...game.resources].sort((a,b)=>Math.hypot(a.x-hall.x,a.y-hall.y)-Math.hypot(b.x-hall.x,b.y-hall.y))[0]!.id);
      expect(new Set(mains).size).toBe(game.buildings.length);
      if(pool.players===2){
        const mainDistance=(owner:string)=>{const hall=game.buildings.find(building=>building.owner===owner)!;return Math.min(...game.resources.map(mine=>Math.hypot(mine.x-hall.x,mine.y-hall.y)));};
        expect(Math.abs(mainDistance('p1')-mainDistance('p2'))).toBeLessThanOrEqual(10);
      }
    }
  });
  it('uses unlocked opening units rather than recursively requesting a locked substitute',()=>{
    for(const doctrines of Object.values(BOOTSTRAP_DOCTRINES))for(const doctrine of doctrines)expect(requiredSupplyCap(doctrine.standIn)).toBe(0);
  });
  it('keeps frozen policy dependencies byte-identical',()=>{
    const manifest=JSON.parse(readFileSync('docs/engineering/bootstrap_1/frozen-policy.json','utf8')) as {files:Record<string,string>};
    for(const [path,hash]of Object.entries(manifest.files))expect(createHash('sha256').update(readFileSync(path)).digest('hex'),path).toBe(hash);
  });
});
