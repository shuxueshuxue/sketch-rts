/** Restrained warm light / cool shadow, shared by every painted asset. */
import { type Brush, type XY, polygon, line, lighter } from './kit';
export const INK='#292b29', STEEL='#8d9897', EDGE='#d0cbbc', SHADE='#525e60';
export const SKIN='#ba9575', HIDE='#665342', BOOT='#373631', LINEN='#c9bda0';
type Surface = 'cloth-metal' | 'hide-stone';
/** Glaze and dry-brush grain share one implementation and two authored finishes.
 * Bounds use a scalar pass; grain is batched into two paths without dropping marks. */
export function paintedPlane(b:Brush,p:number[][],fill:string,edge=INK,w=.55,surface:Surface='cloth-metal'){
  polygon(b,p,fill,edge,w);
  if(fill==='transparent')return;
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const point of p){x=Math.min(x,point[0]!);y=Math.min(y,point[1]!);right=Math.max(right,point[0]!);bottom=Math.max(bottom,point[1]!);}
  const ww=right-x,hh=bottom-y, organic=surface==='hide-stone';
  if(!organic&&(ww<=3||hh<=5))return;
  b.save();b.clip();
  const glaze=b.createLinearGradient(x,y,right,bottom);
  glaze.addColorStop(0,organic?'#e4d3ac26':'#f4dfb53a');
  glaze.addColorStop(organic?.45:.38,organic?'#e4d3ac00':'#f4dfb500');
  glaze.addColorStop(1,organic?'#1d29312d':'#182c3a48');
  if(!organic&&(fill===STEEL||fill===EDGE)){glaze.addColorStop(.16,'#fff0ce55');glaze.addColorStop(.23,'#fff0ce00');}
  b.fillStyle=glaze;b.fillRect(x,y,ww,hh);
  const count=Math.min(organic?40:22,ww*hh/(organic?10:8));
  for(let tone=0;tone<2;tone++){
    b.beginPath();
    for(let i=0;i<count;i++){
      if(Number(i%(organic?2:3)!==0)!==tone)continue;
      const a=Math.sin(i*12.31+(organic?x:x*9.13+y*3.27))*43758.5453;
      const d=organic?Math.sin(i*7.7+y)*43758.5453:Math.sin(i*7.71+y*8.1)*19283.11;
      const px=x+(a-Math.floor(a))*ww,py=y+(d-Math.floor(d))*hh;
      b.moveTo(px,py);b.lineTo(px+(organic?1:.5),py+(organic?.7:1.3));
    }
    b.strokeStyle=organic?(tone?'#e5dac024':'#252d2924'):(tone?'#e5d5b026':'#232b2826');b.lineWidth=organic?.45:.4;b.stroke();
  }
  b.restore();
  if(organic)line(b,[p[0]!,p[1]!,p[2]!],lighter(fill,.25),.8);
}
export const creaturePlane=(b:Brush,p:number[][],fill:string)=>paintedPlane(b,p,fill,'#30312e',.65,'hide-stone');
export const segment=(b:Brush,a:XY,z:XY,width:number,color:string,lit:boolean)=>{
  line(b,[a,z],INK,width+1.1); line(b,[a,z],color,width);
  if(lit) line(b,[[a[0]-.65,a[1]],[z[0]-.65,z[1]-.7]],lighter(color,.22),Math.max(.55,width*.22));
};

/** Inventory and quiet remains retain their authored value ranges. */
export const ITEM_MATERIAL = Object.freeze({ ink:'#303738',paper:'#d9c9a7',gold:'#b7a274',steel:'#a8b3ad',leather:'#80644c' });
export const REMAINS_MATERIAL = Object.freeze({ ink:'#555247',wash:'#929082',light:'#aaa594',dark:'#6b6c60' });
