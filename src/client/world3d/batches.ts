import * as THREE from 'three';
export type BatchAnimation=ReadonlyMap<string,{matrix?:THREE.Matrix4;morph?:readonly number[]}>;
type Part={name:string;geometry:THREE.BufferGeometry;material:THREE.Material|THREE.Material[];local:THREE.Matrix4;morph:readonly number[]};
type Batch={parts:Part[];meshes:THREE.InstancedMesh[];matrices:THREE.Matrix4[];animations:(BatchAnimation|undefined)[];ids:string[];capacity:number;last:number};

/** Three's default instanced raycast does not read the per-instance morph texture.
 * This scratch mesh shares the model's buffers, but owns its animated bounds. */
class MorphInstancedMesh extends THREE.InstancedMesh {
  private pose:THREE.Mesh;
  private baseBounds:THREE.Box3;
  private deltas:THREE.Box3[];
  private localMatrix=new THREE.Matrix4();
  private localBox=new THREE.Box3();
  private sphere=new THREE.Sphere();
  private hits:THREE.Intersection[]=[];
  constructor(part:Part,capacity:number){
    super(part.geometry,part.material,capacity);
    const source=part.geometry,geometry=new THREE.BufferGeometry();
    // This view never goes to the renderer or disposes the shared attributes.
    geometry.index=source.index;geometry.attributes=source.attributes;geometry.morphAttributes=source.morphAttributes;
    geometry.morphTargetsRelative=source.morphTargetsRelative;geometry.groups=source.groups;geometry.drawRange=source.drawRange;
    geometry.boundingBox=new THREE.Box3();geometry.boundingSphere=new THREE.Sphere();
    this.pose=new THREE.Mesh(geometry,part.material);
    const vertex=new THREE.Vector3(),base=new THREE.Vector3(),position=source.getAttribute('position');
    this.baseBounds=new THREE.Box3();
    for(let i=0;i<position.count;i++)this.baseBounds.expandByPoint(vertex.fromBufferAttribute(position,i));
    this.deltas=(source.morphAttributes.position??[]).map(attribute=>{
      const bounds=new THREE.Box3();
      for(let i=0;i<attribute.count;i++){
        vertex.fromBufferAttribute(attribute,i);
        if(!source.morphTargetsRelative)vertex.sub(base.fromBufferAttribute(position,i));
        bounds.expandByPoint(vertex);
      }
      return bounds;
    });
    // setMorphAt allocates its texture using count, so allocate before finish()
    // reduces the visible count below capacity (later frames can grow again).
    this.setPoseAt(0,part.morph);
  }
  setPoseAt(index:number,weights:readonly number[]){
    const influences=this.pose.morphTargetInfluences!;
    for(let i=0;i<influences.length;i++)influences[i]=weights[i]??0;
    this.setMorphAt(index,this.pose);
  }
  private updatePoseBounds(){
    const bounds=this.pose.geometry.boundingBox!.copy(this.baseBounds),weights=this.pose.morphTargetInfluences!;
    // Weighted delta intervals also cover combined, negative and >1 morphs;
    // the source geometry's bounds may cover only the undeformed positions.
    for(let i=0;i<this.deltas.length;i++){
      const weight=weights[i]??0,delta=this.deltas[i]!;
      if(weight===0)continue;
      bounds.min.addScaledVector(weight>0?delta.min:delta.max,weight);
      bounds.max.addScaledVector(weight>0?delta.max:delta.min,weight);
    }
    bounds.getBoundingSphere(this.pose.geometry.boundingSphere!);
  }
  override computeBoundingBox(){this.computeBoundingSphere();}
  override computeBoundingSphere(){
    this.boundingSphere??=new THREE.Sphere();this.boundingSphere.makeEmpty();
    this.boundingBox??=new THREE.Box3();this.boundingBox.makeEmpty();
    for(let i=0;i<this.count;i++){
      this.getMorphAt(i,this.pose);this.updatePoseBounds();this.getMatrixAt(i,this.localMatrix);
      this.sphere.copy(this.pose.geometry.boundingSphere!).applyMatrix4(this.localMatrix);this.boundingSphere.union(this.sphere);
      this.localBox.copy(this.pose.geometry.boundingBox!).applyMatrix4(this.localMatrix);this.boundingBox.union(this.localBox);
    }
  }
  override raycast(raycaster:THREE.Raycaster,intersects:THREE.Intersection[]){
    if(!this.count)return;
    if(this.boundingSphere===null)this.computeBoundingSphere();
    this.sphere.copy(this.boundingSphere!).applyMatrix4(this.matrixWorld);
    if(!raycaster.ray.intersectsSphere(this.sphere))return;
    this.pose.material=this.material;
    for(let i=0;i<this.count;i++){
      this.getMatrixAt(i,this.localMatrix);this.pose.matrixWorld.multiplyMatrices(this.matrixWorld,this.localMatrix);
      this.getMorphAt(i,this.pose);this.updatePoseBounds();this.pose.raycast(raycaster,this.hits);
      for(const hit of this.hits){hit.instanceId=i;hit.object=this;intersects.push(hit);}
      this.hits.length=0;
    }
  }
}

/** Model components and painted troops share geometry/material draw calls.
 * No GPU object is created per soldier, and dead/offscreen batches are retired. */
export class ActorBatches {
  private batches=new Map<string,Batch>();
  private frame=0;
  private matrix=new THREE.Matrix4();
  constructor(private scene:THREE.Scene){}
  begin(){this.frame++;for(const batch of this.batches.values()){batch.matrices=[];batch.animations=[];batch.ids=[];}}
  add(key:string,template:THREE.Object3D,matrix:THREE.Matrix4,id:string,color?:string,constructing=false,revealDeck=false,animation?:BatchAnimation){
    let batch=this.batches.get(key);
    if(!batch){
      const parts:Part[]=[];template.updateMatrixWorld(true);
      template.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
        const map=(source:THREE.Material)=>{
          const material=source.clone();
          if(source.name==='TeamColor' && 'color' in material)(material as THREE.MeshStandardMaterial).color.set(color??'#88977c');
          if(constructing){material.transparent=true;material.opacity=.48;}
          // Cloth alone becomes translucent. The hull still occludes, collides
          // and casts shadows normally; selection never mutates shared assets.
          if(revealDeck && source.name.startsWith('unbleached sail')){material.transparent=true;material.opacity=.22;material.depthWrite=false;}
          return material;
        };
        const geometry:THREE.BufferGeometry=object.geometry,morphCount=Object.values(geometry.morphAttributes)[0]?.length??0;
        parts.push({name:object.name,geometry,material:Array.isArray(object.material)?object.material.map(map):map(object.material),local:object.matrixWorld.clone(),morph:Array.from({length:morphCount},(_,i)=>object.morphTargetInfluences?.[i]??0)});
      });
      batch={parts,meshes:[],matrices:[],animations:[],ids:[],capacity:0,last:this.frame};this.batches.set(key,batch);
    }
    batch.matrices.push(matrix);batch.animations.push(animation);batch.ids.push(id);batch.last=this.frame;
  }
  finish(){
    for(const [key,batch] of this.batches){
      if(batch.matrices.length>batch.capacity){
        for(const mesh of batch.meshes){this.scene.remove(mesh);mesh.dispose();}
        batch.capacity=2**Math.ceil(Math.log2(Math.max(1,batch.matrices.length)));
        batch.meshes=batch.parts.map(part=>{const mesh=part.morph.length?new MorphInstancedMesh(part,batch.capacity):new THREE.InstancedMesh(part.geometry,part.material,batch.capacity);mesh.name=part.name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.userData.ids=batch.ids;this.scene.add(mesh);return mesh;});
      }
      for(let p=0;p<batch.meshes.length;p++){
        const mesh=batch.meshes[p]!,part=batch.parts[p]!;mesh.count=batch.matrices.length;mesh.visible=mesh.count>0;mesh.userData.ids=batch.ids;
        for(let i=0;i<mesh.count;i++){
          const animation=batch.animations[i]?.get(part.name);
          mesh.setMatrixAt(i,this.matrix.copy(batch.matrices[i]!).multiply(animation?.matrix??part.local));
          if(mesh instanceof MorphInstancedMesh)mesh.setPoseAt(i,animation?.morph??part.morph);
        }
        mesh.instanceMatrix.needsUpdate=true;if(mesh.morphTexture)mesh.morphTexture.needsUpdate=true;if(mesh.count)mesh.computeBoundingSphere();
      }
      if(this.frame-batch.last>120)this.remove(key,batch);
    }
  }
  objects(){return [...this.batches.values()].flatMap(batch=>batch.meshes).filter(mesh=>mesh.visible);}
  forget(key:string){const batch=this.batches.get(key);if(batch)this.remove(key,batch);}
  remove(key:string,batch:Batch){for(const mesh of batch.meshes){this.scene.remove(mesh);mesh.dispose();}for(const part of batch.parts)for(const mat of Array.isArray(part.material)?part.material:[part.material])mat.dispose();this.batches.delete(key);}
  dispose(){for(const [key,batch] of this.batches)this.remove(key,batch);}
}
