import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintFigure } from '../art/painted-units';
import { UnitAnimationTracker } from '../unit-animation';
import { UnitMotionSmoother } from '../unit-motion';
import { ownerInk } from '../world-renderer';
import { attackTargetId } from '../unit-facing';
import { CrewFacingTracker, uprightCrewRotation } from './crew-pose';
import { mountedWeaponPose, installedWeapons } from '../../shared/ship-equipment';
import { shipProfile, shipScale } from '../../shared/ship-geometry';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot } from '../../shared/types';

/** Read-only presentation: models never move the authoritative simulation. */
export class Ship3DLayer {
  private hulls = new Map<string, THREE.Object3D>();
  private guns = new Map<string, THREE.Object3D>();
  private crew = new Map<string, THREE.Mesh>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private poses = new Map<string, string>();
  private deckMotion = new Map<string, { from: {x:number;y:number}; to: {x:number;y:number}; at:number }>();
  private animation = new UnitAnimationTracker();
  private facing = new CrewFacingTracker();
  private motion = new UnitMotionSmoother();
  private tick = -1;
  // The painted feet are at row 122 / 128, rather than at the texture edge.
  private card = new THREE.PlaneGeometry(60, 60).translate(0, 60*(122/128-.5), 0);

  private constructor(private scene: THREE.Scene, private camera: THREE.Camera,
    private hull: THREE.Object3D, private gun: THREE.Object3D) {}

  static async load(scene: THREE.Scene, camera: THREE.Camera, url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const hull=gltf.scene.getObjectByName('Hull'), gun=gltf.scene.getObjectByName('Gun');
    if(!hull || !gun) throw new Error('Warship GLB must contain Hull and Gun components');
    gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;}});
    return new Ship3DLayer(scene,camera,hull,gun);
  }

  private deckPoint(id: string, now: number) {
    const track=this.deckMotion.get(id)!;
    const t=Math.max(0,Math.min(1,(now-track.at)*SIM_TICKS_PER_SECOND/1000));
    return {x:track.from.x+(track.to.x-track.from.x)*t,y:track.from.y+(track.to.y-track.from.y)*t};
  }

  update(snapshot: GameSnapshot, now: number) {
    if(this.tick!==snapshot.tick){
      this.animation.update(snapshot,now);this.motion.update(snapshot,now);this.facing.update(snapshot);
      const continuous=snapshot.tick===this.tick+1;
      for(const unit of snapshot.units) if(unit.deck){
        const old=this.deckMotion.get(unit.id),to={x:unit.deck.x,y:unit.deck.y};
        this.deckMotion.set(unit.id,{from:continuous&&old?this.deckPoint(unit.id,now):to,to,at:now});
      }
      this.tick=snapshot.tick;
    }
    const liveHulls=new Set<string>(),liveGuns=new Set<string>(),liveCrew=new Set<string>();
    const cardRotation=uprightCrewRotation(this.camera),cameraRight=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0);
    const targets=new Map([...snapshot.units,...snapshot.buildings].map(entity=>[entity.id,entity]));
    for(const ship of snapshot.units.filter(unit=>unit.kind==='warship')){
      liveHulls.add(ship.id);
      let hull=this.hulls.get(ship.id);
      if(!hull){hull=this.hull.clone(true);hull.userData.unitId=ship.id;this.hulls.set(ship.id,hull);this.scene.add(hull);}
      const at=this.motion.position(ship,now),heading=this.motion.heading(ship,now),scale=shipScale(ship);
      hull.position.set(at.x,0,-at.y);hull.rotation.y=heading;hull.scale.setScalar(scale);
      const displayed={...ship,x:at.x,y:at.y,sailing:{...ship.sailing!,heading}};
      for(const item of installedWeapons(snapshot,ship)){
        liveGuns.add(item.id);let gun=this.guns.get(item.id);
        if(!gun){gun=this.gun.clone(true);gun.userData.unitId=ship.id;this.guns.set(item.id,gun);this.scene.add(gun);}
        const pose=mountedWeaponPose(displayed,item)!;
        gun.position.set(pose.pivot.x,shipProfile(ship)!.deckHeight,-pose.pivot.y);
        gun.rotation.y=pose.heading;gun.scale.setScalar(scale);
      }
      for(const unit of snapshot.units.filter(unit=>unit.deck?.shipId===ship.id)){
        liveCrew.add(unit.id);let mesh=this.crew.get(unit.id);
        if(!mesh){mesh=new THREE.Mesh(this.card,new THREE.MeshStandardMaterial({alphaTest:.4,side:THREE.DoubleSide,roughness:1,metalness:0}));mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.unitId=unit.id;this.crew.set(unit.id,mesh);this.scene.add(mesh);}
        const deck=this.deckPoint(unit.id,now),c=Math.cos(heading),s=Math.sin(heading);
        mesh.position.set(at.x+deck.x*c-deck.y*s,shipProfile(ship)!.deckHeight,-at.y-deck.x*s-deck.y*c);
        mesh.quaternion.copy(cardRotation);
        const targetId=attackTargetId(unit.order),aiming=unit.aim && ['attack','attackMove','hold','aim','cast'].includes(unit.order.type);
        const target=aiming?unit.aim:targetId?targets.get(targetId):undefined;
        const frame=this.animation.frame(unit,now),facing=this.facing.facing(unit,heading,cameraRight,target);
        const color=ownerInk(unit.owner),key=`${unit.kind}:${color}:${frame.mode}:${frame.frame}:${facing}`;
        if(this.poses.get(unit.id)!==key){
          let texture=this.textures.get(key);
          if(!texture){const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.translate(64,96);ctx.scale(1.5*facing,1.5);paintFigure(ctx,unit.kind,color,frame,facing);texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.set(key,texture);}
          const material=mesh.material as THREE.MeshStandardMaterial;material.map=texture;material.needsUpdate=true;this.poses.set(unit.id,key);
        }
      }
    }
    this.prune(this.hulls,liveHulls);this.prune(this.guns,liveGuns);this.prune(this.crew,liveCrew,true);
    for(const id of this.deckMotion.keys())if(!liveCrew.has(id)){this.deckMotion.delete(id);this.poses.delete(id);}
  }

  private prune<T extends THREE.Object3D>(map:Map<string,T>,live:Set<string>,dispose=false) {
    for(const [id,object] of map)if(!live.has(id)){this.scene.remove(object);map.delete(id);if(dispose && object instanceof THREE.Mesh)(object.material as THREE.Material).dispose();}
  }

  selectable() { return [...this.hulls.values(),...this.guns.values(),...this.crew.values()]; }
  position(id:string) { return (this.hulls.get(id)??this.crew.get(id))?.position; }

  dispose() {
    for(const objects of [this.hulls,this.guns,this.crew])for(const object of objects.values())this.scene.remove(object);
    for(const mesh of this.crew.values())(mesh.material as THREE.Material).dispose();
    for(const texture of this.textures.values())texture.dispose();this.card.dispose();
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    for(const root of [this.hull,this.gun])root.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
    for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
  }
}
