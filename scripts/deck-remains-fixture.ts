/** Native crew death, rendered on the support through actual GPU depth. */
import * as THREE from 'three';
import { createShipWebglScene } from '../src/recorder/scenes/ship-webgl';
import { issuePlayerCommand, snapshotGame, stepGame, strikeUnit } from '../src/shared/sim';
import { WorldPresentation } from '../src/client/world-presentation';
import { UnitAnimationTracker } from '../src/client/unit-animation';
import { UnitFacingTracker } from '../src/client/unit-facing';
import { deckRemainsPose } from '../src/client/deck-remains';
import type { World3DLayer } from '../src/client/world3d/world-layer';
import type { WorldFrame } from '../src/client/world-renderer';

export async function deckRemainsProof(){
 const {game,ship}=createShipWebglScene();
 game.buildings=[];game.resources=[];game.mercenaryCamps=[];game.shops=[];game.obstacles=[];
 const crew=game.units.find(unit=>unit.deck?.shipId===ship.id)!;
 strikeUnit(game,{id:'deck-proof-hit',owner:'enemy',x:ship.x-100,y:ship.y},crew,crew.hp*2,'spell');
 stepGame(game);
 const corpse=game.corpses?.find(body=>body.unitId===crew.id);
 if(!corpse?.deck)throw new Error('Native crew death did not retain deck facts');
 issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:ship.x+250,y:ship.y+280});
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=800;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas);
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:650,y:620,width:960,height:800,zoom:1.5},now:game.tick*50,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),labels:{mercenaryStock:()=>'',unitKind:k=>k},still:true};
 await presentation.prepare(frame.snapshot,'match');
 const composite=document.createElement('canvas');composite.width=960;composite.height=800;const out=composite.getContext('2d')!,frames:string[]=[];
 const checks:{tick:number;heading:number;shipX:number;shipY:number;visible:boolean;deckHeightError:number;rasterizations:number;opacity:number|undefined}[]=[];
 let policyCorrect=true;
 let occlusion:{visibleDifferencePixels:number;coveredDifferencePixels:number}|undefined;
 const active=(layer:World3DLayer)=>{
  const scene=(layer as unknown as {scene:THREE.Scene}).scene;
  return scene.children.find(object=>object instanceof THREE.InstancedMesh&&object.visible&&object.userData.ids?.slice(0,object.count).includes(corpse.id)) as THREE.InstancedMesh|undefined;
 };
 for(let i=0;i<24;i++){
  if(i===20)strikeUnit(game,{id:'sinking-proof-hit',owner:'enemy',x:ship.x-100,y:ship.y},ship,100000,'spell');
  for(let tick=0;tick<8;tick++)stepGame(game);
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;presentation.draw(frame,'match');
  const layer=(presentation as unknown as {layer:World3DLayer}).layer,mesh=active(layer);
  let error=0,opacity:number|undefined;
  if(mesh){
   const index=mesh.userData.ids.indexOf(corpse.id),matrix=new THREE.Matrix4();mesh.getMatrixAt(index,matrix);
   const pose=deckRemainsPose(corpse,ship)!;error=Math.abs(matrix.elements[13]!-(pose.height+.12));
   const material=mesh.material as THREE.MeshBasicMaterial;
   policyCorrect&&=material.transparent&&material.depthTest&&!material.depthWrite&&!mesh.castShadow&&mesh.renderOrder<0&&!layer.positions.has(corpse.id);
   const attr=mesh.geometry.getAttribute('cardOpacity');opacity=attr?.getX(index);
   if(i===0){
    const scene=(layer as unknown as {scene:THREE.Scene}).scene,renderer=(layer as unknown as {renderer:THREE.WebGLRenderer}).renderer,gl=renderer.getContext();
    const pixels=()=>{renderer.render(scene,layer.camera);const data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
    const different=(a:Uint8Array,b:Uint8Array)=>{let count=0;for(let p=0;p<a.length;p+=4)if(a[p]!==b[p]||a[p+1]!==b[p+1]||a[p+2]!==b[p+2]||a[p+3]!==b[p+3])count++;return count;};
    const shown=pixels();mesh.visible=false;const absent=pixels();mesh.visible=true;
    // A proof-only opaque slab above the physical deck tests the actual depth
    // buffer. It is not a unit, simulation entity, or shipped game asset.
    const blocker=new THREE.Mesh(new THREE.BoxGeometry(200,20,180),new THREE.MeshBasicMaterial({color:'#284656'}));
    blocker.position.set(pose.x,pose.height+12,pose.y);blocker.rotation.y=-pose.heading;scene.add(blocker);
    const covered=pixels();mesh.visible=false;const coveredAbsent=pixels();mesh.visible=true;
    occlusion={visibleDifferencePixels:different(shown,absent),coveredDifferencePixels:different(covered,coveredAbsent)};
    scene.remove(blocker);blocker.geometry.dispose();blocker.material.dispose();renderer.render(scene,layer.camera);
   }
  }
  checks.push({tick:game.tick,heading:ship.sailing!.heading,shipX:ship.x,shipY:ship.y,visible:!!mesh,deckHeightError:error,rasterizations:layer.remainsStats().rasterizations,opacity});
  out.clearRect(0,0,960,800);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,960,800);out.drawImage(canvas,0,0);
  out.fillStyle='#efe5ce';out.fillRect(0,0,960,32);out.fillStyle='#342c28';out.font='14px sans-serif';out.fillText(`Deck remains · native crew death / moving and turning support / sunk support hidden · tick ${game.tick}`,10,22);frames.push(composite.toDataURL('image/png'));
  await new Promise(requestAnimationFrame);
 }
 const layer=(presentation as unknown as {layer:World3DLayer}).layer,renderer=(layer as unknown as {renderer:THREE.WebGLRenderer}).renderer;
 const glError=renderer.getContext().getError(),programs=(renderer.info.programs??[]).map(program=>({runnable:program.diagnostics?.runnable??true}));
 const visible=checks.slice(0,20),sunk=checks.slice(20),rasterizations=visible.map(check=>check.rasterizations);
 const passed=policyCorrect&&!!occlusion&&occlusion.visibleDifferencePixels>0&&occlusion.coveredDifferencePixels===0&&visible.every(check=>check.visible&&check.deckHeightError<.001)&&sunk.every(check=>!check.visible)&&Math.max(...rasterizations)===Math.min(...rasterizations)&&Math.abs(visible.at(-1)!.heading-visible[0]!.heading)>.01&&glError===0&&programs.every(program=>program.runnable);
 presentation.dispose();canvas.remove();
 return{frames,checks,policyCorrect,occlusion,glError,programs,passed,method:'Native strikeUnit death cleanup, native move/stepGame support motion and native hull death. Actual WebGL WorldPresentation; scene matrices and material policy plus screenshots. Actual depth-buffer proof toggles the corpse with and without an opaque proof-only slab: visible pixels must differ, fully covered pixels must not. Slab is removed before screenshot capture.'};
}
Object.assign(window,{deckRemainsProof});
