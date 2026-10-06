/** Compact UI icons retain the same authored ship and weapon as the atlases.
 * UI portraits never request the multi-direction world atlases. */
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {mkdir,writeFile} from 'node:fs/promises';
import {setScratchCanvasFactory} from '../../src/client/art/scratch-canvas';
import {installBakedImage} from '../../src/client/art/baked-assets';
import {drawBakedShip,drawShipWeapon} from '../../src/client/art/baked-ships';
import {SHIP_KINDS,shipProfile} from '../../src/shared/ship-geometry';
import type {Unit} from '../../src/shared/types';
setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
await mkdir('public/art/portraits',{recursive:true});
for(const kind of SHIP_KINDS){
  for(const layer of ['base','upper',...(['warship','bombardShip','fireShip'].includes(kind)?['weapon']:[])])installBakedImage(`ships/${kind}-${layer}`,await loadImage(`public/art/ships/${kind}-${layer}.png`) as unknown as CanvasImageSource);
  const canvas=createCanvas(256,256),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D,ship={kind,x:0,y:0} as Unit,scale=256/(shipProfile(ship)!.length+20),point={x:128,y:256*.66};
  drawBakedShip(ctx,ship,point,'base',scale);drawBakedShip(ctx,ship,point,'upper',scale);drawShipWeapon(ctx,{...ship,deckScale:scale},point,[]);
  await writeFile(`public/art/portraits/${kind}.png`,canvas.toBuffer('image/png'));
}
