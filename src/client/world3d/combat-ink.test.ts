import {describe,it,expect,vi} from 'vitest';
import {Scene,InstancedMesh,ShaderMaterial,Matrix4} from 'three';
import {CombatInk,COMBAT_INK_LIMIT} from './combat-ink';
import type {CombatPresentationFrame} from '../combat-presentation';
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
});
