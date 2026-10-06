import type { Texture } from 'three';
/** Three's triangle ray test does not sample alpha. Selection must use the same
 * cutout as the fragment shader, or a soldier's transparent tile masks a ship. */
export function paintedHit(texture:Texture|undefined,uv:{x:number;y:number}|undefined){
  const mask=texture?.userData.alpha as {width:number;height:number;pixels:Uint8Array}|undefined;
  if(!mask||!uv)return true;
  const x=Math.min(mask.width-1,Math.max(0,Math.floor(uv.x*mask.width))),y=Math.min(mask.height-1,Math.max(0,Math.floor((1-uv.y)*mask.height)));
  return mask.pixels[y*mask.width+x]!>=102;
}
