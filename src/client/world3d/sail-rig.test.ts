import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {SailPoseTracker,shipRigModel,sailMorphWeights,type ShipRigMetadata,type SailPose} from './sail-rig';
import {createUnit} from '../../shared/map';

function fixture(){
  const root=new THREE.Group();root.name='Hull';
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([5,2,0,7,2,0,5,4,0],3));
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=[new THREE.Float32BufferAttribute([0,0,2,0,0,0,0,0,0],3),new THREE.Float32BufferAttribute([0,0,-2,0,0,0,0,0,0],3),new THREE.Float32BufferAttribute([0,2,0,0,2,0,0,0,0],3)];
  const cloth=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());cloth.name='Cloth';cloth.morphTargetDictionary={BillowPositive:0,BillowNegative:1,Furl:2};cloth.morphTargetInfluences=[1,0,0];root.add(cloth);
  const yard=new THREE.Mesh(new THREE.BoxGeometry(5,.1,.1),new THREE.MeshStandardMaterial());yard.name='Yard';yard.position.set(5,4,0);root.add(yard);
  const metadata:ShipRigMetadata={version:1,space:'glTF-y-up',defaults:{angle:0,billow:1,set:1},frames:[{id:'main',pivot:[5,3,0],axis:[0,1,0],angleScale:-1,angleOffset:0,angleLimits:[-1.2,1.2]}],sails:[{id:'main-cloth',node:'Cloth',frameId:'main',morphTargets:{positive:'BillowPositive',negative:'BillowNegative',furl:'Furl'}}],rigidParts:[{node:'Yard',frameId:'main'}],materials:{rope:{color:[.2,.1,.04],roughness:1,metalness:0}},ropes:[{id:'sheet',a:{sailId:'main-cloth',point:[5,2,0],morphDeltas:{positive:[0,0,2],negative:[0,0,-2],furl:[0,2,0]}},b:{point:[8,0,3]},radius:.2,material:'rope'},{id:'lift',a:{frameId:'main',point:[5,4,0]},b:{point:[5,6,0]},radius:.1,material:'rope'}]};
  root.userData.shipRig=metadata;return{root,cloth,yard};
}
describe('dynamic sail rig display',()=>{
  it('keeps sheet endpoints exactly on native morphed vertices through both tacks and furling',()=>{
    const {root,cloth}=fixture(),before=JSON.stringify(root.userData),model=shipRigModel(root)!,pose=model.createPose();
    const sampled=new THREE.Mesh(cloth.geometry,cloth.material);
    for(const state of [{angle:.8,billow:1,set:1},{angle:-.8,billow:-1,set:1},{angle:.3,billow:-.6,set:.4},{angle:0,billow:0,set:0}]){
      const parts=pose.update(state),part=parts.get('Cloth')!;
      sampled.morphTargetInfluences=[...part.morph!];
      const actual=sampled.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(part.matrix!);
      const rope=pose.ropes[0]!,endA=new THREE.Vector3(0,-.5,0).applyMatrix4(rope.matrix),endB=new THREE.Vector3(0,.5,0).applyMatrix4(rope.matrix);
      expect(endA.distanceTo(actual)).toBeLessThan(1e-6);expect(endB.distanceTo(new THREE.Vector3(8,0,3))).toBeLessThan(1e-6);
      const pivot=new THREE.Vector3(5,3,0).applyMatrix4(pose.frames.get('main')!);expect(pivot.toArray()).toEqual([5,3,0]);
      expect(new THREE.Vector3(0,0,0).applyMatrix4(parts.get('Yard')!.matrix!).distanceTo(new THREE.Vector3(5,4,0))).toBeLessThan(1e-6);
    }
    expect(JSON.stringify(root.userData)).toBe(before);expect(cloth.morphTargetInfluences).toEqual([1,0,0]);
    expect(pose.ropes[0]!.template.geometry).toBe(pose.ropes[1]!.template.geometry);model.dispose();
  });
  it('maps the jib around its authored stay axis, independently of the main yard mapping',()=>{
    const {root}=fixture(),data=root.userData.shipRig as ShipRigMetadata;
    data.frames.push({id:'jib',pivot:[1,2,3],axis:[1,1,0],angleScale:.5,angleOffset:.1,angleLimits:[-.4,.4]});
    data.ropes.push({id:'jib-line',a:{frameId:'jib',point:[3,2,3]},b:{point:[0,0,0]},radius:.1,material:'rope'});
    const model=shipRigModel(root)!,pose=model.createPose();pose.update({angle:1,billow:1,set:1});
    const expected=new THREE.Vector3(2,0,0).applyAxisAngle(new THREE.Vector3(1,1,0).normalize(),.4).add(new THREE.Vector3(1,2,3));
    const a=new THREE.Vector3(0,-.5,0).applyMatrix4(pose.ropes[2]!.matrix);
    expect(a.distanceTo(expected)).toBeLessThan(1e-6);model.dispose();
  });
  it('crosses smoothly through a tack using snapshot time without changing the simulation or drifting while paused',()=>{
    const tracker=new SailPoseTracker(),unit=createUnit('sail','player','transport',0,0);
    unit.sailing={heading:0,speed:0,load:0,balance:0};
    const set=(value:SailPose)=>{Object.assign(unit.sailing!,{sail:{...value,mode:'sail'}});};
    set({angle:-.8,billow:-1,set:1});tracker.update({tick:10,units:[unit]},1000);
    set({angle:.8,billow:1,set:0});const original=JSON.stringify(unit);tracker.update({tick:12,units:[unit]},1100);
    expect(tracker.pose(unit,1150)).toEqual({angle:0,billow:0,set:.5});
    tracker.update({tick:12,units:[unit]},1190);
    expect(tracker.pose(unit,1200)).toEqual({angle:.8,billow:1,set:0});expect(tracker.pose(unit,100000)).toEqual(tracker.pose(unit,1200));
    expect(JSON.stringify(unit)).toBe(original);
    set({angle:-.3,billow:-.2,set:.8});tracker.update({tick:2,units:[unit]},2000);expect(tracker.pose(unit,2000)).toEqual({angle:-.3,billow:-.2,set:.8});
    tracker.reset();set({angle:.5,billow:1,set:1});tracker.update({tick:50,units:[unit]},2200);expect(tracker.pose(unit,2200).angle).toBe(.5);
  });
  it('uses bounded opposing morphs and a fully furled shape without residual billow',()=>{
    expect(sailMorphWeights({angle:0,billow:-.5,set:.4})).toEqual([0,.2,.6]);
    expect(sailMorphWeights({angle:0,billow:-1,set:0})).toEqual([0,0,1]);
    expect(sailMorphWeights({angle:0,billow:4,set:3})).toEqual([1,0,0]);
  });
});
