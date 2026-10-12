/** Reusable human anatomical parts, in authored rig coordinates. */
import { type Brush, type XY, line, ellipse } from './kit';
import { paintedPlane as poly, segment as seg, SKIN, STEEL, EDGE, SHADE, BOOT } from './materials';
export function hand(b:Brush,p:XY){poly(b,[[p[0]-1.5,p[1]-1.5],[p[0]+1,p[1]-1.7],[p[0]+1.7,p[1]+1],[p[0]-.6,p[1]+2]],SKIN);}
export function arm(b:Brush,shoulder:XY,elbow:XY,wrist:XY,color:string,armor:boolean,lit:boolean){
  seg(b,shoulder,elbow,4.1,color,lit); seg(b,elbow,wrist,3.1,armor?STEEL:color,lit); hand(b,wrist);
}
export function boot(b:Brush,x:number,y:number){poly(b,[[x-2,y-4],[x+1.4,y-4],[x+2.1,y-1],[x+4,y],[x+3.5,y+1.1],[x-2.5,y+.8]],BOOT);line(b,[[x-1.7,y-2],[x+1,y-1.6]],'#777164',.65);}
export function leg(b:Brush,hip:XY,knee:XY,foot:XY,armor:boolean,lit:boolean){
  seg(b,hip,knee,4.9,armor?SHADE:'#60584a',lit); seg(b,knee,[foot[0],foot[1]-3],3.7,armor?STEEL:BOOT,lit);
  if(armor) ellipse(b,knee[0],knee[1],2.4,2,lit?EDGE:STEEL);
  boot(b,foot[0],foot[1]);
}
