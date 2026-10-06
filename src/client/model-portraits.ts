/** UI artwork is derived from the current models, never a separate sprite bake. */
type Provider=(key:string,color:string)=>HTMLCanvasElement|undefined;
let provider:Provider|undefined;
let revision=0;
export function modelArtRevision(){return revision;}
export function installModelPortraits(next:Provider|undefined){provider=next;revision++;}
export function drawModelPortrait(ctx:CanvasRenderingContext2D,key:string,x:number,y:number,size:number,color:string){
  const image=provider?.(key,color);if(!image)return false;
  ctx.drawImage(image,x,y,size,size);return true;
}
