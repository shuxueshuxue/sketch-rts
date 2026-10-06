import {describe,it,expect} from 'vitest';
import {OrthographicCamera,Vector3} from 'three';
import {configureWorldCamera,projectWorld,screenOnPlane} from './projection';
import {SHIP_KINDS,shipProfile,localToWorld} from '../../shared/ship-geometry';
import type {Unit} from '../../shared/types';

describe('shared map and GPU coordinates',()=>{
  it('matches map pixels and ray-inverts deck points under pan, zoom, resize and every ship heading',()=>{
    for(const view of [{x:0,y:0,width:390,height:844,zoom:.6},{x:620,y:500,width:1600,height:900,zoom:1.8}]){
      const camera=new OrthographicCamera();configureWorldCamera(camera,view);
      for(const kind of SHIP_KINDS)for(let heading=0;heading<Math.PI*2;heading+=Math.PI/4){
        const ship={kind,x:view.x+200,y:view.y+200,sailing:{heading}} as Unit,point=localToWorld(ship,{x:14,y:-9});
        for(const height of [0,shipProfile(ship)!.deckHeight]){
          const ndc=new Vector3(point.x,height,point.y).project(camera),pixel={x:(ndc.x+1)*view.width/2,y:(1-ndc.y)*view.height/2},expected=projectWorld(view,point,height);
          expect(pixel.x).toBeCloseTo(expected.x,6);expect(pixel.y).toBeCloseTo(expected.y,6);
          const inverse=screenOnPlane(camera,view,pixel,height)!;expect(inverse.x).toBeCloseTo(point.x,6);expect(inverse.y).toBeCloseTo(point.y,6);
        }
      }
    }
  });
});
