/** Isolate scratch-canvas painting/readback. This is a microbenchmark, not FPS. */
import { paintFigure } from '../src/client/art/painted-units';
import { UNIT_DEFS } from '../src/shared/catalog';
import type { UnitKind } from '../src/shared/types';
import type { UnitAnimationFrame } from '../src/client/unit-animation';

export async function rasterProfile() {
  const kinds = (Object.keys(UNIT_DEFS) as UnitKind[]).filter(kind => !UNIT_DEFS[kind].naval);
  const poses: UnitAnimationFrame[] = [
    {mode:'idle',frame:2}, {mode:'walk',frame:3},
    {mode:'attack',frame:0,variant:1}, {mode:'cast',frame:0},
  ];
  const size=512, buffers=[false,true].map(willReadFrequently=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
    return {canvas,ctx:canvas.getContext('2d',{willReadFrequently})!,willReadFrequently};
  });
  const pixels=new Uint8Array(size*size*4);
  function sample(index:number,kind:UnitKind,pose:UnitAnimationFrame) {
    const {ctx}=buffers[index]!;
    const start=performance.now();
    ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(4,4);ctx.translate(64,64);
    paintFigure(ctx,kind,'#486c78',pose,1);ctx.restore();
    const painted=performance.now(),rgba=ctx.getImageData(0,0,size,size).data,read=performance.now();
    for(let y=0;y<size;y++)pixels.set(rgba.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
    const end=performance.now();
    return {paintMs:painted-start,readMs:read-painted,copyMs:end-read,totalMs:end-start,rgba};
  }
  for(let i=0;i<8;i++)for(let buffer=0;buffer<2;buffer++)sample(buffer,kinds[i%kinds.length]!,poses[i%4]!);
  const runs=[];
  // ABBA order limits simple warm-up/order bias. Both arms use identical poses.
  for(const index of [0,1,1,0]) {
    const values=[];
    for(let i=0;i<kinds.length;i++){
      const {rgba:_,...timing}=sample(index,kinds[i]!,poses[i%4]!);values.push(timing);
    }
    runs.push({willReadFrequently:buffers[index]!.willReadFrequently,values});
    await new Promise(requestAnimationFrame);
  }
  let changedChannels=0,maximum=0,sum=0,channels=0,alphaMaximum=0,alphaSum=0,compositeMaximum=0,compositeSum=0;
  const reviewKinds:UnitKind[]=['footman','archer','knight','priest','summoner','redDragon','ogreMage','murlocHunter'];
  const review=document.createElement('canvas');review.width=1536;review.height=1152;
  const reviewBrush=review.getContext('2d')!;reviewBrush.fillStyle='#d0c7b1';reviewBrush.fillRect(0,0,review.width,review.height);
  const panel=document.createElement('canvas');panel.width=panel.height=size;const panelBrush=panel.getContext('2d')!;
  const paper=[208,199,177];
  const occupied=[];
  for(let i=0;i<kinds.length;i++) {
    const a=sample(0,kinds[i]!,poses[i%4]!).rgba,b=sample(1,kinds[i]!,poses[i%4]!).rgba;
    for(let p=0;p<a.length;p++){const difference=Math.abs(a[p]!-b[p]!);if(difference)changedChannels++;maximum=Math.max(maximum,difference);sum+=difference;channels++;}
    const differenceImage=reviewKinds.includes(kinds[i]!)?new Uint8ClampedArray(a.length):undefined;
    for(let p=0;p<a.length;p+=4){
      const aa=a[p+3]!/255,ba=b[p+3]!/255,alphaDifference=Math.abs(a[p+3]!-b[p+3]!);
      alphaMaximum=Math.max(alphaMaximum,alphaDifference);alphaSum+=alphaDifference;
      for(let c=0;c<3;c++){
        const difference=Math.abs(a[p+c]!*aa+paper[c]!*(1-aa)-b[p+c]!*ba-paper[c]!*(1-ba));
        compositeMaximum=Math.max(compositeMaximum,difference);compositeSum+=difference;
        if(differenceImage)differenceImage[p+c]=Math.min(255,difference*8);
      }
      if(differenceImage)differenceImage[p+3]=255;
    }
    const reviewIndex=reviewKinds.indexOf(kinds[i]!);
    if(reviewIndex>=0){
      const ox=(reviewIndex%2)*768,oy=Math.floor(reviewIndex/2)*288;
      reviewBrush.fillStyle='#342c28';reviewBrush.font='15px sans-serif';reviewBrush.fillText(`${kinds[i]} · false / true / paper diff ×8`,ox+12,oy+20);
      for(const [column,pixels] of [a,b,differenceImage!].entries()){
        panelBrush.putImageData(new ImageData(pixels,size,size),0,0);reviewBrush.drawImage(panel,ox+column*256,oy+26,256,256);
      }
    }
    let left=size,top=size,right=-1,bottom=-1;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(a[(y*size+x)*4+3]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    occupied.push({kind:kinds[i],sourcePixels:size*size,inkWidth:Math.max(0,right-left+1),inkHeight:Math.max(0,bottom-top+1)});
  }
  return {method:'Same 512px authored poses, pooled scratch canvas. Eight warmup paints per arm, ABBA order, one of four fixed poses per land unit kind. Painting, synchronous RGBA readback and layer row copy measured separately. No simulation or WebGL scene rendering; not a frame-rate claim.',kinds,runs,occupied,pixelComparison:{changedChannels,maximum,mean:sum/channels,channels,alphaMaximum,alphaMean:alphaSum/(channels/4),compositeMaximum,compositeMean:compositeSum/(channels/4*3)},image:review.toDataURL('image/png'),userAgent:navigator.userAgent};
}
Object.assign(window,{rasterProfile});
