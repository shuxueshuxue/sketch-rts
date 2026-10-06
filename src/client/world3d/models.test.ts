import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Box3,Vector3,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {matchModelKeys} from './model-library';
import {SHIP_KINDS,shipProfile} from '../../shared/ship-geometry';
import {loadImage} from '@napi-rs/canvas';
import type {Unit} from '../../shared/types';

describe('production authored models',()=>{
  it('loads all 31 self-contained models and preserves hull dimensions and independently mounted weapons',async()=>{
    expect(matchModelKeys).toHaveLength(31);
    for(const key of matchModelKeys){
      const bytes=readFileSync(`public/art/world3d/${key}.glb`),model=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'/')).scene;
      model.updateMatrixWorld(true);const name=key.startsWith('ships/')?'Hull':'Building',part=model.getObjectByName(name)!;expect(part,key).toBeTruthy();
      const bounds=new Box3().setFromObject(part),size=bounds.getSize(new Vector3());expect(size.x,key).toBeGreaterThan(10);expect(size.y,key).toBeGreaterThan(10);expect(size.z,key).toBeGreaterThan(10);
      let vertices=0;part.traverse(object=>{if(object instanceof Mesh){vertices+=object.geometry.getAttribute('position').count;expect(object.geometry.getAttribute('normal')).toBeTruthy();}});expect(vertices).toBeGreaterThan(50);
      if(key.startsWith('ships/')){
        const kind=key.split('/')[1] as Unit['kind'],profile=shipProfile({kind,deckScale:1} as Unit)!;
        expect(size.x,key).toBeGreaterThanOrEqual(profile.length*.98);expect(size.z,key).toBeGreaterThanOrEqual(profile.beam*.98);
        expect(Boolean(model.getObjectByName('Gun'))).toBe(['warship','bombardShip','fireShip'].includes(kind));
      }
    }
  });
  it('uses compact consistent ship portraits rather than fetching direction atlases for a button',async()=>{
    for(const kind of SHIP_KINDS){const bytes=readFileSync(`public/art/portraits/${kind}.png`),image=await loadImage(bytes);expect([image.width,image.height]).toEqual([256,256]);expect(bytes.byteLength).toBeLessThan(100_000);}
  });
});
