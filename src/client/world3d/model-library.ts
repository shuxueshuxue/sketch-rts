import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resources,type ResourcePhase } from '../resources';
import { BUILDING_DEFS } from '../../shared/catalog';
import { SHIP_KINDS,isShipKind } from '../../shared/ship-geometry';
import { installedWeapons,mountedWeaponPose } from '../../shared/ship-equipment';
import type { GameSnapshot } from '../../shared/types';

export const SITE_MODELS=['citadel','shop','camp','well','statue','beacon','fort-lance','fort-flame','fort-mortar','fort-ward','fort-wall'];
export const matchModelKeys=[...SHIP_KINDS.map(kind=>`ships/${kind}`),...new Set([...Object.keys(BUILDING_DEFS),...SITE_MODELS])].map(kind=>kind.startsWith('ships/')?kind:`buildings/${kind}`);
export function snapshotModelKeys(snapshot:GameSnapshot){return [...new Set([...snapshot.units.filter(unit=>isShipKind(unit.kind)).map(unit=>`ships/${unit.kind}`),...snapshot.units.filter(unit=>isShipKind(unit.kind)).flatMap(ship=>installedWeapons(snapshot,ship).flatMap(item=>{const weapon=mountedWeaponPose(ship,item);return weapon?[`ships/${weapon.art}`]:[];})),...snapshot.buildings.map(building=>`buildings/${building.kind}`),...(snapshot.shops?.length?['buildings/shop']:[]),...(snapshot.mercenaryCamps.length?['buildings/camp']:[])])];}

export class ModelLibrary {
  private models=new Map<string,THREE.Object3D>();
  private pending=new Map<string,Promise<void>>();
  async prepare(keys:readonly string[],phase:ResourcePhase){await Promise.all(keys.map(key=>this.load(key,phase)));}
  private load(key:string,phase:ResourcePhase){
    const url=resources.url(`art/world3d/${key}.glb`);
    if(this.models.has(key)){void resources.bytes(url,key,phase);return Promise.resolve();}
    const data=resources.bytes(url,key,phase);
    let pending=this.pending.get(key);if(!pending){pending=(async()=>{
      const bytes=await data;const result=await new GLTFLoader().parseAsync(bytes,resources.url('art/world3d/'));
      result.scene.updateMatrixWorld(true);result.scene.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;}});
      this.models.set(key,result.scene);
    })().catch(error=>{this.pending.delete(key);throw error;});this.pending.set(key,pending);}return pending;
  }
  component(key:string,name:string){const root=this.models.get(key);if(!root)return undefined;const source=root.getObjectByName(name);if(!source)return undefined;const object=source.clone(true);object.position.set(0,0,0);object.updateMatrixWorld(true);return object;}
  portraitModel(key:string){return this.models.get(key);}
  dispose(){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();for(const root of this.models.values())root.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const mat of Array.isArray(object.material)?object.material:[object.material])materials.add(mat);}});for(const item of geometries)item.dispose();for(const item of materials)item.dispose();this.models.clear();this.pending.clear();}
}
/** World actors and UI share decoded geometry as well as the resource request. */
export const worldModels=new ModelLibrary();
