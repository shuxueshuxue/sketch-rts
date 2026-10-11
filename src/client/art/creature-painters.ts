/** Distinct animal drawings. Only brush treatment is shared across anatomies. */
import { type Brush, type XY, line, ellipse, darker, lighter } from './kit';
import type { Shape } from './appearance';
import type { EquipmentKind } from './equipment';
import { paintRigidEquipment } from './equipment';
import type { CreatureDrawing } from './creature-poses';
const INK='#343730',BONE='#c1b49a';
export type CreatureLook={kind:string;shape:Shape;color:string;team:string;crown:boolean;weapon?:EquipmentKind|undefined};
/** Closed contour with optional cubic sections. A subdued wash sits inside it. */
function mass(b:Brush,points:number[][],color:string,edge=INK){
 b.beginPath();points.forEach((p,i)=>{if(!i)b.moveTo(p[0]!,p[1]!);else if(p.length===6)b.bezierCurveTo(p[0]!,p[1]!,p[2]!,p[3]!,p[4]!,p[5]!);else b.lineTo(p[0]!,p[1]!);});b.closePath();
 b.fillStyle=color;b.fill();b.save();b.clip();
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const p of points)for(let i=0;i<p.length;i+=2){left=Math.min(left,p[i]!);right=Math.max(right,p[i]!);top=Math.min(top,p[i+1]!);bottom=Math.max(bottom,p[i+1]!);}
 const wash=b.createLinearGradient(left,top,right,bottom);wash.addColorStop(0,'#eedbb538');wash.addColorStop(.46,'#d0c8aa00');wash.addColorStop(1,'#182b3544');
 b.fillStyle=wash;b.fillRect(left,top,right-left,bottom-top);
 // Fixed dry-brush flecks, batched per surface; never consume simulation RNG.
 const count=Math.min(18,Math.floor((right-left)*(bottom-top)/22));
 for(let tone=0;tone<2;tone++){
  b.beginPath();for(let i=tone;i<count;i+=2){
   const a=Math.sin(i*13.7+left*3.1+top)*4721.31,d=Math.sin(i*9.3+top*4.7)*6931.7;
   const x=left+(a-Math.floor(a))*(right-left),y=top+(d-Math.floor(d))*(bottom-top);
   b.moveTo(x,y);b.lineTo(x+.45,y+1.2);
  }
  b.strokeStyle=tone?'#e2d1ad35':'#30372e32';b.lineWidth=.45;b.stroke();
 }
 b.restore();
 // The clip path was consumed by fleck batching; reconstruct only the contour.
 b.beginPath();points.forEach((p,i)=>{if(!i)b.moveTo(p[0]!,p[1]!);else if(p.length===6)b.bezierCurveTo(p[0]!,p[1]!,p[2]!,p[3]!,p[4]!,p[5]!);else b.lineTo(p[0]!,p[1]!);});b.closePath();
 b.strokeStyle=edge;b.lineWidth=.55;b.stroke();
}
function stroke(b:Brush,p:number[][],color:string,width=.8){
 b.beginPath();p.forEach((q,i)=>{if(!i)b.moveTo(q[0]!,q[1]!);else if(q.length===6)b.bezierCurveTo(q[0]!,q[1]!,q[2]!,q[3]!,q[4]!,q[5]!);else b.lineTo(q[0]!,q[1]!);});b.strokeStyle=color;b.lineWidth=width;b.stroke();
}
/** A tapered flesh/root contour follows a drawn bend, without imposing lengths. */
function flesh(b:Brush,a:XY,k:XY,z:XY,width:number,color:string){
 const dx=z[0]-a[0],dy=z[1]-a[1],l=Math.hypot(dx,dy)||1,nx=-dy/l,ny=dx/l;
 const at=(p:XY,w:number):XY=>[p[0]+nx*w,p[1]+ny*w];
 const a1=at(a,width*.56),a2=at(a,-width*.56),k1=at(k,width*.48),k2=at(k,-width*.48),z1=at(z,width*.3),z2=at(z,-width*.3);
 mass(b,[a1,[k1[0],k1[1],k1[0],k1[1],...z1],z2,[k2[0],k2[1],k2[0],k2[1],...a2]],color);
 stroke(b,[at(a,width*.26),[k1[0],k1[1],k[0],k[1],...at(z,width*.12)]],lighter(color,.16),.7);
}
function stone(b:Brush,x:number,y:number,w:number,h:number,color:string,cut=0){
 const uneven=Math.sin(x*1.7+y*.9)*.09;
 mass(b,[[x-w*.4,y-h*(.4+uneven)],[x-w*.14,y-h*.52],[x+w*.2,y-h*.43],[x+w*.48,y-h*.12],[x+w*.37,y+h*(.35-uneven)],[x-w*.03,y+h*.46],[x-w*.43,y+h*.25],[x-w*.5,y-h*.04]],color);
 line(b,[[x-w*.14,y-h*.42],[x-w*.05,y-h*.13],[x+w*.13,y+h*.05],[x+w*.02,y+h*.27]],darker(color,.23),.65);
 line(b,[[x-w*.4,y-h*.42],[x+w*.12,y-h*.55],[x+w*.35,y-h*.3]],lighter(color,.28),.8);
 if(cut)line(b,[[x-2,y-h*.28],[x+1,y],[x-2,y+h*.22]],'#b6ad8970',.65);
}
function fist(b:Brush,p:XY,color:string){
 mass(b,[[p[0]-4,p[1]-3],[p[0]+2,p[1]-4],[p[0]+5,p[1]-1],[p[0]+4,p[1]+4],[p[0]-2,p[1]+4],[p[0]-5,p[1]+1]],color);
 for(const x of [-1,1.5])line(b,[[p[0]+x,p[1]],[p[0]+x+1,p[1]+2.5]],darker(color,.3),.65);
}
function stoneBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color,granite=l.kind==='graniteGolem',rubble=l.kind==='rubbleGolem';
 // Weight sits on broad, offset blocks; the shoulders are not machine hinges.
 for(const side of [-1,1]){
  const x=side*11,s=p.walk*side*3,lift=Math.max(0,p.stepLift*side)*3;
  stone(b,x,7,13,19,darker(c,.12));stone(b,x+s,19-lift,17,9,c);
 }
 b.translate(0,p.bob);
 const far:XY=p.casting?p.free:[-26+p.strike*3,-1+p.dy*4];
 flesh(b,[-16,-24],[-23,-14],far,11,darker(c,.24));
 stone(b,-22,-14,13,18,darker(c,.12));stone(b,...far,13,11,c);
 flesh(b,[16,-23],p.elbow,p.hand,12,darker(c,.3));
 stone(b,p.elbow[0],p.elbow[1],13,17,c);stone(b,...p.hand,16,13,c);
 mass(b,[[-18,-27],[-7,-36],[12,-33],[20,-22],[15,-6],[8,2],[-13,0],[-21,-14]],c);
 stone(b,-9,-20,22,22,lighter(c,.08),1);stone(b,9,-20,19,25,darker(c,.05),1);stone(b,0,-4,22,12,darker(c,.13));
 stone(b,-18,-28,rubble?17:24,granite?18:20,c,1);stone(b,17,-27,21,18,c);
 // A small recessed face emerges from rock, without a crown or helmet outline.
 mass(b,[[-9,-35],[-7,-41],[0,-45],[7,-43],[10,-37],[7,-31],[-2,-29]],darker(c,.12));
 line(b,[[-6,-36],[-1,-37],[2,-35],[7,-36]],'#343e36',1.8);
 line(b,[[-4,-36],[-1,-36.5]],'#c0b58a',.6);line(b,[[4,-35.5],[6,-36]],'#c0b58a',.6);
 line(b,[[1,-35],[0,-31],[4,-30]],'#9d9b82',.65);
 if(l.kind==='golem'){
  line(b,[[-4,-24],[1,-27],[5,-23],[0,-17],[-4,-21],[3,-21]],'#b2a580',1);
  line(b,[[-2,-18],[1,-13]],'#b2a580',.7);
 }
 if(granite){for(const [x,y] of [[-20,-29],[15,-28],[-9,-18],[8,-8]])line(b,[[x!-3,y!-4],[x!,y!],[x!+5,y!+2]],'#a9b1a2',.85);}
 else for(const [x,y] of [[-17,-30],[-10,-9],[12,-23],[6,2]]){
  mass(b,[[x!-4,y!],[x!-1,y!-2],[x!+4,y!],[x!+1,y!+3]],'#677359');
  line(b,[[x!-2,y!],[x!+2,y!+1]],'#99a076',.55);
 }
 if(rubble)for(const [x,y] of [[-22,-31],[17,-26],[-11,3]])stone(b,x!,y!,8,6,lighter(c,.1));
}
function woodBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color;
 for(const side of [-1,1]){
  const x=side*11+p.walk*side*2;
  b.save();b.translate(0,-Math.max(0,p.stepLift*side)*3);
  mass(b,[[side*7,-4],[x-5,9],[x-9,20],[x-5,23],[x+1,18],[x+7,22],[x+10,20],[x+3,9],[side*12,-5]],darker(c,.1));
  line(b,[[side*9,0],[x,13],[x-3,20]],'#b09c76',.8);b.restore();
 }
 b.translate(0,p.bob);
 const far:XY=p.casting?p.free:[-28+p.strike*5,5];
 flesh(b,[-15,-24],[-26,-11],far,10,darker(c,.2));
 flesh(b,[16,-26],p.elbow,p.hand,10,c);
 for(const [x,y] of [p.hand,far])for(const i of [-1,0,1])stroke(b,[[x!+i*2,y!],[x!+i*4,y!+5],[x!+i*5,y!+8]],'#66563e',2);
 mass(b,[[-15,2],[-20,-15],[-16,-32],[-7,-42],[7,-41],[17,-30],[15,-10],[20,0],[7,5],[1,-4],[-5,3]],c);
 for(const i of [-12,-5,3,10])stroke(b,[[i,0],[i-5,-12,i+5,-23,i,-37]],darker(c,.3),1.15);
 for(const i of [-10,-1,8])stroke(b,[[i,0],[i-4,-14,i+5,-25,i+1,-38]],'#b3a47c',.65);
 mass(b,[[-9,-31],[-8,-42],[-3,-49],[0,-42],[7,-46],[10,-34],[4,-27]],darker(c,.07));
 line(b,[[-5,-36],[-2,-35]],'#d4c899',1);line(b,[[3,-35],[6,-36]],'#d4c899',1);
 stroke(b,[[-2,-31],[0,-29],[4,-31]],'#3f493a',.8);
 // Stoneback is a rooted creature with a weathered carapace, not a recoloured golem.
 for(const [x,y,w,h] of [[-17,-27,17,14],[13,-26,18,14],[-8,-17,12,13]])stone(b,x!,y!,w!,h!,'#85877b',1);
 for(const [x,y] of [[-22,-30],[-13,-37],[15,-31],[11,-40]]){
  stroke(b,[[x!,y!+7],[x!-2,y!-1],[x!+4,y!-7]],'#665b43',1.8);
  for(const off of [-2,3])mass(b,[[x!,y!],[x!+off-5,y!-4],[x!+off,y!-8],[x!+off+2,y!-3]],'#73805a');
 }
}
function ogreBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color;
 for(const side of [-1,1]){
  const x=side*11,s=p.walk*side*4,lift=Math.max(0,p.stepLift*side)*4;
  flesh(b,[side*9,-2],[x,10-lift*.4],[x+s,20-lift],10,darker(c,.12));
  mass(b,[[x+s-6,17-lift],[x+s+4,17-lift],[x+s+8,22-lift],[x+s-6,23-lift]],'#5a5147');
 }
 b.translate(0,p.bob);
 flesh(b,[-15,-25],[-23,-13],p.free,12,darker(c,.12));fist(b,p.free,darker(c,.06));
 // Shoulder, rib cage and abdomen overlap as continuous masses.
 mass(b,[[-22,-24],[-18,-34,-8,-37,2,-34],[17,-34,24,-24,21,-15],[18,-5,12,3,-1,4],[-15,3,-22,-7,-22,-24]],c);
 mass(b,[[-13,-24],[-5,-28,5,-26,12,-23],[7,-17,1,-16,-3,-17],[-8,-13,-13,-17,-13,-24]],lighter(c,.07));
 stroke(b,[[-14,-19],[-6,-20,0,-14,9,-19]],darker(c,.22),.9);stroke(b,[[0,-13],[-2,-7,2,-3,0,1]],darker(c,.25),.8);
 mass(b,[[-11,-2],[13,-2],[18,10],[7,12],[0,9],[-9,12],[-17,9]],'#625247');
 line(b,[[-13,0],[12,0]],'#3f3932',2);mass(b,[[0,-2],[4,-2],[4,2],[0,2]],'#a7946b');
 // Small head buried in a thick neck, rather than a large cartoon face.
 b.save();b.translate(4,-34);b.scale(.7,.8);b.translate(0,34);
 mass(b,[[-9,-31],[-12,-38,-9,-46,-1,-46],[8,-47,13,-40,10,-32],[6,-26,-3,-25,-9,-31]],c);
 mass(b,[[1,-37],[9,-38],[13,-33],[9,-28],[0,-29],[-3,-32]],lighter(c,.08));
 line(b,[[-4,-38],[1,-39],[6,-38]],'#4d433a',1.3);line(b,[[0,-35],[2,-35]],'#ded0a7',.7);
 line(b,[[1,-30],[10,-31]],'#4a3f34',.8);
 mass(b,[[2,-29],[3,-34],[5,-29]],BONE);mass(b,[[9,-29],[11,-33],[11,-29]],BONE);
 stroke(b,[[-7,-40],[-3,-45,5,-45,9,-39]],'#51483b',1.6);b.restore();
 flesh(b,[16,-26],p.elbow,p.hand,12,c);
 paintRigidEquipment(b,l.weapon==='staff'?'staff':'club',p.hand,p.angle,p.casting);fist(b,p.hand,c);
 if(l.weapon==='staff'){
  mass(b,[[-16,-27],[-9,-30],[-5,-18],[-12,-13],[-17,-16]],'#4c6669');
  line(b,[[-13,-26],[-8,-18]],'#b6a576',1);for(const x of [-8,-3,3,8])ellipse(b,x,-25,1.3,1.1,BONE);
 }else{
  mass(b,[[-21,-29],[-13,-32],[-9,-24],[-14,-16],[-21,-21]],l.crown?'#5d6461':'#76654e');
  line(b,[[-18,-28],[-12,-24],[-16,-19]],'#a99b7c',1);
  mass(b,[[8,-28],[12,-27],[0,1],[-4,0]],'#564637');
 }
 if(l.crown){mass(b,[[-4,-41],[1,-46],[8,-43],[10,-39],[4,-39]],'#61594e');line(b,[[-2,-42],[3,-44],[8,-41]],'#bba884',.65);}
 for(const [x,y] of [[-10,-17],[-5,-9],[10,-12],[17,-21]]){line(b,[[x!,y!],[x!+3,y!+1]],darker(c,.2),.55);line(b,[[x!,y!+2],[x!+2,y!+3]],lighter(c,.12),.45);}
}
function fishBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color;
 const farLift=Math.max(0,-p.stepLift)*3,nearLift=Math.max(0,p.stepLift)*3;
 flesh(b,[-5,0],[-13,8-farLift*.4],[-16-p.walk*3,16-farLift],6,darker(c,.15));
 flesh(b,[7,0],[16,7-nearLift*.4],[20+p.walk*3,15-nearLift],6,c);
 for(const [x,lift] of [[-16-p.walk*3,farLift],[20+p.walk*3,nearLift]] as const)mass(b,[[x-3,13-lift],[x+2,14-lift],[x+7,17-lift],[x+1,17-lift],[x-4,18-lift]],c);
 b.translate(0,p.bob);
 // Fin and narrow tail establish the amphibious crouch before the torso.
 mass(b,[[-10,-17],[-19,-32],[-16,-9],[-24,-1],[-9,3]],darker(c,.24));
 for(const [x,y] of [[-19,-32],[-16,-9],[-24,-1]])line(b,[[-8,-14],[x!,y!]],lighter(c,.12),.6);
 mass(b,[[-10,4],[-16,-5,-14,-21,-5,-26],[5,-30,15,-24,15,-13],[15,-4,11,6,0,7],[-6,6,-9,5,-10,4]],c);
 mass(b,[[3,-22],[12,-20],[13,-7],[6,4],[-1,3]],lighter(c,.13));
 mass(b,[[-5,-24],[-4,-34,7,-35,16,-29],[21,-26,27,-22,29,-17],[24,-12,14,-12,6,-17],[-1,-17,-5,-20,-5,-24]],c);
 mass(b,[[13,-23],[21,-23],[29,-18],[26,-14],[15,-15]],lighter(c,.12));
 line(b,[[15,-16],[27,-16]],'#36453c',.9);ellipse(b,14,-25,1.8,1.2,'#c8b68d');ellipse(b,14.5,-25,.5,1,'#303a31');
 for(const y of [-20,-17,-14])stroke(b,[[4,y],[1,y+1,1,y+3,4,y+4]],darker(c,.22),.6);
 flesh(b,[-6,-13],[-11,-6],p.free,3.4,darker(c,.12));
 flesh(b,[9,-13],p.elbow,p.hand,4,c);
 if(l.weapon!=='javelin'||p.strike<.7)paintRigidEquipment(b,l.weapon==='staff'?'staff':l.weapon==='javelin'?'javelin':'pike',p.hand,p.angle,p.casting);
 ellipse(b,p.hand[0],p.hand[1],2.3,1.7,c,INK);
 mass(b,[[-8,-1],[8,0],[12,7],[0,9],[-11,6]],'#655f48');line(b,[[-8,1],[8,2]],'#b6a27b',.7);
 if(l.crown){mass(b,[[-8,-27],[-9,-42],[-2,-35],[2,-44],[8,-31]],'#747d76');for(const x of [-5,0,5])line(b,[[x,-29],[x-2,-37]],'#b9ae8d',.65);}
 else if(l.weapon==='javelin')for(const y of [-12,-8,-4])line(b,[[-9,y],[-4,y-2]],'#b6b491',.65);
}
function beastLeg(b:Brush,x:number,front:boolean,near:boolean,c:string,p:CreatureDrawing,slender=false){
 const phase=(front?1:-1)*(near?1:-1),stride=p.walk*phase*4;
 const lift=Math.max(0,p.stepLift*phase)*(slender?3:4);
 const knee:XY=[x+(front?2:-5)+stride*.5,(slender?6:8)-lift*.4];
 const foot:XY=[x+stride+(front?2:-2),18-lift];
 flesh(b,[x,slender?-10:-2],knee,foot,slender?3.4:front?4:6,near?c:darker(c,.2));
 mass(b,[[foot[0]-2,foot[1]-3],[foot[0]+2,foot[1]-3],[foot[0]+5,foot[1]],[foot[0]-3,foot[1]]],slender?'#48483e':darker(c,.12));
}
function houndBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color,moss=l.kind==='mossGnawer';
 beastLeg(b,-17,false,false,c,p);beastLeg(b,15,true,false,c,p);
 b.translate(0,p.bob);
 mass(b,[[-23,-6],[-32,-8,-34,-1,-48,1],[-40,6,-32,7,-21,2]],darker(c,.12));
 mass(b,[[-26,-10],[-25,-19,-11,-22,1,-19],[12,-24,24,-17,23,-7],[22,1,15,5,8,2],[-2,-2,-5,2,-15,3],[-24,4,-29,-2,-26,-10]],c);
 mass(b,[[-23,-8],[-15,-5,0,-8,11,-9],[20,-9,19,-2,13,2],[4,3,0,-1,-6,1],[-17,4,-23,1,-23,-8]],darker(c,.15));
 // Ragged mane follows the chest, not a row of identical spikes.
 mass(b,[[8,-20],[16,-25],[22,-21],[21,-11],[25,-5],[18,-4],[15,4],[10,-1],[7,-9]],moss?'#4f5a45':darker(c,.08));
 const x=p.headX,y=p.headY;
 mass(b,[[14,-7],[18,-17,x-7,y-7,x+2,y-7],[x+7,y-7,x+8,y,x+14,y+3],[x+15,y+6,x+6,y+10,x-2,y+7],[x-7,y+5,20,2,16,2]],c);
 mass(b,[[x-5,y-5],[x-6,y-12],[x+1,y-8],[x+4,y-10],[x+6,y-4]],darker(c,.08));
 mass(b,[[x+3,y+1],[x+10,y+1],[x+15,y+4],[x+12,y+6],[x+3,y+5]],lighter(c,.11));
 mass(b,[[x+1,y+6],[x+14,y+4],[x+11,y+8+Math.max(0,p.strike)*3],[x+1,y+9]],darker(c,.18));
 line(b,[[x+3,y+5],[x+14,y+4]],INK,.7);ellipse(b,x+14,y+3,.9,1.1,'#33372f');
 line(b,[[x-1,y-2],[x+3,y-1]],'#423f35',1.2);ellipse(b,x+2,y-1,.65,.65,'#c6b88c');
 if(p.strike>.4)mass(b,[[x+9,y+5],[x+10,y+8],[x+11,y+5]],BONE);
 for(const [fx,fy] of [[-18,-15],[-9,-17],[3,-17],[12,-18],[18,-12]])stroke(b,[[fx!-3,fy!-1],[fx!,fy!+2],[fx!+1,fy!+5]],moss?'#9aa078':'#b2a181',.65);
 b.translate(0,-p.bob);beastLeg(b,-14,false,true,c,p);beastLeg(b,17,true,true,c,p);b.translate(0,p.bob);
 if(moss)for(const [fx,fy] of [[-20,-18],[-12,-21],[-2,-19]])mass(b,[[fx!-4,fy!],[fx!-4,fy!-4,fx!+2,fy!-5,fx!+4,fy!-1],[fx!+1,fy!+2]],'#727a50');
}
function stagBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color;beastLeg(b,-15,false,false,c,p,true);beastLeg(b,16,true,false,c,p,true);b.translate(0,p.bob);
 mass(b,[[-25,-19],[-17,-28,6,-28,18,-23],[22,-20,23,-11,17,-7],[7,-7,0,-9,-11,-5],[-20,-5,-28,-10,-25,-19]],c);
 mass(b,[[-18,-8],[-7,-12,5,-14,17,-12],[12,-5,2,-7,-7,-4],[-16,-2,-20,-5,-18,-8]],lighter(c,.1));
 const x=p.headX,y=p.headY;
 mass(b,[[12,-9],[20,-17,18,y+1,x-6,y-6],[x,y-11,x+8,y-5,x+11,y+1],[x+16,y+5,x+13,y+8,x+5,y+7],[x-3,y+4,22,-6,15,-5]],c);
 mass(b,[[x+2,y],[x+12,y+2],[x+13,y+5],[x+4,y+6]],darker(c,.12));
 mass(b,[[x-4,y-5],[x-13,y-12],[x-5,y-13],[x,y-7]],lighter(c,.1));
 line(b,[[x+4,y],[x+7,y+1]],'#413f34',.9);
 for(const side of [-1,1]){
  const root:XY=[x-2+side*3,y-7],mid:XY=[x-6+side*9,y-22],tip:XY=[x-10+side*13,y-34];
  stroke(b,[root,[mid[0],mid[1],mid[0]+3,mid[1]-2,...tip]],'#76694f',2.2);
  stroke(b,[root,[mid[0],mid[1],mid[0]+3,mid[1]-2,...tip]],BONE,1.1);
  for(const t of [.35,.65]){
   const bx=root[0]+(tip[0]-root[0])*t,by=root[1]+(tip[1]-root[1])*t;
   stroke(b,[[bx,by],[bx+side*7,by-4],[bx+side*9,by-11]],BONE,1.1);
  }
 }
 stroke(b,[[-24,-15],[-29,-13,-29,-9,-26,-7]],'#695d48',2.5);
 for(const x of [-17,-8,1,10])line(b,[[x,-22],[x+2,-20]],'#c1af88',.7);
 b.translate(0,-p.bob);beastLeg(b,-12,false,true,c,p,true);beastLeg(b,18,true,true,c,p,true);b.translate(0,p.bob);
}
function turtleBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color;
 for(const side of [-1,1])flesh(b,[side*16,0],[side*24,4],[side*30+p.walk*side*2,13-Math.max(0,p.stepLift*side)*2],6,darker(c,.18));
 b.translate(0,p.bob);
 mass(b,[[-24,0],[-30,-11,-20,-26,-4,-27],[12,-29,27,-18,27,-4],[24,5,4,9,-16,5],[-24,4,-26,2,-24,0]],'#626d59');
 mass(b,[[-26,-2],[-22,-13,-12,-21,-1,-23],[11,-24,23,-14,24,-4],[16,-4,4,2,-9,3],[-17,3,-24,2,-26,-2]],'#7c8167');
 for(const [x,y,w,h] of [[-15,-7,15,14],[-3,-14,17,15],[11,-11,15,16],[-1,0,16,10]]){
  mass(b,[[x!-w!*.5,y!],[x!-w!*.2,y!-h!*.5],[x!+w!*.35,y!-h!*.4],[x!+w!*.5,y!+h!*.3],[x!,y!+h!*.5]],'#778067');
  line(b,[[x!-4,y!],[x!,y!-4],[x!+4,y!]],'#a3a487',.65);
 }
 const x=p.headX,y=p.headY;
 flesh(b,[18,-2],[x-6,y+4],[x+4,y+4],10,c);
 mass(b,[[x-4,y+2],[x-2,y-7,x+9,y-7,x+14,y+2],[x+16,y+5,x+10,y+10,x+1,y+8]],c);
 mass(b,[[x+8,y+2],[x+15,y+4],[x+11,y+7],[x+4,y+5]],'#b2a58b');
 line(b,[[x+3,y+6],[x+14,y+4]],INK,.8);ellipse(b,x+6,y,.9,.8,'#c2b284');
 stroke(b,[[-24,2],[-33,5,-37,10,-42,12]],c,3);
 b.translate(0,-p.bob);
 for(const side of [-1,1]){const x=side*17,foot:XY=[side*31-p.walk*side*3,18-Math.max(0,-p.stepLift*side)*2];flesh(b,[x,0],[side*26,7],foot,7,c);for(const i of [-1,0,1])line(b,[[foot[0]+i*2,foot[1]-3],[foot[0]+i*3+3,foot[1]]],BONE,.85);}
 b.translate(0,p.bob);
}
function spiderBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color,queen=l.crown;
 for(const near of [false,true])for(let i=0;i<4;i++){
  const phase=(i%2?1:-1)*(near?1:-1),step=p.walk*phase*2;
  const lift=Math.max(0,p.stepLift*phase)*2.3;
  const root:XY=[-8+i*5,-3+i],knee:XY=[[-34,-23,18,31][i]!+(near?0:5),[-14,-9,-7,-13][i]!+(near?0:-3)];
  const tip:XY=[[-45,-31,27,46][i]!+(near?0:5)+step,(near?18:14)-lift];
  flesh(b,root,[(root[0]+knee[0])/2,(root[1]+knee[1])/2],knee,2.4,near?c:darker(c,.22));
  flesh(b,knee,[(knee[0]+tip[0])/2,(knee[1]+tip[1])/2],tip,1.5,near?c:darker(c,.22));
 }
 b.translate(0,p.bob);
 mass(b,[[-25,-4],[-30,-20,-17,-29,-6,-22],[4,-20,8,-9,2,-1],[-6,6,-19,7,-25,-4]],c);
 mass(b,[[-22,-12],[-23,-22,-9,-25,-4,-16],[-2,-8,-9,-3,-17,-5]],darker(c,.12));
 for(const i of [-1,0,1])stroke(b,[[-16+i*5,-22],[-20+i*7,-11],[-15+i*5,0]],queen?'#a58e85':'#a49e7c',.8);
 const hx=9+p.dx*5,hy=-4+p.dy*4;
 mass(b,[[hx-10,hy-4],[hx-5,hy-11,hx+7,hy-11,hx+12,hy-2],[hx+15,hy+5,hx+4,hy+10,hx-5,hy+6]],lighter(c,.04));
 for(const [x,y] of [[5,-2],[8,-1],[6,2],[10,2]])ellipse(b,hx+x!,hy+y!,.65,.7,'#b7ab89');
 for(const side of [-1,1]){
  const tip:XY=[p.release[0],p.release[1]+side*2];
  mass(b,[[hx+7,hy+3+side*2],[hx+16,hy+2+side*6],[tip[0]+1,tip[1]+4],[tip[0]-3,tip[1]],[hx+10,hy+4]],'#a9a08b');
 }
 if(queen){for(const [x,y] of [[-20,-18],[-13,-23],[-5,-17]])mass(b,[[x!-3,y!],[x!-1,y!-5],[x!+3,y!-2],[x!+2,y!+2]],'#91867e');}
}
function dragonWing(b:Brush,x:number,y:number,flare:number,near:boolean){
 const shadow=near?'#725247':'#535653',membrane=near?'#97745d':'#6b6759';
 b.save();b.translate(x,y);
 // Humerus and long fingers define a folded sail; scallops join the fingers.
 mass(b,[[1,1],[-7,-13,-13,-27-flare,-19,-34-flare],[-31,-34,-45,-23,-52,-12],[-44,-15,-37,-12,-35,-6],[-29,-11,-22,-4,-22,3],[-16,-3,-6,-1,1,1]],shadow);
 mass(b,[[-19,-33-flare],[-29,-31,-39,-23,-48,-14],[-40,-15,-36,-10,-35,-7],[-30,-11,-26,-6,-24,0],[-23,-11,-23,-24,-19,-33-flare]],membrane);
 for(const tip of [[-50,-13],[-35,-7],[-23,2]])stroke(b,[[-19,-34-flare],[-23,-24,-25,-16,...tip]],near?'#b89b7e':'#8e8975',.6);
 stroke(b,[[1,1],[-7,-12,-13,-27-flare,-19,-34-flare],[-31,-32,-42,-23,-51,-13]],near?'#c4a78c':'#8e8c7a',1.4);
 b.restore();
}
function dragonBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 const c=l.color;
 beastLeg(b,-13,false,false,c,p);beastLeg(b,15,true,false,c,p);
 b.translate(0,p.bob);
 // A long taper and restrained oxide reds replace the squat polygonal dragon.
 mass(b,[[-19,-9],[-34,-14,-43,2,-64,-5],[-55,7,-36,7,-18,1]],darker(c,.08));
 stroke(b,[[-20,-7],[-36,-8,-45,5,-61,-4]],lighter(c,.2),.7);
 dragonWing(b,7,-16,Math.max(0,p.strike)*5+p.walk*2,false);
 mass(b,[[-25,-12],[-23,-24,-4,-27,10,-21],[23,-20,27,-10,20,-1],[11,7,-3,4,-17,3],[-24,1,-28,-4,-25,-12]],c);
 mass(b,[[-18,-4],[-8,-10,5,-9,19,-4],[16,4,4,6,-11,2]],'#a28a6b');
 for(const y of [-3,0,3])stroke(b,[[-12,y],[1,y-3,9,y-2,16,y]],'#695a47',.65);
 const x=p.headX,y=p.headY;
 mass(b,[[13,-2],[22,-12,17,y-6,x-5,y-10],[x+3,y-14,x+9,y-5,x+13,y+1],[x+17,y+5,x+7,y+9,x+1,y+6],[x-7,y+6,22,6,15,4]],c);
 mass(b,[[21,1],[25,-10,x-5,y+1,x+3,y+3],[x+9,y+8,x+7,y+10,x,y+9],[x-6,y+9,24,8,21,1]],'#b29b79');
 mass(b,[[x+1,y],[x+8,y-1],[x+15,y+3],[x+14,y+5],[x+2,y+6]],lighter(c,.08));
 mass(b,[[x+1,y+6],[x+14,y+4],[x+12,y+8+Math.max(0,p.strike)*3],[x+3,y+10]],darker(c,.16));
 line(b,[[x+2,y+5],[x+14,y+4]],INK,.75);
 line(b,[[x-1,y-3],[x+4,y-2]],'#463c35',1);line(b,[[x+1,y-2],[x+4,y-2]],'#cfba80',.65);
 for(const side of [-1,1])mass(b,[[x-4+side*3,y-6],[x-11+side*4,y-15],[x-5+side*3,y-12],[x+side*3,y-6]],BONE);
 if(l.crown){stroke(b,[[x-6,y-2],[x-9,y+2],[x-4,y+4]],'#c3a983',.7);}
 for(const i of [0,1,2,3,4]){
  const sx=-20+i*7,sy=-18+(i<2?0:2);
  mass(b,[[sx-2,sy],[sx-4,sy-7],[sx+2,sy-3],[sx+4,sy+1]],'#88785e');
 }
 for(const [sx,sy] of [[-15,-16],[-5,-18],[7,-17],[18,-10],[p.headX-4,p.headY-3]])for(let i=0;i<3;i++)stroke(b,[[sx!+i*2,sy!],[sx!+i*2+1,sy!+2],[sx!+i*2+3,sy!+1]],darker(c,.24),.55);
 dragonWing(b,-1,-16,Math.max(0,p.strike)*6-p.walk*2,true);
 b.translate(0,-p.bob);beastLeg(b,-11,false,true,c,p);beastLeg(b,17,true,true,c,p);
 for(const side of [-1,1]){const x=side<0?-13-p.walk*4:19+p.walk*4,lift=Math.max(0,p.stepLift*side)*4;for(const i of [-1,0,1])line(b,[[x+i*1.5,16-lift],[x+i*2+3,18-lift]],BONE,.7);}
 b.translate(0,p.bob);
}
function spiritBody(b:Brush,l:CreatureLook,p:CreatureDrawing){
 b.translate(0,p.bob);
 const sway=p.walk*2+p.dx*3;
 b.save();b.globalAlpha*=.72;
 mass(b,[[-7,-33],[-14,-24,-5,-14,-11,1],[-13,10,-8,15,-17,19],[-2,17,7,8,5,-1],[12,-14,10,-29,3,-35]],'#a8b6ad','#7e91867a');
 mass(b,[[-3,-29],[-7,-15,4,-8,sway+2,5],[sway+6,12,sway+3,15,sway-1,18],[sway+13,10,10,-3,6,-16],[9,-29,2,-34,-3,-29]],'#d1d0b8','#aab2a180');
 stroke(b,[[-4,-17],[-17,-7,-13,8,-23,13]],'#a9b7a8',1.3);
 stroke(b,[[4,-22],[15,-19,14,p.release[1]+3,...p.release]],'#d5d5bc',2);
 mass(b,[[-6,-30],[-5,-39,2,-41,7,-34],[9,-29,3,-25,-2,-26]],'#bcc6b7','#8b9c9080');
 line(b,[[-1,-32],[3,-32]],'#e9e2c9',.8);
 b.restore();
}
export function paintCreatureBody(b:Brush,look:CreatureLook,p:CreatureDrawing){
 b.lineCap='round';b.lineJoin='round';
 switch(look.shape){
  case 'stone':stoneBody(b,look,p);break;case 'wood':woodBody(b,look,p);break;case 'ogre':ogreBody(b,look,p);break;
  case 'fish':fishBody(b,look,p);break;case 'hound':houndBody(b,look,p);break;case 'stag':stagBody(b,look,p);break;
  case 'turtle':turtleBody(b,look,p);break;case 'spider':spiderBody(b,look,p);break;case 'dragon':dragonBody(b,look,p);break;case 'spirit':spiritBody(b,look,p);break;
 }
 if(p.casting){
  b.save();b.globalAlpha*=p.casting;ellipse(b,p.release[0],p.release[1],6,7,'#d4d3b42b');
  stroke(b,[[p.release[0]-5,p.release[1]],[p.release[0]+5,p.release[1]]],'#ded4af',.8);b.restore();
 }
}
