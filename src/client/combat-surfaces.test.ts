import {it,expect} from 'vitest';
import {createGame} from '../shared/sim';
import {UnitAnimationTracker} from './unit-animation';
import {UnitFacingTracker} from './unit-facing';
import {bloodSurfaceResolver} from './combat-surfaces';
import {figureWeaponSurface} from './art/weapon-surface';
it('uses the actually rendered static weapon under reduced motion and the Canvas native scale',()=>{
 const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];
 const unit=game.spawnUnit('player','lancer',600,600),animation=new UnitAnimationTracker(),facing=new UnitFacingTracker();
 animation.update(game,0);facing.update(game.units,()=>undefined);
 game.tick=1;game.effects.push({id:'shot',type:'melee',x:630,y:660,duration:16,remaining:16,sourceId:unit.id,actionMode:'attack',actionTick:1,fromX:600,fromY:600,toX:630,toY:660});
 animation.update(game,50);
 const normal=bloodSurfaceResolver(game,animation,facing,undefined)(unit,50),still=bloodSurfaceResolver(game,animation,facing,undefined,true)(unit,50);
 expect(normal.weapon!.segments).not.toEqual(still.weapon!.segments);
 expect(still.weapon!.segments).toEqual(figureWeaponSurface('lancer',{mode:'idle',frame:0})!.segments);
 const smaller=bloodSurfaceResolver(game,animation,facing,undefined,true,.8)(unit,50);
 expect(smaller.weapon!.segments[0]!.a[0]).toBeCloseTo(still.weapon!.segments[0]!.a[0]*.8);
 expect(smaller.bodyScale).toBeCloseTo(.8);
});
