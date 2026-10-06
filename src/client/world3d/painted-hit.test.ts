import {describe,it,expect} from 'vitest';
import {Texture,Vector2} from 'three';
import {paintedHit} from './painted-hit';
describe('cutout actor selection',()=>{
  it('lets transparent sprite padding pass through to the deck while accepting the same pixels as the GPU alpha test',()=>{
    const texture=new Texture();texture.userData.alpha={width:2,height:2,pixels:new Uint8Array([0,101,102,255])};
    expect(paintedHit(texture,new Vector2(.25,.75))).toBe(false);
    expect(paintedHit(texture,new Vector2(.75,.75))).toBe(false);
    expect(paintedHit(texture,new Vector2(.25,.25))).toBe(true);
    expect(paintedHit(texture,new Vector2(.75,.25))).toBe(true);
  });
});
