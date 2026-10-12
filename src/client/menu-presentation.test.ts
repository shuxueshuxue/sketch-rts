import {createCanvas} from '@napi-rs/canvas';
import {expect,it} from 'vitest';
import {MenuBackdrop} from './menu-scenes';
import {createI18n} from './i18n';
import {worldLabelsFor,type WorldFrame} from './world-renderer';

it('wires presentation into real menu worlds and clears its history when switching scenes',()=>{
 const backdrop=new MenuBackdrop(worldLabelsFor(createI18n('en')),1),frames:WorldFrame[]=[];
 const ctx=createCanvas(320,180).getContext('2d') as unknown as CanvasRenderingContext2D;
 const capture=(frame:WorldFrame)=>{frames.push(frame);};
 backdrop.draw(ctx,320,180,0,true,capture);
 const first=frames[0]!;
 expect(first.combat).toBeDefined();expect(first.projectiles).toBeDefined();
 const source=first.snapshot.units[0]!;
 first.snapshot.effects.push({id:'menu-shot',type:'projectile',sourceId:source.id,sourceKind:source.kind,actionTick:0,actionMode:'attack',fromX:source.x,fromY:source.y,toX:source.x+100,toY:source.y,x:source.x+100,y:source.y,duration:20,remaining:20});
 first.projectiles!.update(first.snapshot);expect(first.projectiles!.size).toBe(1);
 first.snapshot.effects.push({id:'menu-hit',type:'hit',unitId:source.id,x:source.x,y:source.y,duration:14,remaining:14,damage:20,targetHpAfter:20,targetMaxHp:100,targetKind:'footman',targetUnitClass:'nonMechanical'});
 first.combat!.update(first.snapshot,0);expect(first.combat!.frame(0).droplets.length).toBeGreaterThan(0);
 backdrop.next();backdrop.draw(ctx,320,180,100,true,capture);
 const second=frames[1]!;
 expect(second.projectiles!.size).toBe(0);expect(second.combat!.frame(100).droplets).toHaveLength(0);
});
