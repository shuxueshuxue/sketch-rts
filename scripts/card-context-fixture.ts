import * as THREE from 'three';
import {createShipWebglScene} from '../src/recorder/scenes/ship-webgl';
import {snapshotGame} from '../src/shared/sim';
import {World3DLayer} from '../src/client/world3d/world-layer';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {resources} from '../src/client/resources';
import type {WorldFrame} from '../src/client/world-renderer';

async function cardContextProof(){
 await resources.initialize();
 const {game,ship}=createShipWebglScene();game.units=game.units.filter(unit=>unit.id===ship.id||unit.deck?.shipId===ship.id);game.buildings=[];game.effects=[];
 const canvas=document.createElement('canvas');document.body.append(canvas);
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:true})!;if(!gl)throw Error('WebGL2 unavailable');
 const layer=World3DLayer.create(canvas,gl),overlay=document.createElement('canvas');overlay.width=800;overlay.height=640;
 const frame:WorldFrame={ctx:overlay.getContext('2d')!,snapshot:snapshotGame(game),view:{x:ship.x-800/3,y:ship.y-640/3,width:800,height:640,zoom:1.5},now:500,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),labels:{mercenaryStock:()=>'',unitKind:kind=>kind},still:true};
 await layer.prepare(frame.snapshot,'match');
 const renderer=(layer as unknown as {renderer:THREE.WebGLRenderer}).renderer;
 const read=()=>{const pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
 layer.draw(frame);const before=read(),beforeStats=layer.cardStats(),errors=[gl.getError()];
 const cached=(layer as unknown as {cards:{objects():THREE.InstancedMesh[]}}).cards.objects().map(mesh=>(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture),bases=cached.map(texture=>texture.image.data);
 let lossPrevented=false,paused=false;
 await new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('WorldLayer restore timeout')),20000);
  canvas.addEventListener('webglcontextlost',event=>{lossPrevented=event.defaultPrevented;layer.draw(frame);paused=layer.cardStats().mipLayerUpdates===beforeStats.mipLayerUpdates;setTimeout(()=>renderer.forceContextRestore(),100);},{once:true});
  canvas.addEventListener('webglcontextrestored',()=>{clearTimeout(timeout);resolve();},{once:true});renderer.forceContextLoss();
 });
 layer.draw(frame);const after=read(),afterStats=layer.cardStats();errors.push(gl.getError());
 const restored=(layer as unknown as {cards:{objects():THREE.InstancedMesh[]}}).cards.objects().map(mesh=>(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture);
 let maximum=0,differentPixels=0,visiblePixels=0;for(let p=0;p<before.length;p+=4){let changed=false;for(let c=0;c<4;c++){const d=Math.abs(before[p+c]!-after[p+c]!);maximum=Math.max(maximum,d);changed||=d!==0;}if(changed)differentPixels++;if(before[p]||before[p+1]||before[p+2])visiblePixels++;}
 const image=document.createElement('canvas');image.width=gl.drawingBufferWidth*2;image.height=gl.drawingBufferHeight;const ctx=image.getContext('2d')!;
 for(const [i,pixels] of [before,after].entries()){const upright=new Uint8ClampedArray(pixels.length),row=gl.drawingBufferWidth*4;for(let y=0;y<image.height;y++)upright.set(pixels.subarray(y*row,(y+1)*row),(image.height-y-1)*row);ctx.putImageData(new ImageData(upright,gl.drawingBufferWidth,image.height),i*gl.drawingBufferWidth,0);}
 const retainedCpuBases=restored.length===bases.length&&restored.every((texture,i)=>texture.image.data===bases[i]),freshWrappers=restored.every((texture,i)=>texture!==cached[i]);
 const programs=(renderer.info.programs??[]).map(program=>({runnable:program.diagnostics?.runnable??true}));
 const result={beforeStats,afterStats,lossPrevented,paused,retainedCpuBases,freshWrappers,visiblePixels,differentPixels,maxChannelDifference:maximum,glErrors:errors,programs,image:image.toDataURL(),passed:visiblePixels>1000&&maximum===0&&beforeStats.cards>0&&beforeStats.rasterizations===afterStats.rasterizations&&afterStats.mipLayerUpdates>beforeStats.mipLayerUpdates&&lossPrevented&&paused&&retainedCpuBases&&freshWrappers&&errors.every(error=>error===0)&&programs.every(program=>program.runnable)};
 const disposalDiagnostics:{method:string;error:number;stack:string|undefined}[]=[];
 const methods=['deleteTexture','deleteBuffer','deleteVertexArray','deleteFramebuffer','deleteRenderbuffer','deleteProgram'] as const;
 for(const method of methods){const original=gl[method].bind(gl);(gl as unknown as Record<string,unknown>)[method]=(...args:unknown[])=>{(original as (...args:unknown[])=>void)(...args);const error=gl.getError();if(error)disposalDiagnostics.push({method,error,stack:new Error().stack});};}
 layer.reset();Object.assign(result,{disposalDiagnostics});result.passed&&=disposalDiagnostics.length===0;errors.push(gl.getError());layer.draw(frame);errors.push(gl.getError());result.passed&&=errors.every(error=>error===0);layer.dispose();result.passed&&=disposalDiagnostics.length===0;canvas.remove();return result;
}
Object.assign(window,{cardContextProof});
