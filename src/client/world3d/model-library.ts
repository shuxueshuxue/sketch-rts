import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resources,type ResourcePhase } from '../resources';
import { BUILDING_DEFS } from '../../shared/catalog';
import { SHIP_KINDS,isShipKind } from '../../shared/ship-geometry';
import { installedWeapons,mountedWeaponPose } from '../../shared/ship-equipment';
import type { GameSnapshot } from '../../shared/types';
import { attachShipRigParts } from './sail-rig';

export const SITE_MODELS=['citadel','shop','camp','well','statue','beacon','fort-lance','fort-flame','fort-mortar','fort-ward','fort-wall'];
export const matchModelKeys=[...SHIP_KINDS.map(kind=>`ships/${kind}`),...new Set([...Object.keys(BUILDING_DEFS),...SITE_MODELS])].map(kind=>kind.startsWith('ships/')?kind:`buildings/${kind}`);
export function snapshotModelKeys(snapshot:GameSnapshot){return [...new Set([...snapshot.units.filter(unit=>isShipKind(unit.kind)).map(unit=>`ships/${unit.kind}`),...snapshot.units.filter(unit=>isShipKind(unit.kind)).flatMap(ship=>installedWeapons(snapshot,ship).flatMap(item=>{const weapon=mountedWeaponPose(ship,item);return weapon?[`ships/${weapon.art}`]:[];})),...snapshot.buildings.map(building=>`buildings/${building.kind}`),...(snapshot.shops?.length?['buildings/shop']:[]),...(snapshot.mercenaryCamps.length?['buildings/camp']:[])])];}

export class ModelLibrary {
  private models=new Map<string,THREE.Object3D>();
  private parts=new Map<string,Map<string,THREE.Object3D>>();
  private pending=new Map<string,Promise<void>>();
  private generation=0;
  constructor(private loader:Pick<GLTFLoader,'parseAsync'>=new GLTFLoader()){}
  async prepare(keys:readonly string[],phase:ResourcePhase){await Promise.all(keys.map(key=>this.load(key,phase)));}
  private load(key:string,phase:ResourcePhase){
    const url=resources.url(`art/world3d/${key}.glb`);
    if(this.models.has(key)){resources.recordUse(url,phase);return Promise.resolve();}
    let pending=this.pending.get(key);if(pending){resources.recordUse(url,phase);return pending;}
    const data=resources.bytes(url,key,phase),generation=this.generation;pending=(async()=>{
      const bytes=await data;
      // Disposal can happen while either the request or parsing is pending.
      if(generation!==this.generation)return;
      const result=await this.loader.parseAsync(bytes,resources.url('art/world3d/'));
      if(generation!==this.generation){disposeModels([result.scene]);return;}
      try{
        attachShipRigParts(result.scene);result.scene.updateMatrixWorld(true);
        const parts=new Map<string,THREE.Object3D>();
        result.scene.traverse(object=>{if(object.name&&!parts.has(object.name))parts.set(object.name,object);if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;}});
        this.models.set(key,result.scene);this.parts.set(key,parts);
      }catch(error){disposeModels([result.scene]);throw error;}
    })().finally(()=>{if(this.pending.get(key)===pending)this.pending.delete(key);resources.releaseBytes(url,data);});this.pending.set(key,pending);return pending;
  }
  component(key:string,name:string){const source=this.parts.get(key)?.get(name);if(!source)return undefined;const object=source.clone(true);object.position.set(0,0,0);object.updateMatrixWorld(true);return object;}
  portraitModel(key:string){return this.models.get(key);}
  cacheStats(){return{models:this.models.size,pending:this.pending.size};}
  dispose(){this.generation++;disposeModels(this.models.values());this.models.clear();this.parts.clear();this.pending.clear();}
}
function disposeModels(roots:Iterable<THREE.Object3D>){
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  for(const root of roots)root.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const mat of Array.isArray(object.material)?object.material:[object.material])materials.add(mat);}});
  for(const material of materials){
    for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
    if(material instanceof THREE.ShaderMaterial)for(const uniform of Object.values(material.uniforms))for(const value of Array.isArray(uniform.value)?uniform.value:[uniform.value])if(value instanceof THREE.Texture)textures.add(value);
  }
  const images=new Set<{close:()=>void}>();
  for(const texture of textures){for(const image of Array.isArray(texture.image)?texture.image:[texture.image])if(image&&typeof image.close==='function')images.add(image);texture.dispose();}
  for(const image of images)image.close();
  for(const item of geometries)item.dispose();for(const item of materials)item.dispose();
}
/** World actors and UI share decoded geometry as well as the resource request. */
export const worldModels=new ModelLibrary();
