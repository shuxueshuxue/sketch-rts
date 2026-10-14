/** Test-only attribution of implicit sampling vs an explicit-gradient lookup.
 * The production helper and formal game benchmark are not changed. */
import * as THREE from 'three';
import {waitForArtGpuCompletion} from './art-gpu-completion.mjs';
const root=__CARD_GRAD_SOURCE_ROOT__;
const load=path=>import(/* @vite-ignore */ `/@fs${root}/src/${path}.ts`);
const [{PaintedCardBatches},{paintFigure},{actionPaintSize},{unitPaintKey},{configureWorldCamera},{unitGlyphScale},{creatureShadow},{createGame}]=await Promise.all([
 'client/world3d/painted-card-batches','client/art/painted-units','client/art/action-direction','client/art/paint-identity','client/world3d/projection','client/glyphs','client/art/painted-creatures','shared/sim',
].map(load));
const WIDTH=1280,HEIGHT=720,DENSITY=4;
const KINDS=['footman','lancer','priest','knight','golem','rubbleGolem','graniteGolem','ogreWarrior','ogreMage','ogreLord','deepSnapper','spiderQueen','redDragon','ancientStag','stonebackBrute','tidePriest','siegeRam','ballista','catapult','organGun'];
const CASTERS=new Set(['priest','ogreMage','tidePriest']);
const reference=new Map();let referenceDescriptors;
function distribution(values){const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];return{samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:at(.5),p95Ms:at(.95),maxMs:sorted.at(-1)};}
function differences(a,b){if(a.length!==b.length)throw new Error('Pixel domains differ');let changedChannels=0,changedPixels=0,maximum=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);if(delta){changed=true;changedChannels++;maximum=Math.max(maximum,delta);}}if(changed)changedPixels++;}return{changedChannels,changedPixels,maximum};}
async function sha(bytes){const result=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(result)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function descriptors(){
 const game=createGame('bareDuel',{aiPlayers:[],players:['player','enemy'],teams:{player:'a',enemy:'b'}});game.units=[];game.items=[];
 const units=[];
 for(let n=0;n<100;n++){
  const group=Math.floor(n/20),kind=KINDS[n%20],x=170+n%10*135,y=180+Math.floor(n/10)*75;
  const unit=game.spawnUnit(group%2?'enemy':'player',kind,x,y),facing=n%3===0?-1:1,team=group%2?'#a85644':'#477b91';
  const pose=group===0?{mode:'idle',frame:3}:group===1?{mode:'walk',frame:5}:group===2?{mode:'attack',frame:2,variant:n%3,aim:[-4,0,4][n%3]}:group===3?{mode:CASTERS.has(kind)?'cast':'attack',frame:2,variant:n%3,aim:[-4,0,4][n%3]}:{mode:n%2?'walk':'idle',frame:3,carry:6,carryAim:[-4,0,4][n%3]};
  units.push({id:`grad-unit-${n}`,kind,x,y,radius:unit.radius,team,facing,pose,foot:creatureShadow(kind)?.y??17,scale:unitGlyphScale(unit.radius),tile:actionPaintSize(pose,kind)});
 }
 return units;
}
function hook(material,arm){
 const original=material.onBeforeCompile,originalKey=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{
  original.call(material,shader,renderer);
  const lookup='diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));';
  if(shader.fragmentShader.split(lookup).length!==2||shader.fragmentShader.includes('cardMap1'))throw new Error('Expected exactly one production single-bank lookup');
  if(arm==='grad')shader.fragmentShader=shader.fragmentShader.replace(lookup,'vec2 cardUvDx = dFdx(vMapUv);\nvec2 cardUvDy = dFdy(vMapUv);\ndiffuseColor *= textureGrad(map, vec3(vMapUv, vCardLayer), cardUvDx, cardUvDy);');
 };
 material.customProgramCacheKey=()=>`${originalKey()}:diagnostic-${arm}`;material.needsUpdate=true;
}
function passPixels(renderer,scene,camera,target,sun,point,pass){
 sun.visible=pass!=='point-distance';point.visible=pass==='point-distance';renderer.setRenderTarget(target);renderer.render(scene,camera);
 const color=new Uint8Array(WIDTH*HEIGHT*4);renderer.readRenderTargetPixels(target,0,0,WIDTH,HEIGHT,color);const records=[{name:`${pass}-color`,bytes:color}];
 if(pass==='directional-depth'){
  const bytes=new Uint8Array(2048*2048*4);renderer.readRenderTargetPixels(sun.shadow.map,0,0,2048,2048,bytes);records.push({name:'directional-depth-shadow',bytes});
 }else if(pass==='point-distance')for(let face=0;face<6;face++){
  const bytes=new Uint8Array(256*256*4);renderer.readRenderTargetPixels(point.shadow.map,0,0,256,256,bytes,face);records.push({name:`point-distance-shadow-${face}`,bytes});
 }
 return records;
}
window.cardGradDiagnostic={ready:true,async cycle(arm,index,options={}){
 if(!['implicit','grad'].includes(arm))throw new Error('Unknown arm');
 const records=descriptors(),descriptorText=JSON.stringify(records);if(referenceDescriptors===undefined)referenceDescriptors=descriptorText;else if(referenceDescriptors!==descriptorText)throw new Error('Fixed snapshot/order changed');
 const canvas=document.createElement('canvas');document.body.append(canvas);
 const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false});renderer.setPixelRatio(1);renderer.setSize(WIDTH,HEIGHT);renderer.setClearColor('#a8b0a0',1);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
 const gl=renderer.getContext(),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera();configureWorldCamera(camera,{width:WIDTH,height:HEIGHT,x:0,y:0,zoom:.75});
 const sun=new THREE.DirectionalLight('#f1dcc0',2.5);sun.position.set(300,850,650);sun.target.position.set(800,0,500);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0004;sun.shadow.normalBias=.35;
 sun.shadow.camera.left=sun.shadow.camera.bottom=-1000;sun.shadow.camera.right=sun.shadow.camera.top=1000;sun.shadow.camera.near=1;sun.shadow.camera.far=4000;
 const point=new THREE.PointLight('#f1dcc0',40000);point.position.set(750,220,500);point.castShadow=true;point.shadow.mapSize.set(256,256);point.shadow.camera.near=1;point.shadow.camera.far=2500;point.visible=false;
 scene.add(sun,sun.target,point,new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25));
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(6000,6000),new THREE.MeshStandardMaterial({color:'#b5b7a1',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.set(800,-.01,500);floor.receiveShadow=true;scene.add(floor);
 const target=new THREE.WebGLRenderTarget(WIDTH,HEIGHT),anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy()),cards=new PaintedCardBatches(scene,anisotropy,{maxTextureBanks:1});
 const nativeBase=options.baseMip??1;
 cards.begin();for(const unit of records){const matrix=new THREE.Matrix4().compose(new THREE.Vector3(unit.x,0,unit.y),new THREE.Quaternion(),new THREE.Vector3().setScalar(unit.scale)),key=`${unitPaintKey(unit.kind,unit.team,unit.pose)}:${unit.facing}:${DENSITY}`;
  cards.add(key,DENSITY,ctx=>{ctx.scale(unit.facing,1);paintFigure(ctx,unit.kind,unit.team,unit.pose,unit.facing);},matrix,unit.id,unit.foot,unit.tile,1,nativeBase);
 }cards.finish(renderer);
 for(const mesh of cards.objects())for(const material of [mesh.material,mesh.customDepthMaterial,mesh.customDistanceMaterial])hook(material,arm);
 const proof=[];
 try{
  // Color plus raw directional-depth and cube-distance targets. No alpha mask,
  // RGB tolerance, mip rebuilding, texture/geometry reordering or aniso change.
  for(const pass of ['color','directional-depth','point-distance']){
   renderer.shadowMap.enabled=pass!=='color';
   for(const record of passPixels(renderer,scene,camera,target,sun,point,pass)){
    let baseline=reference.get(record.name);if(!baseline){if(arm!=='implicit')throw new Error('Oracle arm must run first');baseline=record.bytes;reference.set(record.name,baseline);}
    proof.push({name:record.name,sha256:await sha(record.bytes),...differences(baseline,record.bytes)});
   }
  }
  if(proof.some(row=>row.changedChannels))throw new Error(`Strict native RGBA mismatch: ${JSON.stringify(proof.filter(row=>row.changedChannels))}`);
  renderer.shadowMap.enabled=true;sun.visible=true;point.visible=false;renderer.setRenderTarget(target);
  for(let n=0;n<(options.warmup??6);n++){renderer.render(scene,camera);await waitForArtGpuCompletion(gl);}
  const wall=[],submission=[],waits=[],completion=[];
  for(let n=0;n<(options.frames??12);n++){
   await new Promise(resolve=>requestAnimationFrame(resolve));const start=performance.now();renderer.render(scene,camera);const submitted=performance.now(),complete=await waitForArtGpuCompletion(gl);
   wall.push(performance.now()-start);submission.push(submitted-start);waits.push(complete.waitMs);completion.push(complete);
  }
  const error=gl.getError(),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return{arm,index,baseMip:nativeBase,snapshot:records,snapshotAndOrderSha256:await sha(new TextEncoder().encode(descriptorText)),viewport:{width:WIDTH,height:HEIGHT,dpr:1,zoom:.75},anisotropy,proof,passed:proof.every(row=>!row.changedChannels)&&error===0,glError:error,
   device:{renderer:gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),version:gl.getParameter(gl.VERSION)},stats:cards.stats(),render:{...renderer.info.render},
   completeWall:distribution(wall),submission:distribution(submission),completionWait:distribution(waits),wallValuesMs:wall,submissionValuesMs:submission,completion,
   scope:'Diagnostic sampler attribution only: fixed 100 authored posed units, production one-bank batches/native mip tails, direct Three scene with directional 2048 shadow. All geometry/order/alpha/textures/mips/anisotropy identical; grad arm changes only the single-bank fragment lookup. No simulation, Canvas world/HUD passes, dynamic snapshots or AI. Submission includes driver backpressure; completion wall includes fence polling/scheduling, not GPU timer duration, hardware FPS, or formal game performance.'};
 }finally{renderer.setRenderTarget(null);cards.dispose();floor.geometry.dispose();floor.material.dispose();target.dispose();sun.shadow.dispose();point.shadow.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
}};
