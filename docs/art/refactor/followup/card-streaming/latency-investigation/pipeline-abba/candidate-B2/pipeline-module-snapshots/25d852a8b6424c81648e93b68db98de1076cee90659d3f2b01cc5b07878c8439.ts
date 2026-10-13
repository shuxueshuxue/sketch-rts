/** Pixel bounds of changed RGBA components, with an exclusive right/bottom edge.
 * Transparent pixels still carry RGB: alpha-only bounds are not lossless. */
export type CardUploadRegion={left:number;top:number;right:number;bottom:number};

/** Update the existing full-domain raster and return the smallest rectangle that
 * restores its GPU copy. Old marks disappearing to zero are changes too. */
export function updateCardPixels(previous:Uint8Array,next:Uint8Array|Uint8ClampedArray,width:number,height:number):CardUploadRegion|null {
 if(width<1||height<1||!Number.isInteger(width)||!Number.isInteger(height)||previous.byteLength!==width*height*4||next.byteLength!==previous.byteLength)throw new Error('Invalid card raster dimensions.');
 let left=width,top=height,right=0,bottom=0;
 // Raster buffers normally have aligned offsets. The byte path also supports a
 // caller's subarray without creating an additional full-size pixel copy.
 if(previous.byteOffset%4===0&&next.byteOffset%4===0){
  const a=new Uint32Array(previous.buffer,previous.byteOffset,width*height),b=new Uint32Array(next.buffer,next.byteOffset,width*height);
  for(let y=0;y<height;y++){
   const start=y*width;let first=0;
   while(first<width&&a[start+first]===b[start+first])first++;
   if(first===width)continue;
   let last=width-1;while(last>first&&a[start+last]===b[start+last])last--;
   left=Math.min(left,first);right=Math.max(right,last+1);top=Math.min(top,y);bottom=y+1;
  }
 }else{
  const same=(pixel:number)=>{const offset=pixel*4;return previous[offset]===next[offset]&&previous[offset+1]===next[offset+1]&&previous[offset+2]===next[offset+2]&&previous[offset+3]===next[offset+3];};
  for(let y=0;y<height;y++){
   const start=y*width;let first=0;while(first<width&&same(start+first))first++;
   if(first===width)continue;
   let last=width-1;while(last>first&&same(start+last))last--;
   left=Math.min(left,first);right=Math.max(right,last+1);top=Math.min(top,y);bottom=y+1;
  }
 }
 if(top===height)return null;
 // Copy one contiguous band, rather than allocating a subarray for every row.
 // Components outside the rectangle already match, so this preserves the same
 // full raster while the GPU upload can still use the tighter pixel bounds.
 const start=top*width*4;previous.set(next.subarray(start,bottom*width*4),start);
 return{left,top,right,bottom};
}
