import * as THREE from 'three';
type Part={geometry:THREE.BufferGeometry;material:THREE.Material|THREE.Material[];local:THREE.Matrix4};
type Batch={parts:Part[];meshes:THREE.InstancedMesh[];matrices:THREE.Matrix4[];ids:string[];capacity:number;last:number};

/** Static model components and painted troops share geometry/material draw calls.
 * No GPU object is created per soldier, and dead/offscreen batches are retired. */
export class ActorBatches {
  private batches=new Map<string,Batch>();
  private frame=0;
  constructor(private scene:THREE.Scene){}
  begin(){this.frame++;for(const batch of this.batches.values()){batch.matrices=[];batch.ids=[];}}
  add(key:string,template:THREE.Object3D,matrix:THREE.Matrix4,id:string,color?:string,constructing=false){
    let batch=this.batches.get(key);
    if(!batch){
      const parts:Part[]=[];template.updateMatrixWorld(true);
      template.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
        const map=(source:THREE.Material)=>{const material=source.clone();if(source.name==='TeamColor' && 'color' in material)(material as THREE.MeshStandardMaterial).color.set(color??'#88977c');if(constructing){material.transparent=true;material.opacity=.48;}return material;};
        parts.push({geometry:object.geometry,material:Array.isArray(object.material)?object.material.map(map):map(object.material),local:object.matrixWorld.clone()});
      });
      batch={parts,meshes:[],matrices:[],ids:[],capacity:0,last:this.frame};this.batches.set(key,batch);
    }
    batch.matrices.push(matrix);batch.ids.push(id);batch.last=this.frame;
  }
  finish(){
    for(const [key,batch] of this.batches){
      if(batch.matrices.length>batch.capacity){
        for(const mesh of batch.meshes){this.scene.remove(mesh);mesh.dispose();}
        batch.capacity=2**Math.ceil(Math.log2(Math.max(1,batch.matrices.length)));
        batch.meshes=batch.parts.map(part=>{const mesh=new THREE.InstancedMesh(part.geometry,part.material,batch.capacity);mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.userData.ids=batch.ids;this.scene.add(mesh);return mesh;});
      }
      for(let p=0;p<batch.meshes.length;p++){
        const mesh=batch.meshes[p]!,part=batch.parts[p]!;mesh.count=batch.matrices.length;mesh.visible=mesh.count>0;mesh.userData.ids=batch.ids;
        for(let i=0;i<mesh.count;i++)mesh.setMatrixAt(i,batch.matrices[i]!.clone().multiply(part.local));
        mesh.instanceMatrix.needsUpdate=true;if(mesh.count)mesh.computeBoundingSphere();
      }
      if(this.frame-batch.last>120)this.remove(key,batch);
    }
  }
  objects(){return [...this.batches.values()].flatMap(batch=>batch.meshes).filter(mesh=>mesh.visible);}
  forget(key:string){const batch=this.batches.get(key);if(batch)this.remove(key,batch);}
  remove(key:string,batch:Batch){for(const mesh of batch.meshes){this.scene.remove(mesh);mesh.dispose();}for(const part of batch.parts)for(const mat of Array.isArray(part.material)?part.material:[part.material])mat.dispose();this.batches.delete(key);}
  dispose(){for(const [key,batch] of this.batches)this.remove(key,batch);}
}
