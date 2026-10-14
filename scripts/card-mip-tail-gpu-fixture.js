import * as THREE from 'three';
const sourceRoot=__CARD_STREAMING_SOURCE_ROOT__;
const {paintFigure}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/art/painted-units.ts`);
const {patchCardShader}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/painted-card-batches.ts`);
const {createCardArray,cardTextureBytes}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/card-mip-uploader.ts`);
const {configureWorldCamera}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/client/world3d/projection.ts`);
const {SHIP_CAMERA}=await import(/* @vite-ignore */ `/@fs${sourceRoot}/src/shared/ship-geometry.ts`);

// A disposable prototype. Source authoring, full native GPU mip generation,
// UVs, geometry, filters, anisotropy and all production shaders stay unchanged.
// Only the array's first resident mip changes, with exact public GPU copies.
const params=new URLSearchParams(location.search),drops=(params.get('drops')??'1,2,3,4').split(',').map(Number);
const limit=Number(params.get('cases')??12),TILT=Math.tan(SHIP_CAMERA.tilt),DEPTH=4;
const canvas=document.createElement('canvas');document.body.append(canvas);
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:true});
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.setClearColor('#ddddce',1);
const gl=renderer.getContext(),anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera();
const sun=new THREE.DirectionalLight('#f1dcc0',2.5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0004;sun.shadow.normalBias=.35;
scene.add(new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25),sun,sun.target);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(12000,12000),new THREE.MeshStandardMaterial({color:'#c4bea0',roughness:1}));
floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
const sourceSets=new Map(),screenshots=[];
function configure(texture){texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=anisotropy;texture.flipY=false;texture.premultiplyAlpha=false;texture.unpackAlignment=1;return texture;}
const mipSizes=n=>Array.from({length:Math.floor(Math.log2(n))+1},(_,level)=>({level,size:Math.max(1,Math.floor(n/2**level))}));
function sourceSet(tile,density){
 const key=`${tile}:${density}`;if(sourceSets.has(key))return sourceSets.get(key);
 const size=tile*density,bytes=size*size*4,data=new Uint8Array(bytes*DEPTH);
 const kinds=tile===128?['footman','priest','archer','rockGolem']:['footman','lancer','priest','redDragon'];
 for(let layer=0;layer<DEPTH;layer++){
  const paint=document.createElement('canvas');paint.width=paint.height=size;const ctx=paint.getContext('2d',{willReadFrequently:true});
  ctx.scale(density,density);ctx.translate(tile/2,tile/2);const facing=layer%2?-1:1;ctx.scale(facing,1);
  paintFigure(ctx,kinds[layer],['#9d532a','#345db6','#4c825d','#e3c183'][layer],tile===128?{mode:'idle',frame:layer}:{mode:layer===2?'cast':'attack',frame:2,aim:layer===1?-4:layer===3?4:0,variant:layer%3},facing);
  const rgba=ctx.getImageData(0,0,size,size).data;
  for(let y=0;y<size;y++)data.set(rgba.subarray(y*size*4,(y+1)*size*4),layer*bytes+(size-1-y)*size*4);
 }
 const full=configure(new THREE.DataArrayTexture(data,size,size,DEPTH));full.generateMipmaps=true;full.needsUpdate=true;renderer.initTexture(full);
 const tails=new Map(),region=new THREE.Box3(),destination=new THREE.Vector3();
 for(const drop of drops){
  if(size%2**drop)throw new Error(`Non-integral mip rebase ${size}/${2**drop}`);
  const tail=createCardArray(size/2**drop,size/2**drop,DEPTH,anisotropy);tail.needsUpdate=true;renderer.initTexture(tail);
  for(let layer=0;layer<DEPTH;layer++)for(const {level,size:mipSize} of mipSizes(tail.image.width)){
   region.min.set(0,0,layer);region.max.set(mipSize,mipSize,layer+1);destination.set(0,0,layer);
   renderer.copyTextureToTexture(full,tail,region,destination,level+drop,level);
  }
  tails.set(drop,tail);
 }
 const set={tile,density,size,kinds,full,tails};sourceSets.set(key,set);return set;
}
function material(texture,depth=false){
 const m=depth?new THREE.MeshDepthMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking})
  :new THREE.MeshBasicMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,toneMapped:false});
 m.onBeforeCompile=patchCardShader;m.customProgramCacheKey=()=>`tail-prototype:${depth}`;return m;
}
function makeCards(set){
 const geometry=new THREE.PlaneGeometry(1,1),half=set.tile/2,foot=17;
 const low=Math.fround(Math.fround(-half/TILT)+foot/TILT),high=Math.fround(Math.fround(half/TILT)+foot/TILT);
 geometry.setAttribute('cardRect',new THREE.InstancedBufferAttribute(new Float32Array(Array.from({length:DEPTH},()=>[-half,low,half,high]).flat()),4));
 geometry.setAttribute('cardLayer',new THREE.InstancedBufferAttribute(new Float32Array([0,1,2,3]),1));
 const mesh=new THREE.InstancedMesh(geometry,material(set.full),DEPTH);mesh.customDepthMaterial=material(set.full,true);mesh.castShadow=true;mesh.frustumCulled=false;scene.add(mesh);
 return{mesh,low,high,dispose(){scene.remove(mesh);mesh.dispose();geometry.dispose();mesh.material.dispose();mesh.customDepthMaterial.dispose();}};
}
function screenPoint(local,matrix,cam,width,height){const p=local.clone().applyMatrix4(matrix).project(cam);return new THREE.Vector2((p.x+1)*width/2,(1-p.y)*height/2);}
function footprint(matrix,cam,width,height,set,low,high){
 // UV -> physical-pixel derivatives per ORIGINAL source texel. Orthographic
 // projection makes this Jacobian constant over the entire primitive.
 const p=screenPoint(new THREE.Vector3(0,low,0),matrix,cam,width,height);
 const x=screenPoint(new THREE.Vector3(set.tile/set.size,low,0),matrix,cam,width,height).sub(p);
 const y=screenPoint(new THREE.Vector3(0,low+(high-low)/set.size,0),matrix,cam,width,height).sub(p);
 const a=x.lengthSq(),b=x.dot(y),c=y.lengthSq();
 const largestEigen=(a+c+Math.hypot(a-c,2*b))/2,maximumPixelsPerTexel=Math.sqrt(Math.max(0,largestEigen));
 return{jacobian:[x.x,y.x,x.y,y.y],maximumPixelsPerTexel,minimumTexelsPerPixel:1/maximumPixelsPerTexel,minimumLod:Math.log2(1/maximumPixelsPerTexel)};
}
function setup(config,set,cards){
 const width=config.width??1280,height=config.height??720,dpr=config.dpr??1,zoom=config.zoom;
 renderer.setPixelRatio(dpr);renderer.setSize(width,height,false);
 const view={width,height,zoom,x:-width/(2*zoom),y:-height/(2*zoom)};configureWorldCamera(camera,view);
 const extent=Math.max(width,height)/zoom+400;
 sun.position.set(-450,650,250);sun.target.position.set(0,0,0);sun.shadow.camera.left=sun.shadow.camera.bottom=-extent/2;
 sun.shadow.camera.right=sun.shadow.camera.top=extent/2;sun.shadow.camera.near=1;sun.shadow.camera.far=3000;sun.shadow.camera.updateProjectionMatrix();
 scene.updateMatrixWorld(true);sun.shadow.updateMatrices(sun,camera);
 const matrices=[],projections=[];
 const angles=config.rotations??[0,.25,.7,1.1];
 for(let layer=0;layer<DEPTH;layer++){
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angles[layer]);
  if(config.pitch)rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),config.pitch));
  const scale=(config.scale??.9)*(layer===3&&config.nonuniform?1.3:1),sx=layer%2?-scale:scale;
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3((layer%2-.5)*205,layer>=2?14:0,(Math.floor(layer/2)-.5)*180),rotation,new THREE.Vector3(sx,scale,config.nonuniform?scale*.8:scale));
  cards.mesh.setMatrixAt(layer,matrix);matrices.push(matrix);
  projections.push({layer,color:footprint(matrix,camera,width*dpr,height*dpr,set,cards.low,cards.high),shadow:footprint(matrix,sun.shadow.camera,2048,2048,set,cards.low,cards.high)});
 }
 cards.mesh.instanceMatrix.needsUpdate=true;
 return{width,height,dpr,extent,matrices,projections,minimumLod:Math.min(...projections.flatMap(p=>[p.color.minimumLod,p.shadow.minimumLod]))};
}
function derivativeProbe(cards,set,projection){
 if(!gl.getExtension('EXT_color_buffer_float'))return{available:false,passed:false,reason:'EXT_color_buffer_float unavailable'};
 const diagnostic=new THREE.Scene(),probeMaterial=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{sourceSize:{value:set.size}},vertexShader:`precision highp float;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;in vec3 position;in vec2 uv;in vec4 cardRect;in mat4 instanceMatrix;out vec2 sourceUV;
void main(){sourceUV=uv;vec3 p=vec3(mix(cardRect.xy,cardRect.zw,uv),position.z);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.0);}`,
  fragmentShader:`precision highp float;uniform float sourceSize;in vec2 sourceUV;out vec4 derivatives;void main(){derivatives=vec4(dFdx(sourceUV)*sourceSize,dFdy(sourceUV)*sourceSize);}`});
 const mesh=new THREE.InstancedMesh(cards.mesh.geometry,probeMaterial,1);mesh.frustumCulled=false;diagnostic.add(mesh);
 const target=new THREE.WebGLRenderTarget(1,1,{format:THREE.RGBAFormat,type:THREE.FloatType,depthBuffer:false,stencilBuffer:false}),rows=[];
 const oldClear=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha();renderer.setClearColor(0,0);
 try{
  for(let layer=0;layer<DEPTH;layer++)for(const [pass,cam,width,height] of [
   ['color',camera,projection.width*projection.dpr,projection.height*projection.dpr],['shadow',sun.shadow.camera,2048,2048]
  ]){
   cards.mesh.getMatrixAt(layer,mesh.matrix);mesh.setMatrixAt(0,mesh.matrix);mesh.matrix.identity();mesh.instanceMatrix.needsUpdate=true;
   const center=screenPoint(new THREE.Vector3(0,(cards.low+cards.high)/2,0),projection.matrices[layer],cam,width,height);
   // Keep the original full viewport scale and projection. A one-pixel float
   // framebuffer clips this viewport around an interior primitive pixel; its
   // dFdx/dFdy are the same source-UV derivatives as the corresponding pass.
   target.viewport.set(-Math.floor(center.x),-Math.floor(height-center.y),width,height);
   renderer.setRenderTarget(target);renderer.render(diagnostic,cam);
   const values=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,values);
   const x=new THREE.Vector2(values[0],values[1]),y=new THREE.Vector2(values[2],values[3]);
   const a=x.lengthSq(),b=x.dot(y),c=y.lengthSq(),minimumEigen=(a+c-Math.hypot(a-c,2*b))/2;
   const actual=Math.sqrt(Math.max(0,minimumEigen)),expected=projection.projections[layer][pass].minimumTexelsPerPixel;
   rows.push({layer,pass,originalTexelDerivatives:Array.from(values),gpuMinimumTexelsPerPixel:actual,cpuMinimumTexelsPerPixel:expected,
    relativeError:Math.abs(actual-expected)/expected,passed:Number.isFinite(actual)&&actual>0&&Math.abs(actual-expected)/expected<.002});
  }
 }finally{renderer.setRenderTarget(null);renderer.setClearColor(oldClear,oldAlpha);mesh.dispose();probeMaterial.dispose();target.dispose();}
 return{available:true,passed:rows.every(r=>r.passed),rows};
}
function draw(cards,texture,target){
 cards.mesh.material.map=texture;cards.mesh.customDepthMaterial.map=texture;
 renderer.setRenderTarget(target);renderer.render(scene,camera);
 const color=new Uint8Array(target.width*target.height*4);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,color);
 const shadow=new Uint8Array(2048*2048*4);renderer.readRenderTargetPixels(sun.shadow.map,0,0,2048,2048,shadow);
 renderer.setRenderTarget(null);return{color,shadow};
}
function compare(a,b){let maximum=0,changedChannels=0,changedPixels=0;const largest=[];
 for(let i=0;i<a.length;i+=4){let changed=false,pixelMaximum=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);maximum=Math.max(maximum,d);pixelMaximum=Math.max(pixelMaximum,d);if(d){changedChannels++;changed=true;}}
  if(changed){changedPixels++;if(largest.length<8)largest.push({pixel:i/4,maximum:pixelMaximum,reference:Array.from(a.subarray(i,i+4)),candidate:Array.from(b.subarray(i,i+4))});}}
 return{maximum,changedChannels,changedPixels,largest};
}
async function sha(bytes){const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function screenshot(a,b,width,height,name){
 const out=document.createElement('canvas');out.width=width*3;out.height=height;const ctx=out.getContext('2d');
 const heat=new Uint8Array(a.length);for(let i=0;i<a.length;i+=4){for(let c=0;c<3;c++)heat[i+c]=Math.min(255,Math.abs(a[i+c]-b[i+c])*8);heat[i+3]=255;}
 for(const [col,bytes] of [a,b,heat].entries()){
  const upright=new Uint8ClampedArray(bytes.length);for(let y=0;y<height;y++)upright.set(bytes.subarray(y*width*4,(y+1)*width*4),(height-y-1)*width*4);
  ctx.putImageData(new ImageData(upright,width,height),col*width,0);
 }
 screenshots.push({name,image:out.toDataURL('image/png')});
}
window.cardMipTailProof=async()=>{
 const configs=[
  {name:'small-lowzoom',zoom:.35,scale:.72},
  {name:'density2-boundary',zoom:.64,scale:.9},
  {name:'density4-boundary',zoom:.65,scale:.72},
  {name:'benchmark',zoom:.75,scale:.9},
  {name:'normal',zoom:1,scale:.9},
  {name:'large-unit',zoom:1,scale:1.65},
  {name:'dpr2-normal',zoom:1,scale:.9,dpr:2},
  {name:'dpr2-large',zoom:1,scale:1.65,dpr:2},
  {name:'menu-zoom',zoom:1.32,scale:.9,nonuniform:true},
  {name:'high-zoom',zoom:2,scale:1.65,pitch:.4},
  {name:'small-viewport',zoom:.75,scale:.9,width:640,height:480},
  {name:'wide-viewport',zoom:.75,scale:.72,width:1920,height:1080}
 ].slice(0,limit);
 const report={three:THREE.REVISION,anisotropy,settings:{drops,configs,shadowSize:2048,
  method:'Original full-domain DataArrayTexture native sRGB mip chain; exact public GPU copy of sourceLevel=drop+destinationLevel into smaller arrays. Same original UV, geometry, shader, alpha test, linear/trilinear filters, anisotropy, color pipeline and actual 2048 PCF sun shadow pass. Compare every color and packed-shadow RGBA channel with zero tolerance.',
  gate:'Minimum ORIGINAL source texels per physical pixel from the reciprocal maximum singular value of the affine ortho projection Jacobian, across every instance and color+shadow pass. Eligible only when minimumLod >= drop+1; this is a deliberately conservative candidate heuristic, not a portable proof of implementation-dependent anisotropic tap selection.'},rows:[],screenshots};
 for(const config of configs)for(const tile of [128,176]){
  const set=sourceSet(tile,config.zoom<.65?2:4),cards=makeCards(set),projection=setup(config,set,cards);
  const gpuDerivatives=derivativeProbe(cards,set,projection);delete projection.matrices;
  const target=new THREE.WebGLRenderTarget(projection.width*projection.dpr,projection.height*projection.dpr,{depthBuffer:true,stencilBuffer:false});
  try{
   const oracle=draw(cards,set.full,target),colorSha=await sha(oracle.color),shadowSha=await sha(oracle.shadow);
   for(const drop of drops){
    const image=draw(cards,set.tails.get(drop),target),color=compare(oracle.color,image.color),shadow=compare(oracle.shadow,image.shadow);
    const eligible=projection.minimumLod>=drop+1,identical=color.changedChannels===0&&shadow.changedChannels===0;
    const row={config,tile,size:set.size,drop,projection,gpuDerivatives,eligible,identical,color,shadow,
     referenceColorSha256:colorSha,candidateColorSha256:await sha(image.color),referenceShadowSha256:shadowSha,candidateShadowSha256:await sha(image.shadow),
     fullArrayBytes:cardTextureBytes(set.size,set.size,DEPTH),tailArrayBytes:cardTextureBytes(set.size/2**drop,set.size/2**drop,DEPTH)};
    report.rows.push(row);
    if(screenshots.length<4&&((eligible&&!identical)||(!eligible&&!identical&&drop===1)||screenshots.length===0&&eligible))screenshot(oracle.color,image.color,target.width,target.height,`${config.name}-${set.size}-drop${drop}`);
   }
  }finally{target.dispose();cards.dispose();}
 }
 report.glError=gl.getError();report.programs=renderer.info.programs?.map(program=>({runnable:program.diagnostics?.runnable??true}));
 report.eligibleRows=report.rows.filter(r=>r.eligible).length;report.eligibleMismatches=report.rows.filter(r=>r.eligible&&!r.identical).length;
 report.ineligibleMismatches=report.rows.filter(r=>!r.eligible&&!r.identical).length;
 report.fixedN1Mismatches=report.rows.filter(r=>r.drop===1&&!r.identical).length;
 report.derivativeProbePassed=report.rows.every(r=>r.gpuDerivatives.passed);
 report.passed=report.eligibleRows>0&&report.eligibleMismatches===0&&report.derivativeProbePassed&&report.glError===0&&report.programs.every(p=>p.runnable);
 for(const set of sourceSets.values()){set.full.dispose();for(const tail of set.tails.values())tail.dispose();}
 sun.shadow.dispose();floor.geometry.dispose();floor.material.dispose();renderer.dispose();return report;
};
