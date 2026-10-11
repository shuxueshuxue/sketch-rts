/** Controlled GPU equivalence proof: identical authored pixels through the old
 * CanvasTexture path and the new array path, including both shadow materials. */
import * as THREE from 'three';
import {PaintedCardBatches} from '../src/client/world3d/painted-card-batches';
import {SHIP_CAMERA} from '../src/shared/ship-geometry';

export async function cardGpuProof(){
  const size=512,tilt=Math.tan(SHIP_CAMERA.tilt),canvas=document.createElement('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(size,size,false);renderer.setClearColor('#ddddce');renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;
  const target=new THREE.WebGLRenderTarget(size,size,{samples:4});renderer.setRenderTarget(target);
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-185,185,185,-185,1,1200);camera.position.set(230,330,470);camera.lookAt(0,30,0);camera.updateMatrixWorld(true);
  scene.add(new THREE.HemisphereLight('#ddd7c5','#263c3a',1.25));
  const sun=new THREE.DirectionalLight('#f1dcc0',2.5);sun.position.set(-130,230,140);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=sun.shadow.camera.bottom=-230;sun.shadow.camera.right=sun.shadow.camera.top=230;sun.shadow.camera.far=900;sun.shadow.bias=-.0004;sun.shadow.normalBias=.35;scene.add(sun,sun.target);
  const point=new THREE.PointLight('#f1dcc0',60000);point.position.set(-120,210,130);point.castShadow=true;point.shadow.mapSize.set(512,512);point.shadow.bias=-.0004;point.shadow.normalBias=.35;point.visible=false;scene.add(point);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),new THREE.MeshStandardMaterial({color:'#c4bea0',roughness:1}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.15),scale=new THREE.Vector3(1,1,1);
  const paints=Array.from({length:4},(_,i)=>(ctx:CanvasRenderingContext2D)=>{
    ctx.fillStyle=['#9d532a','#345db6','#4c825d','#e3c183'][i]!;ctx.beginPath();ctx.moveTo(-22,16);ctx.lineTo(-18,-42);ctx.lineTo(18,-35);ctx.lineTo(27,8);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#252c25';ctx.lineWidth=2.25;ctx.stroke();ctx.fillStyle='#eac093';ctx.beginPath();ctx.arc(5,-44,10,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(40,55,60,.43)';ctx.fillRect(-35,-25,62,5);ctx.fillStyle='#252c25';ctx.fillRect(-18,12,8,5);ctx.fillRect(14,9,8,8);
  });
  const matrices=paints.map((_,i)=>new THREE.Matrix4().compose(new THREE.Vector3((i%2-.5)*105,0,(Math.floor(i/2)-.5)*120),rotation,scale));
  const previous=paints.map((paint,i)=>{
    const source=document.createElement('canvas');source.width=source.height=512;const ctx=source.getContext('2d',{willReadFrequently:true})!;ctx.scale(4,4);ctx.translate(64,64);paint(ctx);
    const texture=new THREE.CanvasTexture(source);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(128,128/tilt).translate(0,17/tilt,0),new THREE.MeshBasicMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,toneMapped:false}),1);mesh.setMatrixAt(0,matrices[i]!);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;
  });
  const cards=new PaintedCardBatches(scene,Math.min(8,renderer.capabilities.getMaxAnisotropy()));
  function draw(){renderer.render(scene,camera);const pixels=new Uint8Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);return pixels;}
  const report=[],rasterComparison:{changedChannels:number;maximum:number;alphaChanged:number;alphaMaximum:number}[]=[];const comparisons=document.createElement('canvas');comparisons.width=size*2;comparisons.height=size*2;const out=comparisons.getContext('2d')!;
  for(let pass=0;pass<2;pass++){
    sun.visible=pass===0;point.visible=pass===1;
    for(const mesh of previous)mesh.visible=true;for(const mesh of cards.objects())mesh.visible=false;
    const before=draw();for(const mesh of previous)mesh.visible=false;
    cards.begin();paints.forEach((paint,i)=>cards.add(String(i),4,paint,matrices[i]!,String(i),17));cards.finish();
    if(pass===0){
      for(let i=0;i<previous.length;i++){
        const source=previous[i]!.material.map!.image as HTMLCanvasElement,rgba=source.getContext('2d')!.getImageData(0,0,512,512).data;
        const mesh=cards.objects().find(item=>item.userData.ids.includes(String(i)))!,index=mesh.userData.ids.indexOf(String(i));
        const texture=(mesh.material as THREE.MeshBasicMaterial).map as THREE.DataArrayTexture,{width,height,data}=texture.image;
        const layer=mesh.geometry.getAttribute('cardLayer').getX(index),transform=new THREE.Matrix4();mesh.getMatrixAt(index,transform);
        transform.premultiply(matrices[i]!.clone().invert());const at=new THREE.Vector3();
        let changedChannels=0,maximum=0,alphaChanged=0,alphaMaximum=0;
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          at.set((x+.5)/width-.5,(y+.5)/height-.5,0).applyMatrix4(transform);
          const sx=Math.floor((at.x+64)*4),sy=Math.floor((64+17-at.y*tilt)*4);
          for(let channel=0;channel<4;channel++){
            const expected=sx>=0&&sx<512&&sy>=0&&sy<512?rgba[(sy*512+sx)*4+channel]!:0;
            const difference=Math.abs(expected-data![(layer*width*height+y*width+x)*4+channel]!);
            if(difference)changedChannels++;maximum=Math.max(maximum,difference);if(channel===3){if(difference)alphaChanged++;alphaMaximum=Math.max(alphaMaximum,difference);}
          }
        }
        rasterComparison.push({changedChannels,maximum,alphaChanged,alphaMaximum});
      }
    }
    const after=draw();let maximum=0,sum=0,changedPixels=0;
    for(let i=0;i<before.length;i+=4){let changed=false;for(let c=0;c<4;c++){const diff=Math.abs(before[i+c]!-after[i+c]!);maximum=Math.max(maximum,diff);sum+=diff;changed ||= diff!==0;}if(changed)changedPixels++;}
    report.push({pass:pass===0?'directional-depth':'point-distance',maxChannelDifference:maximum,meanChannelDifference:sum/before.length,changedPixels,totalPixels:size*size});
    for(const [column,pixels] of [before,after].entries()){
      const upright=new Uint8ClampedArray(pixels.length);for(let y=0;y<size;y++)upright.set(pixels.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
      out.putImageData(new ImageData(upright,size,size),column*size,pass*size);
    }
  }
  const glError=renderer.getContext().getError(),image=comparisons.toDataURL('image/png');
  cards.dispose();for(const mesh of previous){mesh.dispose();mesh.geometry.dispose();mesh.material.map!.dispose();mesh.material.dispose();}floor.geometry.dispose();floor.material.dispose();sun.shadow.dispose();point.shadow.dispose();target.dispose();renderer.dispose();renderer.forceContextLoss();
  return{report,rasterComparison,glError,image,method:'512px source RGBA comparison, same CPU scratch drawing, resolution, mipmaps, anisotropy, alpha cutout, original MeshBasic color pipeline, ACES scene and PCF directional/point shadows. Cropped layers reconstructed through their actual instance transforms. Left=individual full textures; right=cropped array instances. CPU/GPU scratch antialiasing differences are measured separately by art-raster-profile.'};
}
(window as unknown as {cardGpuProof:typeof cardGpuProof}).cardGpuProof=cardGpuProof;
