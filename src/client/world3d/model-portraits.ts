import * as THREE from 'three';
import {worldModels} from './model-library';
import {installModelPortraits} from '../model-portraits';
import {createScratchCanvas} from '../art/scratch-canvas';
import {defaultRigPortrait} from './sail-rig';
type Face={points:number[];depth:number;ink:string;team:boolean;light:number};
let geometry=new WeakMap<THREE.Object3D,{id:number;faces:Face[]}>(),serial=0;
const images=new Map<string,HTMLCanvasElement>();
const sun=new THREE.Vector3(-.6,1,.6).normalize();

/** Small, cached UI projections of the loaded GLB. This needs neither another
 * WebGL context nor a GPU readback and remains usable after context loss. */
export function currentModelPortrait(key:string,color:string){
  const model=worldModels.portraitModel(key);if(!model)return undefined;
  let projectedModel=geometry.get(model);
  if(!projectedModel){
    const portrait=defaultRigPortrait(model);
    try{
    const portraitModel=portrait.model;
    portraitModel.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(portraitModel),center=bounds.getCenter(new THREE.Vector3());
    const camera=new THREE.OrthographicCamera();camera.position.copy(center).add(new THREE.Vector3(400,420,650));camera.lookAt(center);camera.updateMatrixWorld(true);
    const faces:Face[]=[];let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    portraitModel.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
      const mesh=object,position=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
      const count=index?.count??position.count,materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      const projected=new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,mesh.matrixWorld);
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for(let i=0;i<count;i+=3){
        const points=[0,1,2].map(n=>mesh.getVertexPosition(index?index.getX(i+n):i+n,new THREE.Vector3()));
        const normal=new THREE.Vector3().subVectors(points[1]!,points[0]!).cross(new THREE.Vector3().subVectors(points[2]!,points[0]!)).applyNormalMatrix(normalMatrix).normalize();
        const screen=points.map(point=>point.applyMatrix4(projected));
        const group=mesh.geometry.groups.find((group:{start:number;count:number;materialIndex?:number})=>i>=group.start && i<group.start+group.count);
        const material=materials[group?.materialIndex??0] as THREE.MeshStandardMaterial;
        const xy=screen.flatMap(point=>{left=Math.min(left,point.x);right=Math.max(right,point.x);top=Math.min(top,-point.y);bottom=Math.max(bottom,-point.y);return[point.x,-point.y];});
        const light=.64+.5*Math.max(0,normal.dot(sun));
        faces.push({points:xy,depth:screen.reduce((sum,point)=>sum+point.z,0)/3,ink:`#${material.color.clone().multiplyScalar(light).getHexString(THREE.SRGBColorSpace)}`,team:material.name==='TeamColor',light});
      }
    });
    const scale=240/Math.max(right-left,bottom-top),cx=(left+right)/2,cy=(top+bottom)/2;
    for(const face of faces)face.points=face.points.map((value,i)=>128+(value-(i%2?cy:cx))*scale);
    faces.sort((a,b)=>a.depth-b.depth);projectedModel={id:serial++,faces};geometry.set(model,projectedModel);
    }finally{portrait.dispose();}
  }
  // Projection data follows the decoded object, so an explicit model reload
  // cannot reuse old geometry and releasing models also releases their faces.
  const id=`${projectedModel.id}:${color}`,cached=images.get(id);if(cached)return cached;
  const canvas=createScratchCanvas(256,256),ctx=canvas.getContext('2d')!;
  const team=new THREE.Color(color),teamInks=new Map<number,string>();
  for(const face of projectedModel.faces){const p=face.points;let ink=face.ink;
    if(face.team){ink=teamInks.get(face.light)??`#${team.clone().multiplyScalar(face.light).getHexString(THREE.SRGBColorSpace)}`;teamInks.set(face.light,ink);}
    ctx.fillStyle=ink;ctx.beginPath();ctx.moveTo(p[0]!,p[1]!);ctx.lineTo(p[2]!,p[3]!);ctx.lineTo(p[4]!,p[5]!);ctx.closePath();ctx.fill();
  }
  if(images.size>=64)images.delete(images.keys().next().value!);images.set(id,canvas);return canvas;
}
export function activateModelPortraits(){installModelPortraits(currentModelPortrait);}
export function clearModelPortraits(){geometry=new WeakMap();images.clear();installModelPortraits(undefined);}
