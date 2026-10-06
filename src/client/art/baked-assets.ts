import { createScratchCanvas } from "./scratch-canvas";
import { resources,type ResourcePhase } from '../resources';

type ImageSource = CanvasImageSource;
const images=new Map<string,ImageSource>();
let assetVersion=0;
export function bakedAssetsVersion(){return assetVersion;}
const requested=new Set<string>();
const tinted=new Map<string,HTMLCanvasElement>();
const loading=new Map<string,Promise<void>>();
export function loadBakedImage(key:string,phase:ResourcePhase=resources.phase):Promise<void>{
  const url=resources.url(`art/${key}.png`);
  if(images.has(key)){if(resources.entries.has(url))void resources.bytes(url,`art/${key}.png`,phase);return Promise.resolve();}
  let pending=loading.get(key);if(pending){void resources.bytes(url,`art/${key}.png`,phase);return pending;}
  requested.add(key);pending=resources.image(resources.url(`art/${key}.png`),`art/${key}.png`,phase).then(image=>{installBakedImage(key,image);}).catch(error=>{requested.delete(key);loading.delete(key);throw error;});loading.set(key,pending);return pending;
}
/** The recorder supplies native Canvas images; browsers load the same deployed assets. */
export function installBakedImage(key:string,image:ImageSource){images.set(key,image);assetVersion++;}
export function bakedImage(key:string):ImageSource|undefined {
  const known=images.get(key);if(known)return known;
  if(typeof Image==="undefined" || requested.has(key))return undefined;
  requested.add(key);
  void loadBakedImage(key).catch(()=>{ requested.add(key); /* Explicit preparation can retry; drawing never hammers a failed URL. */ });
  return undefined;
}
export function tintedBakedImage(key:string,color:string,width:number,height:number) {
  const source=bakedImage(key);if(!source)return undefined;
  const id=`${key}:${color}`;const known=tinted.get(id);if(known)return known;
  const canvas=createScratchCanvas(width,height),ctx=canvas.getContext("2d")!;
  ctx.drawImage(source,0,0,width,height);
  ctx.globalCompositeOperation="source-in";ctx.fillStyle=color;ctx.fillRect(0,0,width,height);
  if(tinted.size>=64)tinted.delete(tinted.keys().next().value!);
  tinted.set(id,canvas);return canvas;
}
