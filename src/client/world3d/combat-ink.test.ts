import {describe,it,expect,vi} from 'vitest';
import {Scene,InstancedMesh,ShaderMaterial,Matrix4,OrthographicCamera,Vector3} from 'three';
import {CombatInk,COMBAT_INK_LIMIT} from './combat-ink';
import type {CombatPresentationFrame} from '../combat-presentation';
import {SHIP_CAMERA} from '../../shared/ship-geometry';
import {configureWorldCamera} from './projection';
const TILT=Math.tan(SHIP_CAMERA.tilt);
const frame=():CombatPresentationFrame=>({ground:[],body:[],droplets:[],speedLines:[]});
describe('depth-tested combat ink',()=>{
 it('grows for all 1440 settled marks without dropping contents and reuses the batch',()=>{
  const scene=new Scene(),ink=new CombatInk(scene),data=frame();
  for(let i=0;i<1440;i++)data.ground.push({x:i,y:100,height:40,radius:2,angle:0,alpha:.5});
  ink.update(data,new Map());const mesh=scene.children[0] as InstancedMesh,material=mesh.material as ShaderMaterial;
  expect(ink.stats()).toMatchObject({count:1440,deck:1440,overflow:0,limit:COMBAT_INK_LIMIT});expect(scene.children).toHaveLength(1);
  const matrix=new Matrix4();mesh.getMatrixAt(1439,matrix);expect(matrix.elements[12]).toBe(1439);expect(matrix.elements[13]).toBeCloseTo(40.12,4);
  expect(material).toMatchObject({transparent:true,depthTest:true,depthWrite:false});expect(mesh.castShadow).toBe(false);
  const hits:unknown[]=[];mesh.raycast({} as never,hits as never);expect(hits).toHaveLength(0);
  ink.update(data,new Map());expect(scene.children[0]).toBe(mesh);ink.clear();expect(mesh.count).toBe(0);expect(mesh.visible).toBe(false);
  ink.update(data,new Map());expect(mesh.visible).toBe(true);
  const geometryDispose=vi.spyOn(mesh.geometry,'dispose'),materialDispose=vi.spyOn(material,'dispose'),meshDispose=vi.spyOn(mesh,'dispose');
  ink.dispose();ink.dispose();ink.update(data,new Map());expect(scene.children).toHaveLength(0);expect(geometryDispose).toHaveBeenCalledOnce();expect(materialDispose).toHaveBeenCalledOnce();expect(meshDispose).toHaveBeenCalledOnce();expect(ink.stats()).toMatchObject({disposed:true,count:0,capacity:0});
 });
 it('keeps land residue in Canvas and anchors mirrored body blood to the actual projected crew feet',()=>{
  const scene=new Scene(),ink=new CombatInk(scene),data=frame();data.ground.push({x:20,y:20,height:0,radius:2,angle:0,alpha:1});
  data.body.push({unitId:'crew',x:900,y:900,height:25,localX:5,localY:-20,radius:2,angle:.2,alpha:1});
  ink.update(data,new Map([['crew',{x:100,y:200,floor:35,facing:-1}]]));expect(ink.stats()).toMatchObject({count:1,body:1,deck:0});
  const matrix=new Matrix4();(scene.children[0] as InstancedMesh).getMatrixAt(0,matrix);expect(matrix.elements[12]).toBe(95);expect(matrix.elements[13]).toBeGreaterThan(35);expect(matrix.elements[14]).toBeCloseTo(200,0);
  ink.update(data,new Map());expect(ink.stats().count).toBe(0);ink.dispose();
 });
 it('keeps droplets and all residue within an explicit diagnostic budget and honors reduced motion',()=>{
  const scene=new Scene(),ink=new CombatInk(scene),data=frame();
  for(let i=0;i<480;i++)data.droplets.push({x:i,y:20,height:20,vx:1,vy:2,vz:3,radius:2,alpha:.7});
  data.speedLines.push({unitId:'runner',x:90,y:80,height:20,dx:0,dy:1,length:30,width:1,alpha:.4});
  const anchors=new Map([['runner',{x:90,y:80,floor:0,facing:1 as const}]]);
  ink.update(data,anchors);expect(ink.stats()).toMatchObject({air:480,speed:1,overflow:0});ink.update(data,anchors,true);expect(ink.stats()).toMatchObject({air:480,speed:0});ink.dispose();
 });
 it('rejects offscreen ink before allocating or submitting the GPU batch, without changing presentation facts',()=>{
  const scene=new Scene(),ink=new CombatInk(scene),data=frame();
  data.ground.push({x:2000,y:2000,height:40,radius:6,angle:.5,alpha:1});
  data.droplets.push({x:-2000,y:2000,height:100,vx:10,vy:20,vz:3,radius:3,alpha:.8});
  const original=JSON.stringify(data);
  ink.update(data,new Map(),false,{x:0,y:0,width:320,height:240,zoom:1});
  expect(ink.stats()).toMatchObject({count:0,capacity:0,bufferBytes:0,drawCalls:0,culled:2,overflow:0});
  expect(scene.children).toHaveLength(0);expect(JSON.stringify(data)).toBe(original);
  // The opt-in viewport does not persist into calls using the original API.
  ink.update(data,new Map());expect(ink.stats()).toMatchObject({count:2,culled:0});ink.dispose();
 });
 it('retains high droplets, edge crossings and large rotated deck stains at a zoomed viewport',()=>{
  const scene=new Scene(),ink=new CombatInk(scene),data=frame(),view={x:100,y:200,width:200,height:120,zoom:2};
  const addDrop=(x:number,y:number,height=0)=>data.droplets.push({x,y,height,vx:0,vy:0,vz:0,radius:3,alpha:1});
  addDrop(150,230+400*TILT,400); // The ground position is far below the viewport, but the raised drop is visible.
  addDrop(202.5,225);addDrop(97.5,225);addDrop(150,197.5);addDrop(150,262.5);
  // Centers are outside. The complete rotated geometry still reaches the viewport.
  data.ground.push({x:350,y:230+40*TILT,height:40,radius:160,angle:0,alpha:1});
  data.ground.push({x:225,y:230+40*TILT,height:40,radius:60,angle:Math.PI/2,alpha:1});
  // A zero-height view of this drop would be visible; the actual height moves it above the viewport.
  addDrop(150,230,400);
  ink.update(data,new Map(),false,view);
  expect(ink.stats()).toMatchObject({count:7,air:5,deck:2,culled:1});ink.dispose();
 });
 it('keeps the boundary margin in screen pixels across zoom levels',()=>{
  for(const zoom of [.25,1,4]){
   const scene=new Scene(),ink=new CombatInk(scene),data=frame();
   // Both centers are past the right edge; one is within the 2-pixel margin.
   for(const pixels of [1.5,4])data.droplets.push({x:100+200/zoom+pixels/zoom,y:200+50/zoom,height:0,vx:0,vy:0,vz:0,radius:.01,alpha:1});
   ink.update(data,new Map(),false,{x:100,y:200,width:200,height:100,zoom});
   expect(ink.stats()).toMatchObject({count:1,air:1,culled:1});ink.dispose();
  }
 });
 it('leaves every submitted matrix, color and opacity unchanged for visible ink',()=>{
  const scene=new Scene(),boundedScene=new Scene(),ink=new CombatInk(scene),bounded=new CombatInk(boundedScene),data=frame();
  data.ground.push({x:120,y:180,height:35,radius:9,angle:.7,alpha:.5});
  data.body.push({unitId:'crew',x:120,y:180,height:35,localX:5,localY:-20,radius:3,width:7,angle:.2,alpha:.8});
  data.droplets.push({x:150,y:180,height:40,vx:50,vy:-20,vz:30,radius:3,alpha:.7});
  data.speedLines.push({unitId:'crew',x:120,y:180,height:15,dx:.6,dy:.8,length:30,width:1,alpha:.6});
  const anchors=new Map([['crew',{x:120,y:180,floor:35,facing:-1 as const}]]);
  ink.update(data,anchors);bounded.update(data,anchors,false,{x:0,y:0,width:320,height:240});
  const original=scene.children[0] as InstancedMesh,filtered=boundedScene.children[0] as InstancedMesh;
  expect(filtered.count).toBe(original.count);expect(bounded.stats().culled).toBe(0);
  expect(filtered.instanceMatrix.array.slice(0,original.count*16)).toEqual(original.instanceMatrix.array.slice(0,original.count*16));
  expect(filtered.instanceColor!.array.slice(0,original.count*3)).toEqual(original.instanceColor!.array.slice(0,original.count*3));
  expect(filtered.geometry.getAttribute('inkData').array.slice(0,original.count*2)).toEqual(original.geometry.getAttribute('inkData').array.slice(0,original.count*2));
  ink.dispose();bounded.dispose();
 });
 it('agrees with camera projection of the actual transformed geometry across height, rotation and zoom',()=>{
  const scene=new Scene(),boundedScene=new Scene(),ink=new CombatInk(scene),bounded=new CombatInk(boundedScene);
  const camera=new OrthographicCamera(),matrix=new Matrix4(),corner=new Vector3();
  for(const zoom of [.4,1,3]){
   const view={x:100,y:200,width:320,height:180,zoom};configureWorldCamera(camera,view);
   for(const flat of [true,false])for(const angle of [0,.7,Math.PI/2])for(const height of [0,40,300])for(const x of [80,150,460])for(const y of [180,250,500]){
    const data=frame();
    if(flat)data.ground.push({x,y,height:height||1,radius:45,angle,alpha:1});
    else data.droplets.push({x,y,height,vx:Math.cos(angle)*200,vy:Math.sin(angle)*200,vz:0,radius:30,alpha:1});
    ink.update(data,new Map());
    (scene.children[0] as InstancedMesh).getMatrixAt(0,matrix);
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const u of [-1,1])for(const v of [-1,1]){
     corner.set(u,v,0).applyMatrix4(matrix).project(camera);
     const sx=(corner.x+1)*view.width/2,sy=(1-corner.y)*view.height/2;
     left=Math.min(left,sx);right=Math.max(right,sx);top=Math.min(top,sy);bottom=Math.max(bottom,sy);
    }
    bounded.update(data,new Map(),false,view);
    const intersects=right>=-2&&left<=view.width+2&&bottom>=-2&&top<=view.height+2;
    expect(bounded.stats().count,JSON.stringify({zoom,flat,angle,height,x,y,left,right,top,bottom})).toBe(intersects?1:0);
   }
  }
  ink.dispose();bounded.dispose();
 });
});
