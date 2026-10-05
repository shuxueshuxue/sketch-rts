import {hasWarfareUnit,paintWarfareUnit} from './warfare-units';
/** Hand-painted cutout figures. Geometry is authored here, not generated artwork.
 * One restrained material set; six action keys and eight locomotion keys.
 * Feet stay at y=16 and each figure lives inside the atlas's 128px tile. */
import { hasPaintedCreature, paintCreature } from './painted-creatures';
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import { type Brush, type XY, polygon, line, ellipse, darker, lighter } from './kit';

type Role = 'sword' | 'pike' | 'bow' | 'priest' | 'mage' | 'witch' | 'axe' | 'worker';
type Figure = { role: Role; armor?: boolean; elite?: boolean; mounted?: boolean; ember?: boolean };
const figures: Partial<Record<UnitKind, Figure>> = {
  thornSlinger:{role:'bow'}, barkMender:{role:'priest'}, gladeWitch:{role:'witch'},
  worker: { role:'worker' }, footman:{role:'sword',armor:true}, lancer:{role:'pike',armor:true},
  ashWarden:{role:'pike',armor:true,elite:true,ember:true}, archer:{role:'bow'},
  horseArcher:{role:'bow',mounted:true}, raider:{role:'sword',mounted:true}, knight:{role:'pike',armor:true,elite:true,mounted:true},
  priest:{role:'priest'}, summoner:{role:'mage'}, witch:{role:'witch'},
  emberRavager:{role:'axe',armor:true,ember:true}, cinderRunner:{role:'sword',ember:true},
  sparkArcher:{role:'bow',ember:true}, emberAcolyte:{role:'priest',ember:true},
  ashHexer:{role:'witch',ember:true}, pyreCaller:{role:'mage',ember:true},
  ashChieftain:{role:'axe',armor:true,elite:true,ember:true}, cinderRevenant:{role:'sword',armor:true,elite:true,ember:true},
  mercenary:{role:'sword',armor:true}, contractArcher:{role:'bow'}, fieldMedic:{role:'priest'},
};
export const hasPaintedUnit = (kind: UnitKind) => hasWarfareUnit(kind) || !!figures[kind] || hasPaintedCreature(kind);
const INK='#292b29', STEEL='#8d9897', EDGE='#d0cbbc', SHADE='#525e60';
const SKIN='#ba9575', HIDE='#665342', BOOT='#373631', LINEN='#c9bda0';
function poly(b:Brush,p:number[][],fill:string,edge=INK,w=.55){
  polygon(b,p,fill,edge,w);
  if(fill==='transparent')return;
  b.save();b.clip();
  const xs=p.map(v=>v[0]!),ys=p.map(v=>v[1]!);
  const x=Math.min(...xs),y=Math.min(...ys),ww=Math.max(...xs)-x,hh=Math.max(...ys)-y;
  if(ww>3&&hh>5){
    const glaze=b.createLinearGradient(x,y,x+ww,y+hh);
    glaze.addColorStop(0,'#f4dfb53a');glaze.addColorStop(.38,'#f4dfb500');glaze.addColorStop(1,'#182c3a48');
    if(fill===STEEL || fill===EDGE) { glaze.addColorStop(.16,'#fff0ce55'); glaze.addColorStop(.23,'#fff0ce00'); }
    b.fillStyle=glaze;b.fillRect(x,y,ww,hh);
    for(let i=0;i<Math.min(22,ww*hh/8);i++){
      const a=Math.sin(i*12.31+x*9.13+y*3.27)*43758.5453, d=Math.sin(i*7.71+y*8.1)*19283.11;
      const px=x+(a-Math.floor(a))*ww,py=y+(d-Math.floor(d))*hh;
      line(b,[[px,py],[px+.5,py+1.3]],i%3?'#e5d5b026':'#232b2826',.4);
    }
  }
  b.restore();
}
const seg=(b:Brush,a:XY,z:XY,width:number,color:string,lit:boolean)=>{
  line(b,[a,z],INK,width+1.1); line(b,[a,z],color,width);
  if(lit) line(b,[[a[0]-.65,a[1]],[z[0]-.65,z[1]-.7]],lighter(color,.22),Math.max(.55,width*.22));
};
function hand(b:Brush,p:XY){poly(b,[[p[0]-1.5,p[1]-1.5],[p[0]+1,p[1]-1.7],[p[0]+1.7,p[1]+1],[p[0]-.6,p[1]+2]],SKIN);}
function arm(b:Brush,shoulder:XY,elbow:XY,wrist:XY,color:string,armor:boolean,lit:boolean){
  seg(b,shoulder,elbow,4.1,color,lit); seg(b,elbow,wrist,3.1,armor?STEEL:color,lit); hand(b,wrist);
}
function boot(b:Brush,x:number,y:number){poly(b,[[x-2,y-4],[x+1.4,y-4],[x+2.1,y-1],[x+4,y],[x+3.5,y+1.1],[x-2.5,y+.8]],BOOT);line(b,[[x-1.7,y-2],[x+1,y-1.6]],'#777164',.65);}
function leg(b:Brush,hip:XY,knee:XY,foot:XY,armor:boolean,lit:boolean){
  seg(b,hip,knee,4.9,armor?SHADE:'#60584a',lit); seg(b,knee,[foot[0],foot[1]-3],3.7,armor?STEEL:BOOT,lit);
  if(armor) ellipse(b,knee[0],knee[1],2.4,2,lit?EDGE:STEEL);
  boot(b,foot[0],foot[1]);
}
function face(b:Brush,kind:Figure,team:string,facing:number){
  // A 7px face on a 47px body: no eyes or cartoon head proportions.
  poly(b,[[-3,-34],[-2,-38],[2,-38.5],[4,-35],[3.7,-30.5],[1,-28.7],[-2.7,-31]],SKIN);
  poly(b,[[1,-37],[3,-36],[4,-33],[3,-30],[.8,-29.5]],'#84634e','transparent',0);
  line(b,[[2,-34],[4.2,-34]],'#35322d',.7);
  if(kind.armor){
    poly(b,[[-4,-33],[-3.5,-39],[-.6,-41],[3.4,-39.4],[4.5,-34],[1,-35],[-1,-32]],kind.ember?'#716d65':STEEL);
    poly(b,[[-3.1,-38.8],[-.6,-40],[1,-38],[.2,-34.4],[-3,-33.8]],facing===1?EDGE:SHADE,'transparent',0);
    line(b,[[1,-35],[4.2,-35]],INK,1);
    if(kind.ember){poly(b,[[1,-35],[5,-35],[4,-29],[1,-28]],'#5b5650');line(b,[[2,-33],[4,-33]],'#ba9d73',.65);}
    if(kind.elite){poly(b,[[-4,-35],[-3,-29],[-.5,-28],[1,-34]],SHADE); line(b,[[-1,-40],[-2,-45],[-7,-47],[-12,-46]],team,2);}
    else line(b,[[-5,-34],[-1,-35],[5,-34]],'#b4b8ab',1);
  } else if(kind.role==='worker'){
    poly(b,[[-4,-36],[-3,-40],[2,-40],[4,-36]],'#9f8556');
    poly(b,[[-7,-35],[-3,-37],[3,-36.7],[7,-34.5],[1,-33.5]],'#c2a46c');
  } else if(kind.role==='priest'){
    poly(b,[[-3.5,-35],[-3,-41],[0,-44],[3,-41],[4,-35]],kind.ember?'#9e7054':LINEN);
    line(b,[[0,-42],[0,-36]],'#ad9362',.8);
  } else {
    const cloth=kind.role==='witch'?'#625666':darker(team,.28);
    poly(b,[[-5,-28],[-5,-37],[-1,-42],[3,-40],[5,-34],[3.7,-30],[2,-37],[-.5,-38],[-2.6,-35],[-2.3,-29]],cloth);
    line(b,[[-4.3,-36],[-1,-40],[2,-39]],lighter(cloth,.2),.8);
    if(kind.role==='witch') poly(b,[[-4,-40],[-2,-47],[2,-46],[1,-40]],cloth);
  }
}
function shield(b:Brush,x:number,y:number,team:string,elite:boolean,facing:number){
  const w=elite?8:7,h=elite?15:12;
  const points=[[x-w,y-h],[x+2,y-h-1],[x+w,y-h+2],[x+w-1,y+5],[x,y+h],[x-w,y+4]];
  poly(b,points,'#aaa58f',INK,.85);
  poly(b,points.map(([a,z])=>[x+(a!-x)*.83,y+(z!-y)*.88]),darker(team,.18));
  poly(b,[[x,y-h+1],[x+w-1,y-h+3],[x+w-2,y+5],[x,y+h-2]],facing===1?darker(team,.4):lighter(team,.1),'transparent',0);
  line(b,[[x-3,y-h+3],[x-3,y+5]],'#d7c6a0',1.25);
  line(b,[[x-w+2,y-h+3],[x-w+2,y+3],[x,y+h-2]],'#c5bba2',.7);
  ellipse(b,x,y-2,2.2,2.5,'#b4aa8c',INK);
  for(const z of [-6,3]) line(b,[[x+2,z+y],[x+4,z+y-1]],'#8a9890',.65);
}
function sword(b:Brush,wrist:XY,angle:number,axe:boolean){
  b.save();b.translate(...wrist);b.rotate(angle);
  seg(b,[0,3],[0,-4],2.2,HIDE,false);
  if(axe){
    seg(b,[0,3],[0,-26],2.3,'#8b7454',true);
    poly(b,[[-1,-25],[6,-29],[12,-27],[13,-18],[6,-16],[2,-20]],STEEL);
    line(b,[[11,-27],[12,-19],[7,-17]],EDGE,1.25);
  }else{
    poly(b,[[-2,-5],[-2,-25],[0,-31],[2,-25],[2,-5]],STEEL);
    poly(b,[[0,-29],[0,-5],[2,-5],[2,-25]],SHADE,'transparent',0);
    line(b,[[-1.8,-23],[-1.8,-6]],EDGE,.8);line(b,[[-5,-4],[5,-4]],'#a4997d',1.6);
  }b.restore();
}
function mount(b:Brush,team:string,phase:number,elite:boolean,facing:number){
  const coat=elite?'#85847b':'#685243';
  // Four different phase offsets, planted hind feet and flexed forelegs.
  for(const [x,off] of [[-17,0],[14,Math.PI],[-12,Math.PI],[19,0]]){
    const s=Math.sin(phase+off!)*5;
    seg(b,[x!,0],[x!+s*.4,8],2.6,darker(coat,.25),false);
    seg(b,[x!+s*.4,8],[x!+s,16-Math.max(0,s)*.4],2,coat,true);
    line(b,[[x!+s-1.5,17-Math.max(0,s)*.4],[x!+s+2,17-Math.max(0,s)*.4]],INK,2);
  }
  line(b,[[-22,-5],[-28,2],[-30,8]],'#35322d',3);
  poly(b,[[-24,-11],[-15,-17],[8,-16],[20,-10],[17,2],[-16,3],[-23,-2]],coat);
  poly(b,[[-20,-12],[-13,-15],[7,-14],[14,-10],[-14,-7]],lighter(coat,.2),'transparent',0);
  poly(b,[[10,-10],[13,-27],[20,-36],[25,-34],[26,-30],[33,-25],[33,-20],[28,-19],[23,-23],[23,-9]],coat);
  poly(b,[[14,-26],[20,-34],[21,-28],[17,-14]],facing===1?lighter(coat,.25):darker(coat,.2),'transparent',0);
  line(b,[[19,-33],[15,-26],[12,-15]],'#35322d',3);
  poly(b,[[20,-35],[20,-42],[24,-35]],coat);
  line(b,[[25,-27],[28,-26]],INK,1);
  line(b,[[25,-28],[28,-20],[33,-22]],'#b6a582',1);
  line(b,[[29,-22],[12,-17],[1,-16]],HIDE,1);
  poly(b,[[-17,-13],[6,-14],[11,-3],[7,8],[-16,6],[-20,1]],darker(team,.15));
  line(b,[[-17,4],[6,6],[9,0]],'#b5a176',1);
  if(elite){poly(b,[[21,-34],[25,-30],[26,-27],[23,-25],[19,-29]],STEEL);line(b,[[20,-33],[23,-30]],EDGE,1);}
}

export function paintFigure(b:Brush,kind:UnitKind,team:string,pose:UnitAnimationFrame,facing:1|-1):boolean{
  if(hasWarfareUnit(kind))return paintWarfareUnit(b,kind,team,pose);
 const f=figures[kind];if(!f)return paintCreature(b,kind,team,pose);
  b.save();b.lineJoin='round';b.lineCap='round';
  const walking=pose.mode==='walk'; const phase=walking?pose.frame*Math.PI/4:0;
  const stride=walking?Math.sin(phase):0;
  // Action starts on damage/cooldown event: impact first, then recoil, recovery and ready.
  const impact=pose.mode==='attack'?([1,.65,.15,-.28,-.15,0][pose.frame]??0):0;
  const cast=pose.mode==='cast'?([.5,1,.8,.45,.2,0][pose.frame]??0):0;
  const robe=['priest','mage','witch'].includes(f.role);
  const armor=!!f.armor;
  const cloth=f.role==='witch'?'#5d5061':f.role==='priest'?(f.ember?'#a78265':LINEN):darker(team,.13);
  if(f.mounted){mount(b,team,phase,!!f.elite,facing);b.translate(-3,-17);b.scale(.84,.84);}
  const bob=walking?-Math.abs(stride)*1.3:0;
  if(!f.mounted){
    leg(b,[-3,-4],[-4-stride*3,5],[-5-stride*5,16-Math.max(0,stride)*2.2],armor,false);
    leg(b,[3,-4],[5+stride*2,5],[6+stride*5,16-Math.max(0,-stride)*2.2],armor,facing===1);
  }
  b.translate(impact*(f.mounted?.65:2),bob);
  const flutter=stride*1.4+impact*2;
  if(robe||f.elite||f.role==='bow'){
    poly(b,[[-7,-25],[4,-25],[1,0],[-6+flutter,11],[-14+flutter,10],[-11,-7]],darker(cloth,.3));
    line(b,[[-8,-21],[-10,6],[-6+flutter,9]],lighter(cloth,.08),1);
  }
  const wrist:XY=[12+impact*7,-12-impact*5-cast*12];
  if(f.role!=='pike')arm(b,[5,-23],[10,-17],wrist,cloth,armor,false);
  // Neck joins the jaw to the collar, including under the worker hat.
  poly(b,[[-2.2,-31],[2,-31],[2.5,-26],[-2.5,-26]],SKIN);
  // Pelvis, fitted torso and separate shoulder planes, rather than a trapezoid dress.
  poly(b,[[-6,-12],[6,-12],[7,-2],[3,1],[-6,-1]],HIDE);
  if(robe){
    poly(b,[[-6,-18],[6,-18],[7,0],[11+flutter,15],[3,16],[-2,13],[-10+flutter,15],[-7,-2]],cloth);
    poly(b,[[2,-15],[5,-14],[6,1],[9+flutter,14],[4,13]],darker(cloth,.3),'transparent',0);
    line(b,[[-4,-9],[-5,3],[-7+flutter,12]],lighter(cloth,.23),1);
    line(b,[[-8+flutter,14],[-2,12],[3,15],[9+flutter,14]],'#aa9472',.8);
  }
  poly(b,[[-7,-25],[-2,-28],[4,-27],[7,-23],[5,-10],[-5,-9],[-7,-17]],armor?STEEL:cloth);
  poly(b,[[1,-26],[6,-23],[5,-11],[1,-10]],armor?SHADE:darker(cloth,.3),'transparent',0);
  line(b,[[-5,-23],[-3,-25],[0,-25]],armor?EDGE:lighter(cloth,.3),1.2);
  if(armor){
    if(f.elite) { poly(b,[[-10,-27],[-4,-29],[-3,-22],[-10,-20]],f.ember?'#837563':STEEL);poly(b,[[4,-28],[10,-26],[11,-21],[5,-22]],SHADE); }
    poly(b,[[-8,-26],[-3,-25],[-4,-20],[-9,-21]],facing===1?EDGE:SHADE);
    line(b,[[-5,-16],[0,-14],[5,-16]],'#b2b5a7',.65);
    // Separate breastplate from the mail skirt; sparse metal links survive at 1x.
    for(let row=0;row<3;row++)for(let col=0;col<5;col++){
      const x=-4+col*1.8+(row%2)*.45,y=-13+row*1.25;
      line(b,[[x,y],[x+.6,y+.5],[x+1,y]],row%2?'#495653':'#bdbaa5',.45);
    }
    line(b,[[-4,-22],[-3,-18],[0,-16]],'#c8cbbb',.75);
    for(const x of [-3,3])ellipse(b,x,-18,.45,.5,'#d1c7a9');

    poly(b,[[-5,-10],[5,-10],[7,-2],[1,-3],[-5,-1]],darker(team,.1));
    for(const x of [-3,1,4])line(b,[[x,-9],[x+1,-3]],'#83938e',.5);
  }else if(f.role==='bow'||f.role==='worker'){
    poly(b,[[-5,-25],[-1,-26],[4,-11],[1,-10]],HIDE);
    line(b,[[-4,-24],[2,-12]],'#b29c77',.7);
  }
  line(b,[[-6,-10],[5,-10]],'#493f33',2.1);poly(b,[[-1,-11],[1,-11],[1,-9],[-1,-9]],'#b6a079');
  if(f.mounted)leg(b,[1,-5],[5,3],[6,12],armor,true);
  if(f.role==='bow'){
    // Rear quiver, an actual drawing arm, and a string that relaxes on release.
    poly(b,[[-11,-26],[-7,-27],[-4,-12],[-8,-11]],HIDE);
    for(const x of [-10,-8])line(b,[[x,-25],[x-2,-34]],'#c8bba0',.8);
    const pull=pose.mode==='attack'?([0,.25,.5,.9,1,.5][pose.frame]??0):.35;
    arm(b,[5,-23],[10,-21],[18,-21],cloth,false,true);
    arm(b,[-5,-23],[1-pull*4,-18],[15-pull*9,-21],cloth,false,true);
    b.beginPath();b.moveTo(18,-39);b.bezierCurveTo(30,-31,29,-10,18,-3);b.strokeStyle='#463d31';b.lineWidth=2.1;b.stroke();
    b.beginPath();b.moveTo(18,-38);b.bezierCurveTo(28,-29,28,-11,18,-4);b.strokeStyle='#b7a078';b.lineWidth=.8;b.stroke();
    line(b,[[18,-39],[15-pull*9,-21],[18,-3]],'#c8c0a8',.6);
    if(impact<.8){line(b,[[6,-21],[30,-21]],'#b9ae91',.8);poly(b,[[30,-23],[34,-21],[30,-19]],EDGE);}
  }else if(robe){
    const top:XY=[wrist[0]+1,wrist[1]-23];
    seg(b,[wrist[0]-1,14],[top[0],top[1]],1.8,'#897151',true);
    if(f.role==='priest'){
      line(b,[[top[0]-4,top[1]+4],[top[0]+4,top[1]+4]],'#c0ac79',1.5);
      poly(b,[[top[0],top[1]-3],[top[0]+2.5,top[1]+1],[top[0],top[1]+5],[top[0]-2.5,top[1]+1]],'#ded0a0');
    }else{
      ellipse(b,top[0],top[1],4,5,'#333b3b','#a99873');
      ellipse(b,top[0]-.5,top[1]-1,2,3,f.ember?'#cf8b4f':'#a1beb5');
    }
    arm(b,[-5,-23],[-10,-15-cast*7],[-13+cast*4,-12-cast*15],cloth,false,true);
    if(cast){
      b.save();b.globalAlpha*=cast*.65;
      ellipse(b,top[0],top[1],6+cast*4,7+cast*4,f.ember?'#e9a85435':'#c0d6bf35');
      line(b,[[top[0]-6,top[1]],[top[0]+6,top[1]]],'#ede4bf',.8);
      line(b,[[top[0],top[1]-8],[top[0],top[1]+8]],'#ede4bf',.8);b.restore();
    }
  }else if(f.role==='pike'){
    // Rigid shaft rotates around the gripping hand; the tip and butt never
    // move independently. A mounted lance stays couched, with a short recovery.
    const grip:XY=f.mounted?[9+impact*3,-16]:[8+impact*5,-19];
    const angle=f.mounted?-.2+impact*.16:-.95+impact*.55;
    arm(b,[5,-23],[7,-17],grip,cloth,armor,true);
    b.save();b.translate(...grip);b.rotate(angle);
    seg(b,[-23,0],[40,0],f.mounted?2.2:1.8,'#877052',true);
    poly(b,[[39,-2],[48,0],[39,2],[36,0]],STEEL);
    line(b,[[39,-1.5],[47,0]],EDGE,.7);
    // Grip wrap and a modest hand guard make the attachment legible at 1x.
    line(b,[[-3,0],[2,0]],HIDE,3);
    if(f.mounted)poly(b,[[3,-3.5],[5,-2],[5,2],[3,3.5]],'#a49d88');
    b.restore();hand(b,grip);
    if(f.mounted)shield(b,-9,-10,team,false,facing);
    else if(f.elite)shield(b,-9,-9,team,true,facing);
    else arm(b,[-5,-23],[-3,-15],[grip[0]-9*Math.cos(angle),grip[1]-9*Math.sin(angle)],cloth,armor,true);
  }else if(f.role==='worker'){
    arm(b,[-5,-23],[0,-16],[8,-13],cloth,false,true);
    b.save();b.translate(...wrist);b.rotate(impact*1.1+.24);
    seg(b,[0,7],[0,-22],1.9,'#9a8058',true);
    poly(b,[[-9,-18],[-4,-23],[3,-23],[10,-18],[3,-20],[-3,-20]],STEEL);b.restore();
    poly(b,[[-6,-9],[-1,-9],[-1,-3],[-7,-2]],HIDE);
  }else{
    sword(b,wrist,impact*1.45+(f.role==='axe'?.15:.32),f.role==='axe');
    if(f.role==='sword')shield(b,-9,-10,team,!!f.elite,facing);
    else arm(b,[-6,-23],[-10,-15],[-9,-8],cloth,armor,true);
  }
  face(b,f,team,facing);
  b.restore();return true;
}
