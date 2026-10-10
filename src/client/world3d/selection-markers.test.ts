import { describe,expect,it,vi } from 'vitest';
import { InstancedMesh,Matrix4,Scene,ShaderMaterial } from 'three';
import { SelectionMarkers } from './selection-markers';

describe('ground and deck selection surfaces',()=>{
  it('uses real depth without intercepting entity selection or shadows, and reuses buffers across hover changes',()=>{
    const scene=new Scene(),markers=new SelectionMarkers(scene),pose=new Matrix4().makeTranslation(100,.15,200);
    markers.begin();markers.ellipse(pose,21,11.55,'#3d9a3f',true);markers.rectangle(pose,63,47,'#c8372b',false);markers.finish();
    const mesh=scene.children[0] as InstancedMesh,geometry=mesh.geometry,material=mesh.material as ShaderMaterial;
    expect(mesh.count).toBe(2);expect(material.depthTest).toBe(true);expect(material.depthWrite).toBe(false);
    expect(mesh.castShadow || mesh.receiveShadow).toBe(false);
    const hits:unknown[]=[];mesh.raycast({} as never,hits as never);expect(hits).toEqual([]);
    for(let frame=0;frame<100;frame++) {
      markers.begin();markers.ellipse(pose,21,11.55,'#3d9a3f',frame%2===0);markers.finish();
      expect(scene.children[0]).toBe(mesh);expect(mesh.geometry).toBe(geometry);expect(mesh.material).toBe(material);
    }
    markers.begin();markers.finish();expect(mesh.count).toBe(0);expect(mesh.visible).toBe(false);
    markers.begin();markers.ellipse(pose,21,11.55,'#3d9a3f',true);markers.finish();expect(mesh.visible).toBe(true);
    const disposeGeometry=vi.spyOn(geometry,'dispose'),disposeMaterial=vi.spyOn(material,'dispose');
    markers.clear();expect(mesh.count).toBe(0);expect(mesh.visible).toBe(false);
    markers.dispose();markers.dispose();markers.begin();markers.ellipse(pose,21,11.55,'#3d9a3f',true);markers.finish();
    expect(scene.children).toHaveLength(0);expect(disposeGeometry).toHaveBeenCalledOnce();expect(disposeMaterial).toHaveBeenCalledOnce();
  });
  it('retains all selected entities when an instance buffer grows midway through a frame',()=>{
    const scene=new Scene(),markers=new SelectionMarkers(scene);
    markers.begin();
    for(let index=0;index<9;index++)markers.ellipse(new Matrix4().makeTranslation(index*60,.15,200),21,11.55,'#3d9a3f',true);
    markers.finish();const mesh=scene.children[0] as InstancedMesh;
    expect(scene.children).toHaveLength(1);expect(mesh.count).toBe(9);
    const pose=new Matrix4();for(let index=0;index<9;index++){mesh.getMatrixAt(index,pose);expect(pose.elements[12]).toBe(index*60);}
    markers.dispose();
  });
});
