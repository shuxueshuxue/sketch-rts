import * as THREE from 'three';

// @@@model-ink - Buildings drawn in the inked atlas's hand (docs/art-direction.zh.md: 线, 光, 色): an ink line round
// every solid part, a fixed number of screen pixels wide whatever the zoom; three flat tones of light instead of smooth
// shading; slate roofs warmed and half taken over by the owner's colour, so whose building it is reads from its roof,
// not from a small flag. The line is the part's own mesh drawn again, back faces only, pushed out along smoothed normals.
const INK_PX=1.5;
const inkWidth={value:INK_PX};
/** The ink line's width in world units for this frame: a constant on screen. */
export function setInkZoom(zoom:number){inkWidth.value=INK_PX/zoom;}
const INK_HULL=new THREE.MeshBasicMaterial({color:'#293c35',side:THREE.BackSide,toneMapped:false});
INK_HULL.onBeforeCompile=shader=>{
  shader.uniforms.inkWidth=inkWidth;
  shader.vertexShader='uniform float inkWidth;\n'+shader.vertexShader.replace('#include <begin_vertex>',`
  // The instance's horizontal scale turns the world width into this mesh's units.
  float worldScale=length((modelMatrix*instanceMatrix)[0].xyz);
  vec3 transformed=position+normalize(normal)*(inkWidth/max(worldScale,1e-4));`);
};
const TONES=(()=>{const steps=new THREE.DataTexture(new Uint8Array([110,180,255]),3,1,THREE.RedFormat);steps.minFilter=steps.magFilter=THREE.NearestFilter;steps.needsUpdate=true;return steps;})();
// Roof materials and how much of the owner's colour each takes: the grove's cold slates are first warmed, the ember's
// fired-clay domes keep more of their own colour.
const WARM_SLATE='#6f7f72';
const ROOFS=new Map<string,{base?:string;team:number}>([
  ...['#71928f','#7ca1a4','#709c97','#647b77'].map(name=>[name,{base:WARM_SLATE,team:.5}] as const),
  ...['#cf9054','#cc9154'].map(name=>[name,{team:.35}] as const),
]);
const INKED=new Set(['Building','Hull','Gun']);
const hulls=new WeakMap<THREE.BufferGeometry,THREE.BufferGeometry>();
function hullGeometry(source:THREE.BufferGeometry){
  let hull=hulls.get(source);
  if(!hull){
    // A flat-shaded mesh repeats each corner once per face, each copy with its face's normal; pushed out along those,
    // the copies would part and open cracks at every edge. Every copy of a corner takes the average of their normals.
    const position=source.getAttribute('position'),normal=source.getAttribute('normal'),sums=new Map<string,THREE.Vector3>(),keys:string[]=[];
    const at=new THREE.Vector3();
    for(let i=0;i<position.count;i++){
      const key=`${Math.round(position.getX(i)*1e3)},${Math.round(position.getY(i)*1e3)},${Math.round(position.getZ(i)*1e3)}`;keys.push(key);
      const sum=sums.get(key)??sums.set(key,new THREE.Vector3()).get(key)!;
      if(normal)sum.add(at.fromBufferAttribute(normal,i));
    }
    const smoothed=new Float32Array(position.count*3);
    for(let i=0;i<position.count;i++){const n=sums.get(keys[i]!)!.clone().normalize();smoothed.set([n.x,n.y,n.z],i*3);}
    hull=new THREE.BufferGeometry();hull.setAttribute('position',position);hull.setAttribute('normal',new THREE.BufferAttribute(smoothed,3));
    if(source.index)hull.setIndex(source.index);
    hulls.set(source,hull);
  }
  return hull;
}
// A ship's masts and yards (the parts under its Rig_ nodes) stay unlined: drawn round every spar, the ink turned a
// rigged ship into a thicket of dark lines in a firefight. The hull's line already gives the ship its outline.
function underRig(object:THREE.Object3D){for(let at:THREE.Object3D|null=object;at;at=at.parent)if(at.name.startsWith('Rig_'))return true;return false;}
// Poles, rails and banner staves are too thin to carry a line of their own.
function thin(geometry:THREE.BufferGeometry){
  geometry.computeBoundingBox();const size=geometry.boundingBox!.getSize(new THREE.Vector3());const [,middle,largest]=[size.x,size.y,size.z].sort((a,z)=>a-z);
  return middle!<largest!*.12;
}
export type BatchAnimation=ReadonlyMap<string,{matrix?:THREE.Matrix4;morph?:readonly number[]}>;
type Part={name:string;geometry:THREE.BufferGeometry;material:THREE.Material|THREE.Material[];local:THREE.Matrix4;morph:readonly number[];rig:boolean};
type Batch={inked:boolean;hulls:THREE.InstancedMesh[];parts:Part[];meshes:THREE.InstancedMesh[];matrices:THREE.Matrix4[];animations:(BatchAnimation|undefined)[];ids:string[];capacity:number;last:number};

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
  // A batch's geometry, texture and material views are this layer's for its whole life, not the batch's: a batch is
  // retired a couple of seconds after its last draw (an arrow's, a ship's), and disposing its materials then would free
  // their shader programs, so the next arrow or ship would compile them again inside a frame.
  private geometries=new Map<THREE.BufferGeometry,THREE.BufferGeometry>();
  private textures=new Map<THREE.Texture,THREE.Texture>();
  private materials=new Map<string,THREE.Material>();
  private frame=0;
  private matrix=new THREE.Matrix4();
  constructor(private scene:THREE.Scene){}
  begin(){this.frame++;for(const batch of this.batches.values()){batch.matrices.length=0;batch.animations.length=0;batch.ids.length=0;}}
  private geometry(source:THREE.BufferGeometry){
    let view=this.geometries.get(source);
    if(!view){
      // Each renderer owns its GPU allocations and dispose listeners. Views
      // share decoded typed arrays without attaching a renderer to the global
      // model geometry or destroying another layer's buffers on teardown.
      view=new THREE.BufferGeometry();view.name=source.name;
      view.index=source.index;view.attributes=source.attributes;view.morphAttributes=source.morphAttributes;
      view.morphTargetsRelative=source.morphTargetsRelative;view.groups=source.groups.map(group=>({...group}));view.drawRange={...source.drawRange};
      view.boundingBox=source.boundingBox?.clone()??null;view.boundingSphere=source.boundingSphere?.clone()??null;
      this.geometries.set(source,view);
    }
    return view;
  }
  private texture(source:THREE.Texture){
    let view=this.textures.get(source);
    if(!view){
      // Texture.copy JSON-clones userData by default. Painted alpha masks are
      // immutable typed arrays; preserve them without expanding into objects.
      const clean=Object.create(source) as THREE.Texture;clean.userData={};
      view=new (source.constructor as new()=>THREE.Texture)().copy(clean);view.userData=source.userData;
      this.textures.set(source,view);
    }
    return view;
  }
  private material(source:THREE.Material,color:string|undefined,constructing:boolean,revealDeck:boolean,inked:boolean){
    const team=source.name==='TeamColor',cloth=revealDeck&&source.name.startsWith('unbleached sail'),roof=inked&&ROOFS.has(source.name);
    const key=`${source.uuid}:${team||roof?color??'':''}:${constructing}:${cloth}:${inked}`;
    let material=this.materials.get(key);
    if(material)return material;
    material=source.clone();
    for(const [name,value] of Object.entries(source))if(value instanceof THREE.Texture)(material as unknown as Record<string,unknown>)[name]=this.texture(value);
    if(source instanceof THREE.ShaderMaterial && material instanceof THREE.ShaderMaterial)for(const [name,uniform] of Object.entries(source.uniforms)){
      const value=uniform.value;
      if(value instanceof THREE.Texture)material.uniforms[name]!.value=this.texture(value);
      else if(Array.isArray(value))material.uniforms[name]!.value=value.map(item=>item instanceof THREE.Texture?this.texture(item):item);
    }
    if(team && 'color' in material)(material as THREE.MeshStandardMaterial).color.set(color??'#88977c');
    const tint=roof?ROOFS.get(source.name)!:undefined;
    if(tint && material instanceof THREE.MeshStandardMaterial){if(tint.base)material.color.set(tint.base);material.color.lerp(new THREE.Color(color??'#88977c'),tint.team);}
    if(inked && material instanceof THREE.MeshStandardMaterial){
      const smooth=material;
      material=new THREE.MeshToonMaterial({name:smooth.name,color:smooth.color,map:smooth.map,gradientMap:TONES,vertexColors:smooth.vertexColors,side:smooth.side,alphaTest:smooth.alphaTest});
      smooth.dispose();
    }
    if(constructing){material.transparent=true;material.opacity=.48;}
    // Cloth alone becomes translucent. The hull still occludes, collides
    // and casts shadows normally; selection never mutates shared assets.
    if(cloth){material.transparent=true;material.opacity=.22;material.depthWrite=false;}
    this.materials.set(key,material);return material;
  }
  add(key:string,template:THREE.Object3D,matrix:THREE.Matrix4,id:string,color?:string,constructing=false,revealDeck=false,animation?:BatchAnimation){
    let batch=this.batches.get(key);
    if(!batch){
      // A finished building, a ship's hull and its guns are drawn inked (see @@@model-ink); a site going up and a broken gun keep
      // their own looks.
      const inked=INKED.has(template.name)&&!constructing,parts:Part[]=[];template.updateMatrixWorld(true);
      template.traverse(object=>{if(!(object instanceof THREE.Mesh))return;
        const map=(source:THREE.Material)=>this.material(source,color,constructing,revealDeck,inked);
        const geometry=this.geometry(object.geometry),morphCount=Object.values(geometry.morphAttributes)[0]?.length??0;
        parts.push({name:object.name,geometry,material:Array.isArray(object.material)?object.material.map(map):map(object.material),local:object.matrixWorld.clone(),morph:Array.from({length:morphCount},(_,i)=>object.morphTargetInfluences?.[i]??0),rig:underRig(object)});
      });
      batch={inked,hulls:[],parts,meshes:[],matrices:[],animations:[],ids:[],capacity:0,last:this.frame};this.batches.set(key,batch);
    }
    batch.matrices.push(matrix);batch.animations.push(animation);batch.ids.push(id);batch.last=this.frame;
  }
  finish(){
    for(const [key,batch] of this.batches){
      if(!batch.matrices.length){
        for(const mesh of [...batch.meshes,...batch.hulls]){mesh.count=0;mesh.visible=false;}
        if(this.frame-batch.last>120)this.remove(key,batch);
        continue;
      }
      if(batch.matrices.length>batch.capacity){
        for(const mesh of [...batch.meshes,...batch.hulls]){this.scene.remove(mesh);mesh.dispose();}
        batch.capacity=2**Math.ceil(Math.log2(Math.max(1,batch.matrices.length)));
        batch.hulls=batch.inked?batch.parts.filter(part=>!part.morph.length&&!part.rig&&!thin(part.geometry)).map(part=>{
          const hull=new THREE.InstancedMesh(hullGeometry(part.geometry),INK_HULL,batch!.capacity);hull.name=part.name;hull.userData.local=part.local;
          hull.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.scene.add(hull);return hull;
        }):[];
        batch.meshes=batch.parts.map(part=>{const mesh=part.morph.length?new MorphInstancedMesh(part,batch.capacity):new THREE.InstancedMesh(part.geometry,part.material,batch.capacity);mesh.name=part.name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.userData.ids=batch.ids;this.scene.add(mesh);return mesh;});
      }
      for(const hull of batch.hulls){
        hull.count=batch.matrices.length;hull.visible=true;
        for(let i=0;i<hull.count;i++)hull.setMatrixAt(i,this.matrix.copy(batch.matrices[i]!).multiply(hull.userData.local as THREE.Matrix4));
        hull.instanceMatrix.needsUpdate=true;hull.computeBoundingSphere();
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
    }
  }
  objects(){return [...this.batches.values()].flatMap(batch=>batch.meshes).filter(mesh=>mesh.visible);}
  forget(key:string){const batch=this.batches.get(key);if(batch)this.remove(key,batch);}
  remove(key:string,batch:Batch){
    for(const mesh of [...batch.meshes,...batch.hulls]){this.scene.remove(mesh);mesh.dispose();}
    this.batches.delete(key);
  }
  dispose(){
    for(const [key,batch] of this.batches)this.remove(key,batch);
    for(const material of this.materials.values())material.dispose();
    for(const view of this.geometries.values())view.dispose();
    for(const view of this.textures.values())view.dispose();
    this.materials.clear();this.geometries.clear();this.textures.clear();
  }
}
