import * as THREE from 'three';
const root=__CARD_STREAMING_SOURCE_ROOT__;
const {PaintedCardBatches}=await import(/* @vite-ignore */ `/@fs${root}/src/client/world3d/painted-card-batches.ts`);
const {paintFigure}=await import(/* @vite-ignore */ `/@fs${root}/src/client/art/painted-units.ts`);
const {configureWorldCamera}=await import(/* @vite-ignore */ `/@fs${root}/src/client/world3d/projection.ts`);
const {SHIP_CAMERA}=await import(/* @vite-ignore */ `/@fs${root}/src/shared/ship-geometry.ts`);
const params=new URLSearchParams(location.search),bankCounts=(params.get('banks')??'1,2,8,9,16').split(',').map(Number);
const modes=(params.get('modes')??'opaque,opacity,rgba').split(','),limit=Number(params.get('cases')??7),TILT=Math.tan(SHIP_CAMERA.tilt);
const canvas=document.createElement('canvas');document.body.append(canvas);
const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false});renderer.setPixelRatio(1);renderer.setSize(640,480);
renderer.setClearColor('#a8b0a0',1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
const gl=renderer.getContext(),anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera();configureWorldCamera(camera,{width:640,height:480,x:-320,y:-240,zoom:1});
const sun=new THREE.DirectionalLight('#f1dcc0',2.5);sun.position.set(-450,650,250);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0004;sun.shadow.normalBias=.35;
sun.shadow.camera.left=sun.shadow.camera.bottom=-700;sun.shadow.camera.right=sun.shadow.camera.top=700;sun.shadow.camera.near=1;sun.shadow.camera.far=3000;
const point=new THREE.PointLight('#f1dcc0',40000);point.position.set(0,130,150);point.castShadow=true;point.shadow.mapSize.set(256,256);point.shadow.camera.near=1;point.shadow.camera.far=1600;point.visible=false;
scene.add(sun,sun.target,point,new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25));
const floor=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),new THREE.MeshStandardMaterial({color:'#b5b7a1',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.01;scene.add(floor);
const screenshots=[];
// Frozen original single-array implicit sampling. It intentionally does not
// call the new bank helper, so an accidental common shader change cannot make
// two erroneous paths agree. Geometry/cardRect and authoring remain production.
function originalPatch(shader,opacity){
 shader.vertexShader='attribute float cardLayer;\nattribute vec4 cardRect;\nvarying float vCardLayer;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCardLayer = cardLayer;\ntransformed.xy = mix(cardRect.xy, cardRect.zw, uv);');
 shader.fragmentShader='precision highp sampler2DArray;\nvarying float vCardLayer;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','uniform highp sampler2DArray map;').replace('#include <map_fragment>','diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');
 if(opacity){
  shader.vertexShader='attribute float cardOpacity;\nvarying float vCardOpacity;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('vCardLayer = cardLayer;','vCardLayer = cardLayer;\nvCardOpacity = cardOpacity;');
  shader.fragmentShader='varying float vCardOpacity;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','diffuseColor.a *= vCardOpacity;\n#include <alphatest_fragment>');
 }
}
function describe(cache){return cache.objects().map(mesh=>({name:mesh.name,count:mesh.count,renderOrder:mesh.renderOrder,
 ids:[...mesh.userData.ids],orders:[...(mesh.userData.orders??[])],
 banks:(mesh.userData.banks??[]).map(page=>({width:page.texture.image.width,height:page.texture.image.height,depth:page.texture.image.depth})),
 cardBank:Array.from(mesh.geometry.getAttribute('cardBank').array).slice(0,mesh.count),
 cardLayer:Array.from(mesh.geometry.getAttribute('cardLayer').array).slice(0,mesh.count),
 cardRect:Array.from(mesh.geometry.getAttribute('cardRect').array).slice(0,mesh.count*4)}));}
function patchOracle(cache,mode){for(const mesh of cache.objects())for(const material of [mesh.material,mesh.customDepthMaterial,mesh.customDistanceMaterial]){
 material.onBeforeCompile=shader=>originalPatch(shader,mode!=='opaque');material.customProgramCacheKey=()=>`frozen-implicit-array:${mode}`;material.needsUpdate=true;
 if(mode==='rgba')material.blending=THREE.NoBlending;
}}
function setVisible(cache,value){for(const mesh of cache.proofObjects??cache.objects())mesh.visible=value;}
function paintFor(bank,domain){return ctx=>{
 const kinds=domain.tile===176?['footman','lancer','priest','redDragon']:['footman','archer','priest','rockGolem'];
 const facing=bank%2?-1:1;ctx.scale(facing,1);
 paintFigure(ctx,kinds[bank%4],['#9d532a','#345db6','#4c825d','#e3c183'][bank%4],domain.tile===176?{mode:bank%4===2?'cast':'attack',frame:2,aim:bank%3===0?-4:bank%3===1?4:0,variant:bank%3}:{mode:'idle',frame:bank%5},facing);
 // Thin low-alpha native pixels exercise alpha/RGB behavior near cutout and
 // mip-rounding boundaries. Every channel is compared, including zero RGB
 // and zero alpha; nothing is hidden by a comparison-side alpha mask.
 const pixel=new ImageData(new Uint8ClampedArray([19+bank*7,203-bank*3,91+bank,1]),1,1);
 ctx.putImageData(pixel,2+bank%5,3+bank%7);
};}
function domainFor(config,bank){
 const size=config.sizes[bank%config.sizes.length],tile=size===256||size===512?128:176,density=size/tile;
 return{size,tile,density,baseMip:config.drops[bank%config.drops.length]};
}
function matrixFor(ordinal,config){
 const at=config.overlap?new THREE.Vector3((ordinal%3-1)*5,0,0):new THREE.Vector3((ordinal%4-1.5)*65,0,(Math.floor(ordinal/4)%3-1)*58);
 const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),config.rotation??0);
 const scale=config.scale??1;return new THREE.Matrix4().compose(at,rotation,new THREE.Vector3(scale,scale,scale));
}
function draw(cache,other,target,pointPass){
 setVisible(other,false);setVisible(cache,true);sun.visible=!pointPass;point.visible=pointPass;
 renderer.setRenderTarget(target);renderer.render(scene,camera);
 const color=new Uint8Array(target.width*target.height*4);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,color);
 const shadow=[];
 if(pointPass){for(let face=0;face<6;face++){const data=new Uint8Array(256*256*4);renderer.readRenderTargetPixels(point.shadow.map,0,0,256,256,data,face);shadow.push(data);}}
 else{const data=new Uint8Array(2048*2048*4);renderer.readRenderTargetPixels(sun.shadow.map,0,0,2048,2048,data);shadow.push(data);}
 renderer.setRenderTarget(null);setVisible(cache,true);setVisible(other,true);return{color,shadow};
}
function compare(a,b){let maximum=0,changedChannels=0,changedPixels=0,alphaChanged=0,alphaZeroRgbChanged=0,referenceAlphaZeroRGBPixels=0;
 for(let i=0;i<a.length;i+=4){let changed=false;if(a[i+3]===0&&(a[i]||a[i+1]||a[i+2]))referenceAlphaZeroRGBPixels++;
  for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);maximum=Math.max(maximum,d);if(d){changedChannels++;changed=true;if(c===3)alphaChanged++;if(c<3&&a[i+3]===0)alphaZeroRgbChanged++;}}if(changed)changedPixels++;}
 return{maximum,changedChannels,changedPixels,alphaChanged,alphaZeroRgbChanged,referenceAlphaZeroRGBPixels};
}
async function sha(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function screenshot(a,b,width,height,name){const out=document.createElement('canvas');out.width=width*3;out.height=height;const ctx=out.getContext('2d'),heat=new Uint8Array(a.length);
 for(let i=0;i<a.length;i+=4){for(let c=0;c<3;c++)heat[i+c]=Math.min(255,Math.abs(a[i+c]-b[i+c])*16);heat[i+3]=255;}
 for(const [x,bytes] of [a,b,heat].entries()){const data=new Uint8ClampedArray(bytes.length);for(let y=0;y<height;y++)data.set(bytes.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);ctx.putImageData(new ImageData(data,width,height),x*width,0);}
 screenshots.push({name,image:out.toDataURL('image/png')});
}
async function caseProof(config,bankCount,mode){
 const transparent=mode!=='opaque',policy={transparent,depthWrite:!transparent,alphaTest:mode==='rgba'?0:(transparent?.01:.4),castShadow:true};
 const oracle=new PaintedCardBatches(scene,anisotropy,{...policy,maxTextureBanks:1}),candidate=new PaintedCardBatches(scene,anisotropy,{...policy,maxTextureBanks:8});
 const requests=[],warm=[];
 // One-layer production pages force actual texture-bank counts without
 // painting hundreds of duplicate poses. This test-only allocation calls the
 // real createPage/upload/finish code; no fake texture or mock renderer exists.
 for(let bank=0;bank<bankCount;bank++)if(bank%2===0)warm.push(bank);
 const plan=bankCount===1?[0,0,0,0]:[0,1,0,1,...Array.from({length:Math.max(0,bankCount-2)},(_,i)=>i+2),0,bankCount-1,1,0];
 for(const [ordinal,bank] of plan.entries()){
  const domain=domainFor(config,bank),foot=config.overlap?17:[17,23,-3,30][bank%4],opacity=mode==='opaque'?1:mode==='rgba'?bank%3===0?0:1:[.2,.55,.8,1][ordinal%4];
  requests.push({id:`${bank===0?'A':bank===1?'B':'bank'+bank}${ordinal*5}`,key:`bank-${bank}`,bank,domain,foot,opacity,matrix:matrixFor(ordinal,config)});
 }
 const fill=cache=>{
  cache.begin();for(const bank of warm){const domain=domainFor(config,bank);cache.createPage(domain.size/2**domain.baseMip,domain.size/2**domain.baseMip,1);cache.add(`bank-${bank}`,domain.density,paintFor(bank,domain),new THREE.Matrix4().makeTranslation(4000,0,4000),`warm-${bank}`,17,domain.tile,1,domain.baseMip);}cache.finish(renderer);
  cache.begin();for(let bank=0;bank<bankCount;bank++)if(bank%2){const domain=domainFor(config,bank);cache.createPage(domain.size/2**domain.baseMip,domain.size/2**domain.baseMip,1);}
  for(const request of requests)cache.add(request.key,request.domain.density,paintFor(request.bank,request.domain),request.matrix,request.id,request.foot,request.domain.tile,request.opacity,request.domain.baseMip);
  cache.finish(renderer);
 };
 const target=new THREE.WebGLRenderTarget(640,480,{depthBuffer:true,stencilBuffer:false});
 try{
  fill(oracle);fill(candidate);patchOracle(oracle,mode);if(mode==='rgba')for(const mesh of candidate.objects())for(const m of [mesh.material,mesh.customDepthMaterial,mesh.customDistanceMaterial])m.blending=THREE.NoBlending;
  const expected=requests.map(r=>r.id),referenceObjects=describe(oracle),candidateObjects=describe(candidate);
  oracle.proofObjects=oracle.objects().slice();candidate.proofObjects=candidate.objects().slice();
  const referenceOrder=referenceObjects.flatMap(o=>o.ids),candidateOrder=candidateObjects.flatMap(o=>o.ids);
  const banks=candidateObjects.map(o=>o.banks.length),reports=[];
  for(const pointPass of [false,true]){
   const a=draw(oracle,candidate,target,pointPass),b=draw(candidate,oracle,target,pointPass),color=compare(a.color,b.color),shadow=a.shadow.map((data,i)=>compare(data,b.shadow[i]));
   reports.push({pass:pointPass?'point-distance-six-faces':'sun-depth-2048',color,shadow,referenceColorSha256:await sha(a.color),candidateColorSha256:await sha(b.color),referenceShadowSha256:await Promise.all(a.shadow.map(sha)),candidateShadowSha256:await Promise.all(b.shadow.map(sha))});
   if(screenshots.length<4&&(color.changedChannels||screenshots.length===0&&bankCount===8))screenshot(a.color,b.color,640,480,`${config.name}-${bankCount}-${mode}-${pointPass?'point':'sun'}`);
  }
  const ordered=JSON.stringify(expected)===JSON.stringify(referenceOrder)&&JSON.stringify(expected)===JSON.stringify(candidateOrder);
  const passed=ordered&&banks.every(n=>n>=1&&n<=8)&&reports.every(r=>r.color.changedChannels===0&&r.shadow.every(s=>s.changedChannels===0)&&(mode!=='rgba'||r.color.referenceAlphaZeroRGBPixels>0));
  return{config,requestedBankCount:bankCount,mode,expected,referenceObjects,candidateObjects,ordered,banks,referenceStats:oracle.stats(),candidateStats:candidate.stats(),reports,passed};
 }finally{target.dispose();oracle.dispose();candidate.dispose();}
}
window.cardBankProof=async()=>{
 const configs=[
  {name:'256-overlap',sizes:[256],drops:[0],overlap:true},
  {name:'352-overlap',sizes:[352],drops:[0],overlap:true},
  {name:'512-overlap',sizes:[512],drops:[0],overlap:true},
  {name:'704-overlap',sizes:[704],drops:[0],overlap:true},
  {name:'mixed-domains-grid',sizes:[256,352,512,704],drops:[0],overlap:false,rotation:.35,scale:.9},
  {name:'mixed-original-tails',sizes:[256,352,512,704],drops:[0,1,2],overlap:true,rotation:.19,scale:.8},
  {name:'tail-npot-grid',sizes:[352,704],drops:[1,2],overlap:false,rotation:.7,scale:1.65}
 ].slice(0,limit);
 const report={three:THREE.REVISION,anisotropy,settings:{bankCounts,modes,configs,maxBanks:8,shadowSize:2048,
  method:'Real production PaintedCardBatches cold/warm ordering, upload, full/native-tail pages and geometry. Single-bank chunks use a frozen original implicit texture() shader. Candidate uses actual 1..8-bank helper textureGrad() and production ordered chunks. Every RGBA color and actual directional/point shadow channel is compared at zero tolerance; alpha-zero RGB is not masked.',
  allocation:'Test-only real createPage(width,height,1) forces the desired bank count without hundreds of duplicate raster poses. Original literals, float32 cardRect, source painter, material color/alpha pipeline, implicit single-bank UV/LOD and no depth bias are preserved.'},rows:[],screenshots};
 for(const config of configs)for(const banks of bankCounts)for(const mode of modes){
  const row=await caseProof(config,banks,mode);report.rows.push(row);
  console.log(`CARD-BANK ${report.rows.length}/${configs.length*bankCounts.length*modes.length} ${config.name} banks=${banks} mode=${mode} passed=${row.passed}`);
 }
 report.glError=gl.getError();report.programs=renderer.info.programs?.map(p=>({runnable:p.diagnostics?.runnable??true}));
 report.passed=report.rows.every(r=>r.passed)&&report.glError===0&&report.programs.every(p=>p.runnable);
 sun.shadow.dispose();point.shadow.dispose();floor.geometry.dispose();floor.material.dispose();renderer.dispose();return report;
};
