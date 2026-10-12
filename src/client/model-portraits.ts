/** UI artwork is derived from the current models, never a separate sprite bake. */
/** Raw images are borrowed until the next provider call or clear. The drawing
 * entrypoint pins them through synchronous drawImage, including nested draws. */
type Provider=((key:string,color:string)=>HTMLCanvasElement|undefined)&{
  retain?:(image:HTMLCanvasElement)=>void;
  release?:(image:HTMLCanvasElement)=>void;
};
let provider:Provider|undefined;
let revision=0;
export function modelArtRevision(){return revision;}
export function installModelPortraits(next:Provider|undefined){provider=next;revision++;}
export function drawModelPortrait(ctx:CanvasRenderingContext2D,key:string,x:number,y:number,size:number,color:string){
  const current=provider,image=current?.(key,color);if(!image)return false;
  current?.retain?.(image);
  try{ctx.drawImage(image,x,y,size,size);return true;}finally{current?.release?.(image);}
}
