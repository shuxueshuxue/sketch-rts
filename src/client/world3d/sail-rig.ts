import * as THREE from 'three';
import type {BatchAnimation} from './batches';
import type {GameSnapshot,Unit} from '../../shared/types';
import {SIM_TICKS_PER_SECOND} from '../../shared/time';

type XYZ=[number,number,number];
export type SailPose={angle:number;billow:number;set:number};
type RigFrame={id:string;pivot:XYZ;axis:XYZ;angleScale:number;angleOffset:number;angleLimits:[number,number]};
type RigSail={id:string;node:string;frameId:string;morphTargets:{positive:string;negative:string;furl:string}};
type RigAnchor={point:XYZ;frameId?:string;sailId?:string;morphDeltas?:{positive:XYZ;negative:XYZ;furl:XYZ}};
type RigMaterial={color:XYZ;roughness:number;metalness:number};
export type ShipRigMetadata={version:1;space:'glTF-y-up';defaults:SailPose;frames:RigFrame[];sails:RigSail[];rigidParts:{node:string;frameId:string}[];ropes:{id:string;a:RigAnchor;b:RigAnchor;radius:number;material:string}[];materials:Record<string,RigMaterial>};
type PartBinding={name:string;frameId:string;rest:THREE.Matrix4;defaults:number[];targets?:[number,number,number]};
type AnchorBinding={point:THREE.Vector3;frameId?:string;deltas?:[THREE.Vector3,THREE.Vector3,THREE.Vector3]};
type RopeBinding={id:string;a:AnchorBinding;b:AnchorBinding;radius:number;material:string;template:THREE.Mesh};
const UP=new THREE.Vector3(0,1,0);
const DEFAULT_POSE:SailPose={angle:0,billow:1,set:1};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const finite=(value:number|undefined,fallback:number)=>Number.isFinite(value)?value!:fallback;
export function sailMorphWeights(pose:SailPose):[number,number,number]{
  const set=clamp(finite(pose.set,1),0,1),billow=clamp(finite(pose.billow,1),-1,1);
  return[Math.max(0,billow)*set,Math.max(0,-billow)*set,1-set];
}
function shipPose(unit:Pick<Unit,'sailing'>):SailPose{
  const sail=(unit.sailing as (Unit['sailing']&{sail?:SailPose})|undefined)?.sail;
  return sail?{angle:finite(sail.angle,0),billow:clamp(finite(sail.billow,1),-1,1),set:clamp(finite(sail.set,1),0,1)}:{...DEFAULT_POSE};
}
type PoseTrack={from:SailPose;to:SailPose;start:number;span:number};
function interpolated(track:PoseTrack,now:number):SailPose{
  const t=track.span>0?clamp((now-track.start)/track.span,0,1):1;
  // Trim limits are below pi; crossing zero during a tack is intentional.
  return{angle:track.from.angle+(track.to.angle-track.from.angle)*t,billow:track.from.billow+(track.to.billow-track.from.billow)*t,set:track.from.set+(track.to.set-track.from.set)*t};
}
/** Display-only interpolation over snapshot tick spans. A paused tick cannot
 * create more sail motion, and resyncs snap instead of inventing a long tack. */
export class SailPoseTracker{
  private tracks=new Map<string,PoseTrack>();
  private lastTick:number|undefined;
  update(snapshot:Pick<GameSnapshot,'tick'|'units'>,now:number){
    if(snapshot.tick===this.lastTick)return;
    const ticks=this.lastTick===undefined?0:snapshot.tick-this.lastTick,continuous=ticks>0&&ticks<=10;
    const next=new Map<string,PoseTrack>();
    for(const unit of snapshot.units)if(unit.sailing){
      const to=shipPose(unit),previous=this.tracks.get(unit.id),from=continuous&&previous?interpolated(previous,now):to;
      next.set(unit.id,{from,to,start:now,span:continuous?ticks*1000/SIM_TICKS_PER_SECOND:0});
    }
    this.tracks=next;this.lastTick=snapshot.tick;
  }
  pose(unit:Pick<Unit,'id'|'sailing'>,now:number){const track=this.tracks.get(unit.id);return track?interpolated(track,now):shipPose(unit);}
  reset(){this.tracks.clear();this.lastTick=undefined;}
}

/** GLB components are exported as origin-zero siblings. Assemble the Hull
 * component once after decoding, retaining each authored world transform. */
export function attachShipRigParts(model:THREE.Object3D){
  const hulls:THREE.Object3D[]=[];
  model.traverse(object=>{if(object.userData.shipRig?.version===1)hulls.push(object);});
  model.updateMatrixWorld(true);
  for(const hull of hulls){
    const data=hull.userData.shipRig as ShipRigMetadata;
    for(const name of new Set([...data.sails.map(sail=>sail.node),...data.rigidParts.map(part=>part.node)])){
      const part=model.getObjectByName(name);if(!part)throw new Error(`Ship rig node missing: ${name}`);
      let parent:THREE.Object3D|null=part.parent,attached=false;
      while(parent){if(parent===hull){attached=true;break;}parent=parent.parent;}
      if(!attached&&part!==hull)hull.attach(part);
    }
  }
  model.updateMatrixWorld(true);
}

/** Decoded rig bindings are shared by every ship of this model. All points in
 * the asset contract are already in glTF local [ship X, height, ship Y]. */
export class ShipRigModel{
  readonly parts:PartBinding[]=[];
  readonly ropes:RopeBinding[]=[];
  readonly data:ShipRigMetadata;
  private geometry=new THREE.CylinderGeometry(1,1,1,4,1,true);
  private materials=new Map<string,THREE.MeshStandardMaterial>();
  constructor(readonly template:THREE.Object3D){
    this.data=template.userData.shipRig as ShipRigMetadata;
    template.updateMatrixWorld(true);
    const inverse=new THREE.Matrix4().copy(template.matrixWorld).invert();
    const bind=(node:string,frameId:string,sail?:RigSail)=>{
      const source=template.getObjectByName(node);
      if(!source)throw new Error(`Ship rig node missing: ${node}`);
      source.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        let targets:[number,number,number]|undefined;
        if(sail){
          const dictionary=object.morphTargetDictionary??{};
          const names=[sail.morphTargets.positive,sail.morphTargets.negative,sail.morphTargets.furl];
          const indices=names.map(name=>dictionary[name]);
          if(indices.some(index=>index===undefined))throw new Error(`Ship sail morph missing: ${object.name}`);
          targets=indices as [number,number,number];
        }
        this.parts.push({name:object.name,frameId,rest:new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld),defaults:[...(object.morphTargetInfluences??[])],...(targets?{targets}:{})});
      });
    };
    for(const sail of this.data.sails)bind(sail.node,sail.frameId,sail);
    for(const part of this.data.rigidParts)bind(part.node,part.frameId);
    const sailFrames=new Map(this.data.sails.map(sail=>[sail.id,sail.frameId]));
    const anchor=(source:RigAnchor):AnchorBinding=>{
      const frameId=source.sailId?sailFrames.get(source.sailId):source.frameId;
      if(source.sailId&&!frameId)throw new Error(`Ship rope sail missing: ${source.sailId}`);
      return{point:new THREE.Vector3().fromArray(source.point),...(frameId?{frameId}:{}),...(source.morphDeltas?{deltas:[new THREE.Vector3().fromArray(source.morphDeltas.positive),new THREE.Vector3().fromArray(source.morphDeltas.negative),new THREE.Vector3().fromArray(source.morphDeltas.furl)] as [THREE.Vector3,THREE.Vector3,THREE.Vector3]}:{})};
    };
    for(const rope of this.data.ropes){
      let material=this.materials.get(rope.material);
      if(!material){
        const definition=this.data.materials[rope.material];
        if(!definition)throw new Error(`Ship rope material missing: ${rope.material}`);
        material=new THREE.MeshStandardMaterial({color:new THREE.Color().fromArray(definition.color),roughness:definition.roughness,metalness:definition.metalness});
        material.name=rope.material;this.materials.set(rope.material,material);
      }
      const mesh=new THREE.Mesh(this.geometry,material);mesh.name=`RigRope:${rope.material}`;
      this.ropes.push({id:rope.id,a:anchor(rope.a),b:anchor(rope.b),radius:rope.radius,material:rope.material,template:mesh});
    }
  }
  createPose(){return new ShipRigPose(this);}
  dispose(){this.geometry.dispose();for(const material of this.materials.values())material.dispose();}
}
export function shipRigModel(template:THREE.Object3D){
  const data=template.userData.shipRig as Partial<ShipRigMetadata>|undefined;
  return data?.version===1&&data.space==='glTF-y-up'?new ShipRigModel(template):undefined;
}

export class ShipRigPose{
  readonly parts=new Map<string,{matrix:THREE.Matrix4;morph?:number[]}>();
  readonly ropes:{id:string;matrix:THREE.Matrix4;template:THREE.Mesh;material:string;visible:boolean}[];
  readonly frames=new Map<string,THREE.Matrix4>();
  private a=new THREE.Vector3();private b=new THREE.Vector3();private direction=new THREE.Vector3();private middle=new THREE.Vector3();
  private rotation=new THREE.Quaternion();private scale=new THREE.Vector3();
  private frameBindings:{spec:RigFrame;axis:THREE.Vector3;from:THREE.Matrix4;to:THREE.Matrix4}[];
  constructor(readonly model:ShipRigModel){
    this.frameBindings=model.data.frames.map(spec=>({spec,axis:new THREE.Vector3().fromArray(spec.axis).normalize(),from:new THREE.Matrix4().makeTranslation(...spec.pivot),to:new THREE.Matrix4().makeTranslation(-spec.pivot[0],-spec.pivot[1],-spec.pivot[2])}));
    for(const frame of model.data.frames)this.frames.set(frame.id,new THREE.Matrix4());
    for(const part of model.parts)this.parts.set(part.name,{matrix:new THREE.Matrix4(),...(part.targets?{morph:[...part.defaults]}:{})});
    this.ropes=model.ropes.map(rope=>({id:rope.id,matrix:new THREE.Matrix4(),template:rope.template,material:rope.material,visible:true}));
    this.update(model.data.defaults);
  }
  update(state:SailPose):BatchAnimation{
    const weights=sailMorphWeights(state);
    for(const {spec,axis,from,to} of this.frameBindings){
      const angle=clamp(finite(state.angle,0)*spec.angleScale+spec.angleOffset,...spec.angleLimits);
      this.frames.get(spec.id)!.makeRotationAxis(axis,angle).premultiply(from).multiply(to);
    }
    for(const part of this.model.parts){
      const value=this.parts.get(part.name)!,frame=this.frames.get(part.frameId);
      if(!frame)throw new Error(`Ship rig frame missing: ${part.frameId}`);
      value.matrix.copy(frame).multiply(part.rest);
      if(part.targets)for(let i=0;i<3;i++)value.morph![part.targets[i]!]=weights[i]!;
    }
    const point=(anchor:AnchorBinding,target:THREE.Vector3)=>{
      target.copy(anchor.point);
      if(anchor.deltas)for(let i=0;i<3;i++)target.addScaledVector(anchor.deltas[i]!,weights[i]!);
      if(anchor.frameId)target.applyMatrix4(this.frames.get(anchor.frameId)!);
    };
    for(let i=0;i<this.ropes.length;i++){
      const source=this.model.ropes[i]!,rope=this.ropes[i]!;
      point(source.a,this.a);point(source.b,this.b);
      this.direction.subVectors(this.b,this.a);const length=this.direction.length();rope.visible=length>1e-6;
      this.middle.addVectors(this.a,this.b).multiplyScalar(.5);
      this.rotation.setFromUnitVectors(UP,rope.visible?this.direction.multiplyScalar(1/length):UP);
      this.scale.set(source.radius,length,source.radius);rope.matrix.compose(this.middle,this.rotation,this.scale);
    }
    return this.parts;
  }
}

/** Build a default pose only when a CPU portrait cache misses. Geometry stays
 * shared; the short-lived rope materials are owned and disposed by this helper. */
export function defaultRigPortrait(source:THREE.Object3D):{model:THREE.Object3D;dispose():void}{
  let sourceHull:THREE.Object3D|undefined;
  source.traverse(object=>{if(object.userData.shipRig?.version===1)sourceHull=object;});
  if(!sourceHull)return{model:source,dispose(){}};
  const model=source.clone(true);attachShipRigParts(model);model.updateMatrixWorld(true);
  const hull=model.getObjectByName(sourceHull.name)!;
  const rig=shipRigModel(hull);
  if(!rig)return{model:source,dispose(){}};
  const pose=rig.createPose();
  for(const [name,value] of pose.parts){
    const mesh=hull.getObjectByName(name) as THREE.Mesh;
    const desired=new THREE.Matrix4().multiplyMatrices(hull.matrixWorld,value.matrix);
    mesh.matrix.copy(mesh.parent?new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert().multiply(desired):desired);
    mesh.matrixAutoUpdate=false;
    if(value.morph)mesh.morphTargetInfluences=[...value.morph];
  }
  for(const rope of pose.ropes)if(rope.visible){
    const mesh=rope.template.clone();mesh.name=`DefaultRigRope:${rope.id}`;mesh.matrix.copy(rope.matrix);mesh.matrixAutoUpdate=false;hull.add(mesh);
  }
  model.updateMatrixWorld(true);
  return{model,dispose:()=>rig.dispose()};
}
