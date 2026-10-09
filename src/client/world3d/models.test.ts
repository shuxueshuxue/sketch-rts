import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Box3,Vector3,Mesh} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {matchModelKeys} from './model-library';
import {SHIP_KINDS,shipProfile} from '../../shared/ship-geometry';
import type {Unit} from '../../shared/types';
import {createUnit} from '../../shared/map';
import {shipMounts,SHIP_WEAPONS} from '../../shared/ship-equipment';

describe('production authored models',()=>{
  it('keeps every accepted weapon clear of masts throughout its firing arc and recoil',async()=>{
    const bounds=new Map<string,Box3>();
    for(const art of ['warship','bombardShip','fireShip']){
      const bytes=readFileSync(`public/art/world3d/ships/${art}.glb`),scene=(await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'/')).scene;
      const gun=scene.getObjectByName('Gun')!.clone(true);gun.position.set(0,0,0);gun.updateMatrixWorld(true);bounds.set(art,new Box3().setFromObject(gun));
    }
    for(const kind of SHIP_KINDS){
      const ship=createUnit(`clearance-${kind}`,'player',kind,0,0);ship.deckScale=1;
      for(const mount of shipMounts(ship))for(const weapon of mount.accepts){
        const art=SHIP_WEAPONS[weapon].art,box=bounds.get(art)!,recoil=art==='fireShip'?0:4;
        for(const mast of shipProfile(ship)!.obstacles.filter(obstacle=>obstacle.type==='mast'))for(let step=0;step<=70;step++){
          const heading=mount.bearing-mount.halfArc+2*mount.halfArc*step/70,c=Math.cos(heading),s=Math.sin(heading),dx=mast.x-mount.x,dy=mast.y-mount.y;
          const x=dx*c+dy*s,y=-dx*s+dy*c;
          const gap=Math.hypot(Math.max(box.min.x-recoil-x,0,x-box.max.x),Math.max(box.min.z-y,0,y-box.max.z))-mast.radius;
          expect(gap,`${kind} ${mount.id} ${weapon} mast ${mast.x} at ${heading}`).toBeGreaterThan(0);
        }
      }
    }
  });
  it('loads all 32 self-contained models and preserves hull dimensions and independently mounted weapons',async()=>{
    expect(matchModelKeys).toHaveLength(32);
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
});
