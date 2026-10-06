import { createScratchCanvas } from "./scratch-canvas";

type ImageSource = CanvasImageSource;
const images=new Map<string,ImageSource>();
let assetVersion=0;
export function bakedAssetsVersion(){return assetVersion;}
const requested=new Set<string>();
const tinted=new Map<string,HTMLCanvasElement>();
/** The recorder supplies native Canvas images; browsers load the same deployed assets. */
export function installBakedImage(key:string,image:ImageSource){images.set(key,image);assetVersion++;}
export function bakedImage(key:string):ImageSource|undefined {
  const known=images.get(key);if(known)return known;
  if(typeof Image==="undefined" || requested.has(key))return undefined;
  requested.add(key);
  const image=new Image();
  image.onload=()=>{images.set(key,image);assetVersion++;};
  image.onerror=()=>{ /* retain the request marker; the fallback remains available */ };
  const base=(import.meta as ImportMeta & {env?:{BASE_URL?:string}}).env?.BASE_URL ?? "/";
  image.src=`${base}art/${key}.png`;
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
