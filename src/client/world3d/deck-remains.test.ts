import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { deckRemainsMatrix } from './deck-remains';

describe('flat remains use the existing card crop coordinates',()=>{
  it.each([0,Math.PI/2,Math.PI,-Math.PI/2])('keeps all crop corners on the rotated deck at yaw %s',heading=>{
    const tilt=Math.tan(SHIP_CAMERA.tilt),scale=1.7;
    const matrix=deckRemainsMatrix(new Matrix4(),{x:300,y:400,height:42,heading},scale);
    for(const [x,y] of [[-40,-12],[40,-12],[-40,22],[40,22]]){
      const actual=new Vector3(x!,-y!/tilt,0).applyMatrix4(matrix);
      const localX=x!*scale,localY=7+y!*scale;
      expect(actual.x).toBeCloseTo(300+Math.cos(heading)*localX-Math.sin(heading)*localY);
      expect(actual.z).toBeCloseTo(400+Math.sin(heading)*localX+Math.cos(heading)*localY);
      expect(actual.y).toBeCloseTo(42.12);
    }
  });
});
