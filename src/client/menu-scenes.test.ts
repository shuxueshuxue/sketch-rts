import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../shared/catalog';
import { stepGame } from '../shared/sim';
import { footprintCells } from '../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { MENU_SCENES } from './menu-scenes';
import { hullContact, shipProfile } from '../shared/ship-geometry';

describe('menu demonstration worlds', () => {
  it('turns the whole convoy on both return legs without hull pileups',()=>{
    const run=MENU_SCENES.find(scene=>scene.id==='fleet')!.create();
    const ships=run.game.units.filter(unit=>shipProfile(unit)),start=ships.map(unit=>unit.x),peaks=[...start];
    expect(ships).toHaveLength(5);
    const returned=ships.map(()=>false);
    for(let tick=0;tick<120*SIM_TICKS_PER_SECOND;tick++){
      run.script(run.game,tick/SIM_TICKS_PER_SECOND);stepGame(run.game);
      for(let i=0;i<ships.length;i++){
        peaks[i]=Math.max(peaks[i]!,ships[i]!.x);
        if(peaks[i]!-ships[i]!.x>100)returned[i]=true;
        for(let j=i+1;j<ships.length;j++)expect(hullContact(ships[i]!,ships[j]!)).toBeUndefined();
      }
    }
    expect(returned).toEqual(ships.map(()=>true));
    for(let i=0;i<ships.length;i++)expect(peaks[i]!-start[i]!).toBeGreaterThan(150);
  },15000);
  it('keeps capital riders outside tower footprints using real movement', () => {
    const run=MENU_SCENES[0]!.create(), cell=run.game.map.terrain!.cell;
    const towers=run.game.buildings.filter(b=>b.kind==='defenseTower').map(b=>footprintCells(cell,b.x,b.y,b.radius));
    const riders=run.game.units.filter(u=>u.kind==='knight');
    const initial=new Map(riders.map(u=>[u.id,{x:u.x,y:u.y}]));
    let travelled = 0;
    for(let tick=0;tick<60*SIM_TICKS_PER_SECOND;tick++) {
      const before=run.game.units.map(u=>({id:u.id,x:u.x,y:u.y}));
      run.script(run.game,tick/SIM_TICKS_PER_SECOND);
      expect(run.game.units.map(u=>({id:u.id,x:u.x,y:u.y}))).toEqual(before);
      stepGame(run.game);
      for(const rider of run.game.units.filter(u=>u.kind==='knight')) for(const tower of towers) {
        const start=initial.get(rider.id)!; travelled=Math.max(travelled,Math.hypot(rider.x-start.x,rider.y-start.y));
        const col=Math.floor(rider.x/cell),row=Math.floor(rider.y/cell);
        expect(col>=tower.left&&col<=tower.right&&row>=tower.top&&row<=tower.bottom).toBe(false);
      }
    }
    expect(travelled).toBeGreaterThan(200);
  },15000);
  it('forest combat actually causes damage and casualties, then has a bounded reset', () => {
    const run=MENU_SCENES[1]!.create(), initial=run.game.units.length;
    for(let tick=0;tick<40*SIM_TICKS_PER_SECOND;tick++) {run.script(run.game,tick/SIM_TICKS_PER_SECOND);stepGame(run.game);}
    expect(run.game.units.length).toBeLessThan(initial);
    expect(run.game.corpses?.length).toBeGreaterThan(0);
    expect(run.length).toBeLessThanOrEqual(60);
  },15000);
  it('spawns each actor on terrain matching its movement domain', () => {
    for(const scene of MENU_SCENES) {
      const run=scene.create(), terrain=run.game.map.terrain!;
      for(const unit of run.game.units) {
        if(unit.deck){expect(run.game.units.some(ship=>ship.id===unit.deck!.shipId && shipProfile(ship))).toBe(true);continue;}
        const cell=terrain.cells[Math.floor(unit.y/terrain.cell)*terrain.cols+Math.floor(unit.x/terrain.cell)];
        expect(UNIT_DEFS[unit.kind].naval?['~',',']:['.',',']).toContain(cell);
      }
    }
  });
  it('keeps guards on deck and lets only actual local patrol movement animate walking',()=>{
    const run=MENU_SCENES.find(scene=>scene.id==='fleet')!.create();
    const crew=run.game.units.filter(unit=>unit.deck),start=new Map(crew.map(unit=>[unit.id,{...unit.deck!}]));
    expect(crew.length).toBeGreaterThanOrEqual(10);
    const moving=new Set<string>();
    for(let tick=0;tick<20*SIM_TICKS_PER_SECOND;tick++) {
      run.script(run.game,tick/SIM_TICKS_PER_SECOND);stepGame(run.game);
      for(const unit of crew){expect(unit.hp).toBeGreaterThan(0);expect(unit.deck?.shipId).toBe(start.get(unit.id)!.shipId);if(Math.hypot(unit.deck!.x-start.get(unit.id)!.x,unit.deck!.y-start.get(unit.id)!.y)>2)moving.add(unit.id);}
    }
    expect(moving.size).toBeGreaterThan(0);
    expect(crew.filter(unit=>unit.kind!=='worker').every(unit=>!moving.has(unit.id))).toBe(true);
  },15000);
});
