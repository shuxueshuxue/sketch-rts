import {describe,it,expect} from 'vitest';
import {createGame,snapshotGame} from '../shared/sim';
import {UNIT_DEFS} from '../shared/catalog';
import {isShipKind} from '../shared/ship-geometry';
import {PresentationViewIndex} from './presentation-view';
import {UnitMotionSmoother} from './unit-motion';
import {creatureShadow} from './art/painted-creatures';
import {unitGlyphScale} from './glyphs';
import type {UnitKind} from '../shared/types';

function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.buildings=[];game.effects=[];game.projectiles=[];return game;}
describe('presentation viewport candidates',()=>{
  it('queries a fixed view without returning ten thousand ordinary offscreen units, while preserving original draw order',()=>{
    const game=scene();
    for(let i=0;i<10000;i++)game.spawnUnit('player','footman',6000+i%100*60,6000+Math.floor(i/100)*60);
    const a=game.spawnUnit('player','footman',50,50),b=game.spawnUnit('player','lancer',100,60);
    const index=new PresentationViewIndex(),snapshot=snapshotGame(game);index.update(snapshot);
    const view={x:0,y:0,width:800,height:600};
    expect(index.query(view).map(u=>u.id)).toEqual([a.id,b.id]);
    expect(index.query({...view,x:-20000,y:-20000})).toHaveLength(0);
    expect(index.update(snapshot)).toBe(false);expect(index.stats().builds).toBe(1);
    expect(index.units.get(game.units[9000]!.id)).toBe(snapshot.units[9000]);
  });
  it('covers every existing ordinary GPU body visibility test across all kinds, radii and zooms',()=>{
    const game=scene();
    for(const kind of Object.keys(UNIT_DEFS) as UnitKind[])if(!isShipKind(kind)){
      for(let i=0;i<24;i++){const unit=game.spawnUnit('player',kind,-400+i%6*240,-400+Math.floor(i/6)*320);unit.radius=i%2?UNIT_DEFS[kind].radius:80;}
    }
    const snapshot=snapshotGame(game),index=new PresentationViewIndex();index.update(snapshot);
    for(const zoom of [.2,.6,1,2,4])for(const x of [-800,0,800]){
      const view={x,y:0,width:800,height:600,zoom},ids=new Set(index.query(view).map(u=>u.id));
      for(const unit of snapshot.units){
        const bodyY=unit.y-(creatureShadow(unit.kind)?.y??17)*unitGlyphScale(unit.radius);
        if(unit.x>=x-180&&unit.x<=x+800/zoom+180&&bodyY>=-180&&bodyY<=600/zoom+180)expect(ids.has(unit.id),`${unit.kind} ${unit.x},${unit.y} z${zoom}`).toBe(true);
      }
    }
  });
  it('keeps an interpolated charge whose endpoints are outside but whose path crosses the screen',()=>{
    const game=scene(),unit=game.spawnUnit('player','footman',-1000,100);unit.order={type:'charge',targetId:'target',resume:{type:'hold',x:1600,y:100}};
    const motion=new UnitMotionSmoother();motion.update(snapshotGame(game),0);
    unit.x=1600;game.tick++;const snapshot=snapshotGame(game);motion.update(snapshot,50);
    const index=new PresentationViewIndex();index.update(snapshot,motion);
    expect(index.query({x:0,y:0,width:800,height:600}).map(u=>u.id)).toEqual([unit.id]);
    expect(motion.position(unit,75).x).toBeCloseTo(300);
  });
  it('keeps deck, ships and unbounded story painters on both normal and very wide queries',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',8000,8000),crew=game.spawnUnit('player','footman',8000,8000),story=game.spawnUnit('player','footman',9000,9000);
    crew.deck={shipId:ship.id,x:10,y:10};story.variant='unbounded-story';
    const index=new PresentationViewIndex();index.update(snapshotGame(game));
    for(const width of [800,100000])expect(index.query({x:-200000,y:-200000,width,height:width}).map(u=>u.id)).toEqual([ship.id,crew.id,story.id]);
  });
  it('refreshes command snapshots and mutable tick/array/count changes and retains the first hit semantics',()=>{
    const game=scene(),unit=game.spawnUnit('player','footman',100,100),snapshot=snapshotGame(game),index=new PresentationViewIndex();index.update(snapshot);
    snapshot.units[0]!.x=5000;snapshot.tick++;expect(index.update(snapshot)).toBe(true);
    expect(index.query({x:0,y:0,width:800,height:600})).toHaveLength(0);
    snapshot.units=[{...snapshot.units[0]!,x:200}];expect(index.update(snapshot)).toBe(true);
    expect(index.query({x:0,y:0,width:800,height:600})).toHaveLength(1);
    const hit={id:'first',type:'hit' as const,unitId:unit.id,x:0,y:0,remaining:2,duration:2,damage:20};
    snapshot.effects.push(hit,{...hit,id:'second',damage:90});expect(index.update(snapshot)).toBe(true);expect(index.hits.get(unit.id)).toBe(hit);
    expect(index.update({...snapshot})).toBe(true);
    snapshot.units.push({...snapshot.units[0]!,id:'added'});expect(index.update(snapshot)).toBe(true);
    index.reset();expect(index.units.size).toBe(0);expect(index.entities.size).toBe(0);expect(index.hits.size).toBe(0);expect(index.stats().cells).toBe(0);
    expect(index.query({x:0,y:0,width:800,height:600})).toHaveLength(0);
  });
});
