import { bakedImage,tintedBakedImage } from "./baked-assets";

export function drawBakedBuilding(ctx:CanvasRenderingContext2D,kind:string,at:{x:number;y:number},size:number,color:string) {
  const source=bakedImage(`buildings/${kind}`),team=tintedBakedImage(`buildings/${kind}-team`,color,256,256);
  if(!source || !team)return false;
  ctx.save();
  ctx.drawImage(source,at.x-size,at.y-size,size*2,size*2);
  ctx.drawImage(team,at.x-size,at.y-size,size*2,size*2);
  ctx.restore();return true;
}
