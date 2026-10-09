import * as THREE from 'three';

const VERTEX=`
attribute vec4 markerData;
attribute float strokeDistance;
varying vec4 markerShape;
varying vec2 markerLocal;
varying float markerStroke;
varying vec3 markerInk;
void main() {
  markerShape=markerData;
  markerLocal=position.xz*(markerData.xy+vec2(2.0));
  markerStroke=strokeDistance;
  markerInk=instanceColor;
  gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);
}`;
const FRAGMENT=`
varying vec4 markerShape;
varying vec2 markerLocal;
varying float markerStroke;
varying vec3 markerInk;
void main() {
  float d;
  if(markerShape.w<0.5) d=(length(markerLocal/markerShape.xy)-1.0)*min(markerShape.x,markerShape.y);
  else if(markerShape.w<1.5) d=max(abs(markerLocal.x)-markerShape.x,abs(markerLocal.y)-markerShape.y);
  else d=markerStroke;
  float aa=max(0.15,fwidth(d));
  float alpha=1.0-smoothstep(markerShape.z*0.5-aa,markerShape.z*0.5+aa,abs(d));
  if(alpha<0.01)discard;
  gl_FragColor=vec4(markerInk,alpha*0.92);
  #include <colorspace_fragment>
}`;
type Batch={template:THREE.BufferGeometry;mesh:THREE.InstancedMesh;data:THREE.InstancedBufferAttribute;capacity:number;count:number;last:number};
type Point={x:number;y:number};

/** Decorations are real flat surfaces, so actors occlude them through the
 * normal depth buffer. They share one material and grow instance buffers only
 * when capacity increases. They never join the entity raycast or shadow pass. */
export class SelectionMarkers {
  private material=new THREE.ShaderMaterial({vertexShader:VERTEX,fragmentShader:FRAGMENT,
    transparent:true,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
  private quad=new THREE.PlaneGeometry(2,2).rotateX(-Math.PI/2);
  private hulls=new Map<string,THREE.BufferGeometry>();
  private batches=new Map<string,Batch>();
  private matrix=new THREE.Matrix4();
  private scale=new THREE.Vector3();
  private ink=new THREE.Color();
  private frame=0;
  private disposed=false;
  constructor(private scene:THREE.Scene) {
    this.quad.setAttribute('strokeDistance',new THREE.Float32BufferAttribute(new Float32Array(4),1));
  }
  begin(){if(this.disposed)return;this.frame++;for(const batch of this.batches.values())batch.count=0;}
  ellipse(matrix:THREE.Matrix4,rx:number,rz:number,color:string,selected:boolean){
    if(this.disposed || rx<=0 || rz<=0)return;
    this.matrix.copy(matrix).scale(this.scale.set(rx+2,1,rz+2));
    this.add('surface',this.quad,this.matrix,rx,rz,selected?3:2,0,color);
  }
  rectangle(matrix:THREE.Matrix4,halfWidth:number,halfDepth:number,color:string,selected:boolean){
    if(this.disposed || halfWidth<=0 || halfDepth<=0)return;
    this.matrix.copy(matrix).scale(this.scale.set(halfWidth+2,1,halfDepth+2));
    this.add('surface',this.quad,this.matrix,halfWidth,halfDepth,selected?2.5:1.5,1,color);
  }
  hull(key:string,points:readonly Point[],scale:number,matrix:THREE.Matrix4,color:string,selected:boolean){
    if(this.disposed || points.length<3 || !(scale>0))return;
    let geometry=this.hulls.get(key);
    if(!geometry){
      // Profiles already include size. The reusable hull is normalized once;
      // its instance transform applies the displayed ship scale exactly once.
      const vertices:number[]=[],distance:number[]=[],indices:number[]=[];
      for(let i=0;i<points.length;i++) {
        const a=points[i]!,b=points[(i+1)%points.length]!,dx=b.x-a.x,dz=b.y-a.y,length=Math.hypot(dx,dz);
        if(length===0)continue;
        const nx=-dz/length*3,nz=dx/length*3,start=vertices.length/3;
        for(const [point,side] of [[a,-1],[a,1],[b,-1],[b,1]] as const){vertices.push(point.x/scale+nx*side,0,point.y/scale+nz*side);distance.push(side*3);}
        indices.push(start,start+1,start+2,start+2,start+1,start+3);
      }
      geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
      geometry.setAttribute('strokeDistance',new THREE.Float32BufferAttribute(distance,1));geometry.setIndex(indices);
      this.hulls.set(key,geometry);
    }
    this.add(`hull:${key}`,geometry,matrix,0,0,(selected?3:2)/scale,2,color);
  }
  private add(key:string,template:THREE.BufferGeometry,matrix:THREE.Matrix4,rx:number,rz:number,width:number,shape:number,color:string) {
    let batch=this.batches.get(key);
    const needed=(batch?.count??0)+1;
    if(!batch || needed>batch.capacity) {
      const capacity=2**Math.ceil(Math.log2(needed)),geometry=template.clone();
      const data=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('markerData',data);
      const mesh=new THREE.InstancedMesh(geometry,this.material,capacity);
      mesh.name=key==='surface'?'SelectionSurface':'SelectionHull';mesh.frustumCulled=false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.renderOrder=-1;mesh.raycast=()=>{};
      mesh.castShadow=mesh.receiveShadow=false;
      if(batch) {
        // Preserve entries already added this frame when a selection grows.
        mesh.instanceMatrix.array.set(batch.mesh.instanceMatrix.array.subarray(0,batch.count*16));
        if(batch.mesh.instanceColor){mesh.setColorAt(0,this.ink);mesh.instanceColor!.array.set(batch.mesh.instanceColor.array.subarray(0,batch.count*3));}
        data.array.set(batch.data.array.subarray(0,batch.count*4));
        this.release(batch);
      }
      batch={template,mesh,data,capacity,count:needed-1,last:this.frame};this.batches.set(key,batch);this.scene.add(mesh);
    }
    const at=batch.count++;batch.last=this.frame;
    batch.mesh.setMatrixAt(at,matrix);batch.mesh.setColorAt(at,this.ink.set(color));batch.data.setXYZW(at,rx,rz,width,shape);
  }
  finish(){
    if(this.disposed)return;
    for(const [key,batch] of this.batches) {
      batch.mesh.count=batch.count;batch.mesh.visible=batch.count>0;
      if(batch.count){batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.instanceColor!.needsUpdate=true;batch.data.needsUpdate=true;}
      else if(this.frame-batch.last>120){this.release(batch);this.batches.delete(key);}
    }
  }
  clear(){for(const batch of this.batches.values()){batch.count=0;batch.mesh.count=0;batch.mesh.visible=false;}}
  private release(batch:Batch){batch.mesh.removeFromParent();batch.mesh.dispose();batch.mesh.geometry.dispose();}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    for(const batch of this.batches.values())this.release(batch);this.batches.clear();
    for(const geometry of this.hulls.values())geometry.dispose();this.hulls.clear();this.quad.dispose();this.material.dispose();
  }
}
