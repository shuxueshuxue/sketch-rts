/** Exact existing CPU picking contract: base alpha >=102, not GPU filtering.
 * Store bits in the vertically flipped GPU layer coordinate system. */
export function packCardPickMask(rgba:Uint8ClampedArray,width:number,height:number){
 const mask=new Uint8Array(Math.ceil(width*height/8));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]!>=102){const pixel=(height-1-y)*width+x;mask[pixel>>>3]!|=1<<(pixel&7);}
 return mask;
}
export function cardMaskHit(mask:Uint8Array,width:number,height:number,uv:{x:number;y:number}|undefined){
 if(!uv||!Number.isFinite(uv.x)||!Number.isFinite(uv.y)||uv.x<0||uv.y<0||uv.x>1||uv.y>1)return false;
 const x=Math.min(width-1,Math.floor(uv.x*width)),y=Math.min(height-1,Math.floor(uv.y*height)),pixel=y*width+x;
 return ((mask[pixel>>>3]??0)&(1<<(pixel&7)))!==0;
}
