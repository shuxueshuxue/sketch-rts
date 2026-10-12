/** Native simulation release events through the real GPU presentation. */
import * as THREE from 'three';
import {createGame,issueCommand,snapshotGame,stepGame} from '../src/shared/sim';
import {WorldPresentation} from '../src/client/world-presentation';
import {ProjectileOriginTracker} from '../src/client/projectile-origins';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {flightPose} from '../src/client/world3d/flight-pose';
import type {World3DLayer} from '../src/client/world3d/world-layer';
import type {WorldFrame} from '../src/client/world-renderer';
export async function projectileSocketProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];game.items=[];game.mercenaryCamps=[];game.shops=[];
 const sources=[game.spawnUnit('player','archer',600,510),game.spawnUnit('player','horseArcher',600,690),game.spawnUnit('player','priest',600,850)];
 const targets=[game.spawnUnit('enemy','golem',770,400),game.spawnUnit('enemy','golem',800,690),game.spawnUnit('enemy','golem',745,935)];
 targets.forEach(target=>{target.hp=target.maxHp=10000;target.order={type:'hold',x:target.x,y:target.y};});
 sources.forEach((source,i)=>issueCommand(game,{type:'attack',unitIds:[source.id],targetId:targets[i]!.id}));
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=900;document.body.append(canvas);const presentation=new WorldPresentation(canvas),projectiles=new ProjectileOriginTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:480,y:330,width:960,height:900,zoom:1.3},now:0,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),projectiles,labels:{mercenaryStock:()=>'',unitKind:k=>k},still:true};
 await presentation.prepare(frame.snapshot,'home');presentation.draw(frame,'home');
 const composite=document.createElement('canvas');composite.width=960;composite.height=900;const out=composite.getContext('2d')!,frames:string[]=[],checks:{kind:string;firstTick:number;tipError:number;origin:unknown}[]=[];const seen=new Set<string>();
 for(let i=0;i<24;i++){
  stepGame(game);frame.snapshot=snapshotGame(game);frame.now=game.tick*50;presentation.draw(frame,'home');
  const layer=(presentation as unknown as {layer:World3DLayer}).layer,scene=(layer as unknown as {scene:THREE.Scene}).scene;
  for(const effect of frame.snapshot.effects){
   const origin=projectiles.origin(effect),source=sources.find(unit=>unit.id===effect.sourceId);if(!origin||!source||seen.has(source.id))continue;
   const mesh=scene.children.find(object=>object instanceof THREE.InstancedMesh&&object.userData.ids?.includes(effect.id)) as THREE.InstancedMesh|undefined;
   if(!mesh)continue;const index=mesh.userData.ids.indexOf(effect.id),matrix=new THREE.Matrix4();mesh.getMatrixAt(index,matrix);
   const expected=flightPose(effect,0,origin),tip=new THREE.Vector3(expected.look==='arrow'?3:0,0,0).applyMatrix4(matrix);
   checks.push({kind:source.kind,firstTick:game.tick,tipError:tip.distanceTo(new THREE.Vector3(expected.x,expected.height,expected.y)),origin});seen.add(source.id);
  }
  out.clearRect(0,0,960,900);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,960,900);out.drawImage(canvas,0,0);
  out.fillStyle='#efe5ce';out.fillRect(0,0,960,32);out.fillStyle='#342c28';out.font='14px sans-serif';out.fillText(`Actual releases · archer upward / mounted archer level / priest downward · tick ${game.tick}`,14,22);frames.push(composite.toDataURL('image/png'));
  await new Promise(requestAnimationFrame);
 }
 const layer=(presentation as unknown as {layer:World3DLayer}).layer,renderer=(layer as unknown as {renderer:THREE.WebGLRenderer}).renderer;
 const glError=renderer.getContext().getError(),programs=(renderer.info.programs??[]).map(program=>({runnable:program.diagnostics?.runnable??true}));
 presentation.dispose();canvas.remove();projectiles.reset();
 return{frames,checks,glError,programs,passed:checks.length===3&&checks.every(check=>check.tipError<.001)&&glError===0&&programs.every(program=>program.runnable),method:'24 native simulation ticks; actual release events, real WorldPresentation GPU rendering. Authored arrow tip and orb center measured against the locked visual socket trajectory. No simulation coordinates, arrival durations or collision rules changed.'};
}
Object.assign(window,{projectileSocketProof});
