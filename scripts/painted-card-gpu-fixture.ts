/** Controlled GPU equivalence proof: identical authored pixels through the old
 * CanvasTexture path and the new array path, including both shadow materials. */
import * as THREE from 'three';
import {PaintedCardBatches} from '../src/client/world3d/painted-card-batches';
import {SHIP_CAMERA} from '../src/shared/ship-geometry';

// Reference sampler deliberately stays independent of production vertex code.
function patchCardShader(shader:{vertexShader:string;fragmentShader:string}){
 shader.vertexShader='attribute float cardLayer;\nvarying float vCardLayer;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCardLayer = cardLayer;');
 shader.fragmentShader='precision highp sampler2DArray;\nvarying float vCardLayer;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','uniform highp sampler2DArray map;').replace('#include <map_fragment>','diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');
}
export async function cardGpuProof(){
  const params=new URLSearchParams(location.search),reference=params.get('reference')??'canvas',filter=params.get('filter')??'mip',shadows=params.get('shadows')!=='off',anisotropy=Number(params.get('anisotropy')??8);
  const size=512,tilt=Math.tan(SHIP_CAMERA.tilt),canvas=document.createElement('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(size,size,false);renderer.setClearColor('#ddddce');renderer.shadowMap.enabled=shadows;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
  const target=new THREE.WebGLRenderTarget(size,size,{samples:4});renderer.setRenderTarget(target);
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-185/Number(params.get('zoom')??1),185/Number(params.get('zoom')??1),185/Number(params.get('zoom')??1),-185/Number(params.get('zoom')??1),1,1200);camera.position.set(230,330,470);camera.lookAt(0,30,0);camera.updateMatrixWorld(true);
  scene.add(new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25));
  const sun=new THREE.DirectionalLight('#f1dcc0',2.5);sun.position.set(-130,230,140);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=sun.shadow.camera.bottom=-230;sun.shadow.camera.right=sun.shadow.camera.top=230;sun.shadow.camera.far=900;sun.shadow.bias=-.0004;sun.shadow.normalBias=.35;scene.add(sun,sun.target);
  const point=new THREE.PointLight('#f1dcc0',60000);point.position.set(-120,210,130);point.castShadow=true;point.shadow.mapSize.set(512,512);point.shadow.bias=-.0004;point.shadow.normalBias=.35;point.visible=false;scene.add(point);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),new THREE.MeshStandardMaterial({color:'#c4bea0',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.visible=params.get('floor')!=='off';scene.add(floor);
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.15),scale=new THREE.Vector3(1,1,1);
  const domains=Array.from({length:4},(_,i)=>params.get('domains')==='mixed'?{tile:i%2?160:128,density:i<2?4:2,foot:[17,23,-3,30][i]!}:{tile:128,density:4,foot:17});
  const paints=Array.from({length:4},(_,i)=>(ctx:CanvasRenderingContext2D)=>{
    ctx.fillStyle=['#9d532a','#345db6','#4c825d','#e3c183'][i]!;ctx.beginPath();ctx.moveTo(-22,16);ctx.lineTo(-18,-42);ctx.lineTo(18,-35);ctx.lineTo(27,8);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#252c25';ctx.lineWidth=2.25;ctx.stroke();ctx.fillStyle='#eac093';ctx.beginPath();ctx.arc(5,-44,10,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(40,55,60,.43)';ctx.fillRect(-35,-25,62,5);ctx.fillStyle='#252c25';ctx.fillRect(-18,12,8,5);ctx.fillRect(14,9,8,8);
    // Diagnostic sentinel alpha forces identical full extent without becoming a
    // visible cutout. It is painted into both reference and candidate sources.
    if(domains[i]!.tile===160){ctx.fillStyle='#eac093';ctx.fillRect(67,-72,7,7);}
    if(params.get('extent')==='full'){const half=domains[i]!.tile/2,pixel=1/domains[i]!.density;ctx.fillStyle='rgba(0,0,0,.004)';for(const x of [-half,half-pixel])for(const y of [-half,half-pixel])ctx.fillRect(x,y,pixel,pixel);}
  });
  const matrices=paints.map((_,i)=>new THREE.Matrix4().compose(new THREE.Vector3((i%2-.5)*105,0,(Math.floor(i/2)-.5)*120),rotation,params.get('domains')==='mixed'&&i%2?new THREE.Vector3(-1,1,1):scale));
  function setFilter(texture:THREE.Texture){if(filter!=='mip'){texture.generateMipmaps=false;texture.minFilter=texture.magFilter=filter==='nearest'?THREE.NearestFilter:THREE.LinearFilter;texture.needsUpdate=true;}}
  const previous=paints.map((paint,i)=>{
    const {tile,density,foot}=domains[i]!,pixels=tile*density;
    const source=document.createElement('canvas');source.width=source.height=pixels;const ctx=source.getContext('2d',{willReadFrequently:true})!;ctx.scale(density,density);ctx.translate(tile/2,tile/2);paint(ctx);
    let texture:THREE.Texture=new THREE.CanvasTexture(source);
    if(reference!=='canvas'){const rgba=ctx.getImageData(0,0,pixels,pixels).data,data=new Uint8Array(rgba.length);for(let y=0;y<pixels;y++)data.set(rgba.subarray(y*pixels*4,(y+1)*pixels*4),(pixels-1-y)*pixels*4);texture=reference==='array'?new THREE.DataArrayTexture(data,pixels,pixels,1):new THREE.DataTexture(data,pixels,pixels);texture.generateMipmaps=true;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;}
    texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(anisotropy,renderer.capabilities.getMaxAnisotropy());
    const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(tile,tile/tilt).translate(0,foot/tilt,0),new THREE.MeshBasicMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,toneMapped:false}),1);if(reference==='array'){mesh.geometry.setAttribute('cardLayer',new THREE.InstancedBufferAttribute(new Float32Array([0]),1));mesh.material.onBeforeCompile=patchCardShader;const depth=new THREE.MeshDepthMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking}),distance=new THREE.MeshDistanceMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide});depth.onBeforeCompile=distance.onBeforeCompile=patchCardShader;mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;}mesh.userData.source=source;setFilter(texture);mesh.setMatrixAt(0,matrices[i]!);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;
  });
  const cards=new PaintedCardBatches(scene,Math.min(anisotropy,renderer.capabilities.getMaxAnisotropy()));
  function draw(){renderer.setRenderTarget(target);renderer.render(scene,camera);const pixels=new Uint8Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);return pixels;}
  const report=[],rasterComparison:{changedChannels:number;maximum:number;alphaChanged:number;alphaMaximum:number}[]=[];const comparisons=document.createElement('canvas');comparisons.width=size*3;comparisons.height=size*2;const out=comparisons.getContext('2d')!;
  for(let pass=0;pass<2;pass++){
    sun.visible=pass===0;point.visible=pass===1;
    for(const mesh of previous)mesh.visible=true;for(const mesh of cards.objects())mesh.visible=false;
    const before=draw();for(const mesh of previous)mesh.visible=false;const empty=draw();let referenceVisiblePixels=0;for(let p=0;p<before.length;p+=4)if(before[p]!==empty[p]||before[p+1]!==empty[p+1]||before[p+2]!==empty[p+2])referenceVisiblePixels++;
    cards.begin();paints.forEach((paint,i)=>cards.add(String(i),domains[i]!.density,paint,matrices[i]!,String(i),domains[i]!.foot,domains[i]!.tile));cards.finish();for(const mesh of cards.objects())setFilter(mesh.material.map!);
    if(pass===0){
      for(let i=0;i<previous.length;i++){
        const source=previous[i]!.userData.source as HTMLCanvasElement,sourceSize=source.width,rgba=source.getContext('2d')!.getImageData(0,0,sourceSize,sourceSize).data;
        const mesh=cards.objects().find(item=>item.userData.ids.includes(String(i)))!,index=mesh.userData.ids.indexOf(String(i));
        const texture=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture,{width,height,data}=texture.image;
        const layer=mesh.geometry.getAttribute('cardLayer').getX(index);
        let changedChannels=0,maximum=0,alphaChanged=0,alphaMaximum=0;
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const sx=x,sy=sourceSize-1-y;
          for(let channel=0;channel<4;channel++){
            const expected=sx>=0&&sx<sourceSize&&sy>=0&&sy<sourceSize?rgba[(sy*sourceSize+sx)*4+channel]!:0;
            const difference=Math.abs(expected-data![(layer*width*height+y*width+x)*4+channel]!);
            if(difference)changedChannels++;maximum=Math.max(maximum,difference);if(channel===3){if(difference)alphaChanged++;alphaMaximum=Math.max(alphaMaximum,difference);}
          }
        }
        rasterComparison.push({changedChannels,maximum,alphaChanged,alphaMaximum});
      }
    }
    const after=draw();let candidateVisiblePixels=0;for(let p=0;p<after.length;p+=4)if(after[p]!==empty[p]||after[p+1]!==empty[p+1]||after[p+2]!==empty[p+2])candidateVisiblePixels++;let maximum=0,sum=0,changedPixels=0;const largest:{x:number;y:number;difference:number;before:number[];after:number[]}[]=[];
    for(let i=0;i<before.length;i+=4){let changed=false;for(let c=0;c<4;c++){const diff=Math.abs(before[i+c]!-after[i+c]!);maximum=Math.max(maximum,diff);sum+=diff;changed ||= diff!==0;}if(changed){changedPixels++;const difference=Math.max(...Array.from(before.subarray(i,i+4),(value,c)=>Math.abs(value-after[i+c]!)));largest.push({x:(i/4)%size,y:size-1-Math.floor(i/4/size),difference,before:Array.from(before.subarray(i,i+4)),after:Array.from(after.subarray(i,i+4))});}}largest.sort((a,b)=>b.difference-a.difference);
    report.push({pass:pass===0?'directional-depth':'point-distance',referenceVisiblePixels,candidateVisiblePixels,maxChannelDifference:maximum,meanChannelDifference:sum/before.length,changedPixels,totalPixels:size*size,largest:largest.slice(0,12)});
    const heat=new Uint8Array(before.length);for(let p=0;p<before.length;p+=4){heat[p]=Math.min(255,Math.abs(before[p]!-after[p]!)*8);heat[p+1]=Math.min(255,Math.abs(before[p+1]!-after[p+1]!)*8);heat[p+2]=Math.min(255,Math.abs(before[p+2]!-after[p+2]!)*8);heat[p+3]=255;}
    for(const [column,pixels] of [before,after,heat].entries()){
      const upright=new Uint8ClampedArray(pixels.length);for(let y=0;y<size;y++)upright.set(pixels.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
      out.putImageData(new ImageData(upright,size,size),column*size,pass*size);
    }
  }
  const programs=(renderer.info.programs??[]).map(program=>({runnable:program.diagnostics?.runnable??true}));
  const glError=renderer.getContext().getError(),image=comparisons.toDataURL('image/png');
  cards.dispose();for(const mesh of previous){mesh.dispose();mesh.geometry.dispose();mesh.material.map!.dispose();mesh.material.dispose();mesh.customDepthMaterial?.dispose();mesh.customDistanceMaterial?.dispose();}floor.geometry.dispose();floor.material.dispose();sun.shadow.dispose();point.shadow.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();
  return{programs,settings:{reference,filter,shadows,anisotropy,domains,extent:'full-source',sentinel:params.get('extent')==='full',zoom:Number(params.get('zoom')??1)},renderInfo:renderer.info.render,report,rasterComparison,glError,image,method:'Full source RGBA comparison, same CPU scratch drawing, resolution, mipmaps, anisotropy, alpha cutout, original MeshBasic color pipeline, ACES scene and PCF directional/point shadows. Full source domains include all original mip levels, including NPOT320/640. Columns=full reference, full-source array, difference amplified 8x. Diagnostic settings are explicit; shadow-off still requires visible actors. Each draw rebinds the multisample target after readback. CPU/GPU scratch antialiasing differences are measured separately by art-raster-profile.'};
}
(window as unknown as {cardGpuProof:typeof cardGpuProof}).cardGpuProof=cardGpuProof;
