/** Exact existing CPU picking contract: base alpha >=102, not GPU filtering.
 * Store bits in the vertically flipped GPU layer coordinate system. */
const LITTLE_ENDIAN=new Uint32Array(new Uint8Array([1,0,0,0]).buffer)[0]===1;
const ALPHA_WORD_THRESHOLD=0x66000000;
export function packCardPickMask(rgba:Uint8ClampedArray,width:number,height:number,flipY=true){
 const pixels=width*height,mask=new Uint8Array(Math.ceil(pixels/8));
 if(width%8===0){
  if(LITTLE_ENDIAN&&Number.isInteger(width)&&width>=0&&Number.isInteger(height)&&height>=0&&Number.isSafeInteger(pixels)&&rgba.byteOffset%4===0&&rgba.byteLength>=pixels*4){
   const words=new Uint32Array(rgba.buffer,rgba.byteOffset,pixels);
   for(let y=0;y<height;y++){
    let source=y*width,destination=(flipY?height-1-y:y)*(width/8);
    for(let x=0;x<width;x+=8,source+=8,destination++){
     const w0=words[source]!,w1=words[source+1]!,w2=words[source+2]!,w3=words[source+3]!,w4=words[source+4]!,w5=words[source+5]!,w6=words[source+6]!,w7=words[source+7]!;
     // Ignore RGB beneath alpha zero. The fresh mask already contains zero.
     if(((w0|w1|w2|w3|w4|w5|w6|w7)>>>24)===0)continue;
     // Uint32 values remain unsigned: alpha128..255 must not become negative.
     mask[destination]=Number(w0>=ALPHA_WORD_THRESHOLD)|(Number(w1>=ALPHA_WORD_THRESHOLD)<<1)|(Number(w2>=ALPHA_WORD_THRESHOLD)<<2)|(Number(w3>=ALPHA_WORD_THRESHOLD)<<3)|
      (Number(w4>=ALPHA_WORD_THRESHOLD)<<4)|(Number(w5>=ALPHA_WORD_THRESHOLD)<<5)|(Number(w6>=ALPHA_WORD_THRESHOLD)<<6)|(Number(w7>=ALPHA_WORD_THRESHOLD)<<7);
    }
   }
  }else{
   // Preserve byte access on BE hosts and unaligned or incomplete subarrays.
   for(let y=0;y<height;y++){
    let source=y*width*4+3,destination=(flipY?height-1-y:y)*(width/8);
    for(let x=0;x<width;x+=8,source+=32,destination++)mask[destination]=
     Number(rgba[source]!>=102)|(Number(rgba[source+4]!>=102)<<1)|(Number(rgba[source+8]!>=102)<<2)|(Number(rgba[source+12]!>=102)<<3)|
     (Number(rgba[source+16]!>=102)<<4)|(Number(rgba[source+20]!>=102)<<5)|(Number(rgba[source+24]!>=102)<<6)|(Number(rgba[source+28]!>=102)<<7);
   }
  }
 }else{
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgba[(y*width+x)*4+3]!>=102){const pixel=(flipY?height-1-y:y)*width+x;mask[pixel>>>3]!|=1<<(pixel&7);}
 }
 return mask;
}
export function cardMaskHit(mask:Uint8Array,width:number,height:number,uv:{x:number;y:number}|undefined){
 if(!uv||!Number.isFinite(uv.x)||!Number.isFinite(uv.y)||uv.x<0||uv.y<0||uv.x>1||uv.y>1)return false;
 const x=Math.min(width-1,Math.floor(uv.x*width)),y=Math.min(height-1,Math.floor(uv.y*height)),pixel=y*width+x;
 return ((mask[pixel>>>3]??0)&(1<<(pixel&7)))!==0;
}
