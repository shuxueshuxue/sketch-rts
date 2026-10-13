import {describe,expect,it} from 'vitest';
import {Camera,DirectionalLight,Euler,Matrix4,OrthographicCamera,PerspectiveCamera,Quaternion,Vector3} from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';
import {cardBaseMip,cardMipFootprint,type CardMipResidencyInput} from './card-mip-residency';
import {configureWorldCamera} from './projection';

const TILT=Math.tan(SHIP_CAMERA.tilt);
function input({zoom=.4,dpr=1,scale=1,width=1280,height=720,sourceSize=512,tileSize=128}={}):CardMipResidencyInput{
  const camera=new OrthographicCamera();configureWorldCamera(camera,{x:300,y:200,width,height,zoom});
  return{sourceSize,tileSize,foot:17,matrix:new Matrix4().compose(new Vector3(600,35,500),new Quaternion(),new Vector3(scale,scale,scale)),
    passes:[{camera,physicalWidth:width*dpr,physicalHeight:height*dpr}]};
}
function withSun(value:CardMipResidencyInput,width:number,height:number,zoom:number){
  const extent=Math.max(width,height)/zoom+400,sun=new DirectionalLight();
  sun.shadow.mapSize.set(2048,2048);sun.position.set(-450,650,250);sun.target.position.set(0,0,0);
  const camera=sun.shadow.camera;camera.left=camera.bottom=-extent/2;camera.right=camera.top=extent/2;camera.near=1;camera.far=3000;camera.updateProjectionMatrix();
  sun.updateWorldMatrix(true,false);sun.target.updateWorldMatrix(true,false);sun.shadow.updateMatrices(sun);
  return{...value,passes:[...value.passes,{camera,physicalWidth:2048,physicalHeight:2048}]};
}
function sampledStretch(value:CardMipResidencyInput,passIndex:number){
  const {camera,physicalWidth,physicalHeight}=value.passes[passIndex]!,half=value.tileSize/2;
  const low=Math.fround(Math.fround(-half/TILT)+value.foot/TILT),high=Math.fround(Math.fround(half/TILT)+value.foot/TILT);
  const screen=(x:number,y:number)=>{
    const p=new Vector3(x,y,0).applyMatrix4(value.matrix).project(camera);
    return{x:(p.x+1)*physicalWidth/2,y:(1-p.y)*physicalHeight/2};
  };
  // Independently project actual geometry corners. The maximum over unit UV
  // directions approaches the affine stretch without reusing the SVD formula.
  const origin=screen(Math.fround(-half),low),u=screen(Math.fround(half),low),v=screen(Math.fround(-half),high);
  let maximum=0;
  for(let step=0;step<4096;step++){
    const angle=step*Math.PI*2/4096,c=Math.cos(angle),s=Math.sin(angle);
    maximum=Math.max(maximum,Math.hypot((u.x-origin.x)*c+(v.x-origin.x)*s,(u.y-origin.y)*c+(v.y-origin.y)*s));
  }
  return maximum;
}

describe('original card mip residency candidate',()=>{
  it('matches physically projected geometry for rotation, reflection, shear and foot endpoints',()=>{
    for(const tileSize of [128,176])for(const foot of [-3,17,30]){
      const value=input({tileSize,sourceSize:tileSize*4,dpr:2});value.foot=foot;
      value.matrix.compose(new Vector3(1700,63,800),new Quaternion().setFromEuler(new Euler(.24,.15,.41)),new Vector3(-.8,1.3,.7));
      value.matrix.multiply(new Matrix4().set(1,.35,0,0,0,1,0,0,0,0,1,0,0,0,0,1));
      const actual=cardMipFootprint(value)!.maximumPixelsPerUV,sampled=sampledStretch(value,0);
      expect(actual).toBeGreaterThanOrEqual(sampled*(1-1e-10));expect(actual/sampled).toBeLessThan(1.00002);
      const moved={...value,matrix:value.matrix.clone().setPosition(-12000,830,17000)};
      expect(cardMipFootprint(moved)).toEqual(cardMipFootprint(value));
    }
  });
  it('keeps physical DPR, magnification and nonuniform scale in the gate',()=>{
    expect(cardBaseMip(input())).toBe(2);
    expect(cardBaseMip(input({dpr:2}))).toBe(1);
    expect(cardBaseMip(input({zoom:1.5}))).toBe(0);
    expect(cardBaseMip(input({zoom:1,dpr:2,scale:1.65}))).toBe(0);
    const stretched=input();stretched.matrix.makeScale(1,2,1);
    expect(cardBaseMip(stretched)).toBe(1);
    const mirror=input();mirror.matrix.makeScale(-1,1,1);
    expect(cardBaseMip(mirror)).toBe(cardBaseMip(input()));
  });
  it('includes the actual 2048 sun camera rather than approximating it from the world axes',()=>{
    const regular=withSun(input({zoom:.75,scale:.9}),1280,720,.75);
    const actual=cardMipFootprint(regular)!.maximumPixelsPerUV;
    const sampled=Math.max(sampledStretch(regular,0),sampledStretch(regular,1));
    expect(actual).toBeGreaterThanOrEqual(sampled*(1-1e-10));expect(actual/sampled).toBeLessThan(1.00002);
    expect(cardBaseMip(regular)).toBe(1);
    expect(cardBaseMip(withSun(input({zoom:.75,scale:.9,dpr:2}),1280,720,.75))).toBe(0);
    expect(cardBaseMip(withSun(input({zoom:.75,scale:1.65}),1280,720,.75))).toBe(0);
    expect(cardBaseMip(withSun(input({zoom:.75,scale:.9,width:320,height:180}),320,180,.75))).toBe(0);
  });
  it('keeps a complete level plus one percent above every candidate base',()=>{
    const value=input({zoom:.25}),rho=cardMipFootprint(value)!.minimumTexelsPerPixel,base=cardBaseMip(value);
    expect(base).toBe(2);expect(rho).toBeGreaterThanOrEqual(2**(base+1));
    // Without the additional derivative allowance, this ideal density would
    // lie at the drop-3 boundary. It must conservatively stay below that gate.
    expect(cardMipFootprint(value)!.minimumTexelsPerPixel).toBeLessThan(16);
    const slowerPass={...value.passes[0]!,physicalWidth:value.passes[0]!.physicalWidth*2,physicalHeight:value.passes[0]!.physicalHeight*2};
    expect(cardBaseMip({...value,passes:[...value.passes,slowerPass]})).toBe(1);
  });
  it('caps residency at four and preserves exact NPOT rebasing',()=>{
    for(const sourceSize of [256,352,512,704])expect(cardBaseMip(input({zoom:.001,sourceSize}))).toBe(4);
    expect(cardBaseMip(input({zoom:.001,sourceSize:300}))).toBe(2);
    expect(cardBaseMip(input({zoom:.001,sourceSize:702}))).toBe(1);
    expect(cardBaseMip(input({zoom:.001,sourceSize:703}))).toBe(0);
    expect(cardBaseMip(input({zoom:.001,sourceSize:8}))).toBe(3);
  });
  it('keeps the full chain for perspective, missing passes, singular or invalid input',()=>{
    const value=input();
    for(const camera of [new Camera(),new PerspectiveCamera()])expect(cardBaseMip({...value,passes:[{...value.passes[0]!,camera}]})).toBe(0);
    expect(cardBaseMip({...value,passes:[]})).toBe(0);
    expect(cardBaseMip({...value,passes:[...value.passes,{camera:new PerspectiveCamera(),physicalWidth:2048,physicalHeight:2048}]})).toBe(0);
    for(const matrix of [new Matrix4().makeScale(1,1,0),new Matrix4().makeScale(0,1,1)])expect(cardBaseMip({...value,matrix})).toBe(0);
    const perspectiveMatrix=new Matrix4();perspectiveMatrix.elements[3]=.01;
    expect(cardBaseMip({...value,matrix:perspectiveMatrix})).toBe(0);
    const invalidMatrix=new Matrix4();invalidMatrix.elements[0]=Infinity;
    expect(cardBaseMip({...value,matrix:invalidMatrix})).toBe(0);
    for(const bad of [NaN,Infinity,-1,0])expect(cardBaseMip({...value,sourceSize:bad})).toBe(0);
    expect(cardBaseMip({...value,foot:NaN})).toBe(0);
    expect(cardBaseMip({...value,foot:1e38})).toBe(0);
    expect(cardBaseMip({...value,passes:[{...value.passes[0]!,physicalWidth:0}]})).toBe(0);
    const degenerate=input();degenerate.matrix.makeRotationX(SHIP_CAMERA.tilt);
    // The card plane is parallel to the view direction, so its projected UV
    // Jacobian loses a dimension even though the world matrix is invertible.
    expect(cardBaseMip(degenerate)).toBe(0);
  });
});
