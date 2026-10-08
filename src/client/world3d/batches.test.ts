import {describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {ActorBatches,type BatchAnimation} from './batches';

function sail(relative=true):THREE.Mesh{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,1,-1,0,0,1,0],3));
  // Keep cached rest-pose bounds: picking must not rely on a loader having
  // expanded them, and must not rewrite them for another actor's animation.
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.morphTargetsRelative=relative;
  geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(relative?[4,0,0,4,0,0,4,0,0]:[3,-1,0,5,-1,0,4,1,0],3)];
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.name='Sail';
  return mesh;
}
function translate(x=0,y=0,z=0){return new THREE.Matrix4().makeTranslation(x,y,z);}
function pose(weights:readonly number[],matrix?:THREE.Matrix4):BatchAnimation{
  return new Map([['Sail',matrix?{morph:weights,matrix}:{morph:weights}]]);
}
function weights(mesh:THREE.InstancedMesh,index:number){const scratch=new THREE.Mesh(mesh.geometry,mesh.material);mesh.getMorphAt(index,scratch);return scratch.morphTargetInfluences;}
function hits(mesh:THREE.InstancedMesh,x:number,y=0){return new THREE.Raycaster(new THREE.Vector3(x,y,5),new THREE.Vector3(0,0,-1)).intersectObject(mesh);}
function expectMatrix(mesh:THREE.InstancedMesh,index:number,expected:THREE.Matrix4){
  const actual=new THREE.Matrix4();mesh.getMatrixAt(index,actual);
  for(let i=0;i<16;i++)expect(actual.elements[i]).toBeCloseTo(expected.elements[i]!,5);
}

describe('actor batches',()=>{
  it('keeps static callers, shared geometry, nested transforms and instance IDs',()=>{
    const scene=new THREE.Scene(),batches=new ActorBatches(scene),template=new THREE.Group();template.position.set(1,2,3);
    const sourceMaterial=new THREE.MeshStandardMaterial({color:'#ffffff'});sourceMaterial.name='TeamColor';
    const hull=new THREE.Mesh(new THREE.BoxGeometry(),sourceMaterial);hull.name='Hull';hull.position.set(3,2,1);template.add(hull);
    const actor=translate(10,20,30),originalActor=actor.clone();
    batches.begin();batches.add('ship',template,actor,'a','#123456');batches.add('ship',template,translate(30),'b','#123456');batches.finish();
    const mesh=batches.objects()[0]!;
    expect(mesh.geometry).toBe(hull.geometry);expect(mesh.morphTexture).toBeNull();expect(mesh.count).toBe(2);
    expect(mesh.userData.ids).toEqual(['a','b']);expect(mesh.castShadow&&mesh.receiveShadow).toBe(true);
    expectMatrix(mesh,0,actor.clone().multiply(hull.matrixWorld));expect(actor).toEqual(originalActor);
    expect(mesh.material).not.toBe(sourceMaterial);expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('123456');
    expect(sourceMaterial.color.getHexString()).toBe('ffffff');
    batches.dispose();expect(scene.children).toHaveLength(0);
  });

  it('uses absolute component-local leaf overrides and cached transforms for missing entries',()=>{
    const batches=new ActorBatches(new THREE.Scene()),template=new THREE.Group();template.position.set(20,0,0);
    const cloth=sail(),hull=new THREE.Mesh(new THREE.BoxGeometry());hull.name='Hull';cloth.position.y=3;hull.position.z=7;template.add(cloth,hull);
    const actor=new THREE.Matrix4().makeRotationZ(Math.PI/2);actor.setPosition(10,20,30);
    const override=translate(1,2,3),originalOverride=override.clone();
    batches.begin();batches.add('ship',template,actor,'animated',undefined,false,false,pose([.5],override));
    batches.add('ship',template,translate(),'rest');batches.finish();
    const meshes=batches.objects(),clothBatch=meshes.find(mesh=>mesh.name==='Sail')!,hullBatch=meshes.find(mesh=>mesh.name==='Hull')!;
    expectMatrix(clothBatch,0,actor.clone().multiply(override));expectMatrix(clothBatch,1,cloth.matrixWorld);
    expectMatrix(hullBatch,0,actor.clone().multiply(hull.matrixWorld));expect(override).toEqual(originalOverride);
    expect(weights(clothBatch,0)).toEqual([.5]);expect(weights(clothBatch,1)).toEqual([0]);
    batches.dispose();
  });

  it.each([true,false])('picks real per-instance deformed triangles outside cached bounds (relative=%s)',relative=>{
    const scene=new THREE.Scene(),batches=new ActorBatches(scene),source=sail(relative),geometry=source.geometry;
    geometry.setIndex([0,1,2]);geometry.addGroup(0,3,1);source.material=[new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial({side:THREE.DoubleSide})];
    const originalBox=geometry.boundingBox!.clone(),originalSphere=geometry.boundingSphere!.clone(),positions=geometry.getAttribute('position').array.slice();
    batches.begin();batches.add('ship',source,translate(),'rest',undefined,false,false,pose([0]));
    batches.add('ship',source,translate(10),'moving',undefined,false,false,pose([1.5],translate(0,2)));batches.finish();scene.updateMatrixWorld(true);
    const mesh=batches.objects()[0]!,restHit=hits(mesh,0),movingHit=hits(mesh,16,2);
    expect(restHit).toHaveLength(1);expect(restHit[0]!.instanceId).toBe(0);
    expect(movingHit).toHaveLength(1);expect(movingHit[0]!.instanceId).toBe(1);expect(movingHit[0]!.object).toBe(mesh);
    expect(movingHit[0]!.face!.materialIndex).toBe(1);expect(movingHit[0]!.point.toArray()).toEqual([16,2,0]);
    expect(hits(mesh,10,2)).toHaveLength(0);expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(16,2,0))).toBe(true);
    expect(weights(mesh,0)).toEqual([0]);expect(weights(mesh,1)).toEqual([1.5]);expect(mesh.morphTexture!.version).toBeGreaterThan(0);
    expect(mesh.geometry).toBe(geometry);expect(geometry.boundingBox).toEqual(originalBox);expect(geometry.boundingSphere).toEqual(originalSphere);
    expect(geometry.getAttribute('position').array).toEqual(positions);expect(source.morphTargetInfluences).toEqual([0]);
    batches.dispose();
  });

  it('bounds combined and negative morph weights and respects the scene world transform',()=>{
    const scene=new THREE.Scene();scene.position.set(100,20,0);
    const source=sail();source.geometry.morphAttributes.position!.push(new THREE.Float32BufferAttribute([0,6,0,0,6,0,0,6,0],3));source.updateMorphTargets();
    const batches=new ActorBatches(scene);batches.begin();batches.add('ship',source,translate(),'a',undefined,false,false,pose([-2,2]));batches.finish();scene.updateMatrixWorld(true);
    const mesh=batches.objects()[0]!;
    expect(hits(mesh,92,32)).toHaveLength(1);expect(hits(mesh,100,20)).toHaveLength(0);
    expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(-8,12,0))).toBe(true);
    mesh.computeBoundingBox();expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(-8,12,0))).toBe(true);
    batches.dispose();
  });

  it('restores source default morph weights when animations disappear or instances reorder',()=>{
    const source=sail();source.morphTargetInfluences![0]=.25;
    const batches=new ActorBatches(new THREE.Scene());
    batches.begin();batches.add('ship',source,translate(),'animated',undefined,false,false,pose([1]));batches.add('ship',source,translate(10),'default');batches.finish();
    const mesh=batches.objects()[0]!;expect(weights(mesh,0)).toEqual([1]);expect(weights(mesh,1)).toEqual([.25]);
    batches.begin();batches.add('ship',source,translate(10),'default');batches.add('ship',source,translate(),'animated',undefined,false,false,new Map([['Sail',{matrix:translate()}]]));batches.finish();
    expect(batches.objects()[0]).toBe(mesh);expect(mesh.userData.ids).toEqual(['default','animated']);
    expect(weights(mesh,0)).toEqual([.25]);expect(weights(mesh,1)).toEqual([.25]);expect(source.morphTargetInfluences).toEqual([.25]);
    batches.dispose();
  });

  it('allocates morph textures at capacity and disposes old textures when growing without disposing source buffers',()=>{
    const scene=new THREE.Scene(),batches=new ActorBatches(scene),source=sail();
    const geometryDispose=vi.spyOn(source.geometry,'dispose'),materialDispose=vi.spyOn(source.material as THREE.Material,'dispose');
    function frame(count:number){batches.begin();for(let i=0;i<count;i++)batches.add('ship',source,translate(i*10),String(i),undefined,false,false,pose([i/4]));batches.finish();}
    frame(3);const first=batches.objects()[0]!,texture=first.morphTexture!,textureDispose=vi.spyOn(texture,'dispose'),batchMaterialDispose=vi.spyOn(first.material as THREE.Material,'dispose');
    expect(texture.image.height).toBe(4);
    frame(4);expect(batches.objects()[0]).toBe(first);expect(weights(first,3)).toEqual([.75]);expect(hits(first,33)).toHaveLength(1);
    frame(5);const second=batches.objects()[0]!;expect(second).not.toBe(first);expect(second.morphTexture!.image.height).toBe(8);expect(weights(second,4)).toEqual([1]);
    expect(textureDispose).toHaveBeenCalledOnce();expect(batchMaterialDispose).not.toHaveBeenCalled();expect(scene.children).toEqual([second]);
    const secondTextureDispose=vi.spyOn(second.morphTexture!,'dispose');batches.forget('ship');
    expect(secondTextureDispose).toHaveBeenCalledOnce();expect(batchMaterialDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).not.toHaveBeenCalled();expect(materialDispose).not.toHaveBeenCalled();expect(scene.children).toHaveLength(0);
  });

  it('preserves material groups, construction opacity and sail-only deck reveal',()=>{
    const scene=new THREE.Scene(),batches=new ActorBatches(scene),source=sail();
    const cloth=new THREE.MeshStandardMaterial();cloth.name='unbleached sail cloth';
    const hull=new THREE.MeshStandardMaterial();hull.name='Hull';source.material=[cloth,hull];
    source.geometry.addGroup(0,3,0);
    batches.begin();batches.add('reveal',source,translate(),'a',undefined,false,true,pose([.5]));
    batches.add('construction',source,translate(),'b',undefined,true);batches.finish();
    const [reveal,construction]=batches.objects(),revealMaterials=reveal!.material as THREE.Material[],constructionMaterials=construction!.material as THREE.Material[];
    expect(reveal!.geometry.groups).toEqual([{start:0,count:3,materialIndex:0}]);
    expect(revealMaterials[0]!.opacity).toBe(.22);expect(revealMaterials[0]!.depthWrite).toBe(false);expect(revealMaterials[0]!.transparent).toBe(true);
    expect(revealMaterials[1]!.opacity).toBe(1);expect(revealMaterials[1]!.depthWrite).toBe(true);expect(revealMaterials[1]!.transparent).toBe(false);
    expect(constructionMaterials.map(material=>material.opacity)).toEqual([.48,.48]);expect(cloth.opacity).toBe(1);expect(hull.opacity).toBe(1);
    batches.dispose();
  });

  it('hides empty frames and retires inactive batches with their morph textures',()=>{
    const scene=new THREE.Scene(),batches=new ActorBatches(scene),source=sail();
    batches.begin();batches.add('ship',source,translate(),'a');batches.finish();const mesh=batches.objects()[0]!,dispose=vi.spyOn(mesh.morphTexture!,'dispose');
    batches.begin();batches.finish();expect(batches.objects()).toHaveLength(0);expect(mesh.count).toBe(0);expect(hits(mesh,0)).toHaveLength(0);
    for(let i=0;i<120;i++){batches.begin();batches.finish();}
    expect(dispose).toHaveBeenCalledOnce();expect(scene.children).toHaveLength(0);
  });
});
