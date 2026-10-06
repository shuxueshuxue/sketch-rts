import {createScratchCanvas} from './scratch-canvas';
type Art={canvas:HTMLCanvasElement;x:number;y:number;width:number;height:number};
const cache=new Map<string,Art>();
/** Measure painted pixels once, then fit the subject to any UI rectangle. */
export function drawFittedPortrait(ctx:CanvasRenderingContext2D,key:string,paint:(ctx:CanvasRenderingContext2D)=>void,x:number,y:number,width:number,height:number,bust=false){
  let art=cache.get(key);
  if(!art){
    const canvas=createScratchCanvas(512,512),brush=canvas.getContext('2d')!;
    brush.translate(256,256);brush.scale(4,4);paint(brush);
    const data=brush.getImageData(0,0,512,512).data;
    const bounds=(limit=512)=>{let left=512,top=512,right=0,bottom=0;
      for(let py=0;py<limit;py++)for(let px=0;px<512;px++)if(data[(py*512+px)*4+3]!>8){left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
      return{x:left,y:top,width:Math.max(1,right-left+1),height:Math.max(1,bottom-top+1)};
    };
    let box=bounds();if(bust)box=bounds(Math.round(box.y+box.height*.65));
    // Retain only visible pixels, not the large transparent working surface.
    const cropped=createScratchCanvas(box.width,box.height);
    cropped.getContext('2d')!.drawImage(canvas,box.x,box.y,box.width,box.height,0,0,box.width,box.height);
    art={canvas:cropped,x:0,y:0,width:box.width,height:box.height};
    let pixels=[...cache.values()].reduce((sum,value)=>sum+value.width*value.height,0);
    while(cache.size && (cache.size>=96 || pixels+box.width*box.height>12*1024*1024)){
      const oldest=cache.keys().next().value!,value=cache.get(oldest)!;pixels-=value.width*value.height;cache.delete(oldest);
    }
    cache.set(key,art);
  }
  const scale=Math.min(width/art.width,height/art.height)*.94,w=art.width*scale,h=art.height*scale;
  ctx.drawImage(art.canvas,art.x,art.y,art.width,art.height,x+(width-w)/2,y+(height-h)/2,w,h);
}
