/** Ashen March appearances use the catalog's articulated figures and creature
 * anatomy. Only clothing, identifying details and socket ornaments live here. */
import { storyFigure, storyCreature } from '../../client/art/story-rig';
import { line, ellipse, polygon, leafMark, type Brush } from '../../client/art/kit';
import { paintedPlane as plane } from '../../client/art/materials';
import type { FigurePresentation, FigureRig } from '../../client/art/rig';
import type { MotionPose } from '../../client/art/motion';
const TEAL='#2f7d6d', REED='#b9a66a', OBSIDIAN='#2e2a2c', MAGMA='#e5652f';
const MOSS='#6f8f5a', STEEL='#8d9897', INK='#292b29', GOLD='#b9a16c', GLOW='#f4d083';
type Detail = NonNullable<FigurePresentation['detail']>;
function scarf(b:Brush,color='#b8543a') {
  plane(b,[[-6,-29],[5,-28],[5,-25],[-7,-26]],color);
  plane(b,[[-6,-28],[-13,-26],[-21,-20],[-17,-18],[-8,-24]],color);
  line(b,[[-11,-25],[-19,-20]],'#dc9b74',.65);
}
function hair(b:Brush,color:string) {
  plane(b,[[-4,-32],[-5,-38],[-2,-42],[3,-41],[5,-37],[2,-38],[-1,-39],[-3,-35]],color);
}
function crown(b:Brush) {
  for(const [x,h] of [[-3,7],[0,10],[3,6]]) {
    polygon(b,[[x!-2,-40],[x!,-40-h!],[x!+2,-40]],MAGMA,'#903e28',.65);
    line(b,[[x!,-41],[x!,-43-h!*.35]],GLOW,.8);
  }
}
function lantern(b:Brush,rig:FigureRig,fire=false) {
  b.save(); b.translate(...rig.wrist); b.rotate(rig.angle);
  const x=0, y=-24;
  plane(b,[[x-4,y-5],[x+4,y-5],[x+4,y+3],[x-4,y+3]],fire?'#7a3625':'#b9a96d');
  polygon(b,[[x-2.5,y-3],[x+2.5,y-3],[x+2.5,y+1],[x-2.5,y+1]],fire?MAGMA:'#e7d999',GOLD,.5);
  ellipse(b,x,y-1,1,1.7,GLOW);
  if(rig.cast) ellipse(b,x,y-1,7,8,fire?'#e9974433':'#dfebaa33');
  b.restore();
}
const lynn:Detail=(b,_r,stage)=>{
  if(stage==='head') {
    hair(b,'#6b4a2d'); line(b,[[-3,-36],[-7,-29],[-6,-22]],'#795534',1.6);
    line(b,[[1,-41],[5,-48],[9,-51]],'#e4dfbd',1.3);line(b,[[5,-48],[8,-46]],'#b96740',1);
  } else if(stage==='body') leafMark(b,0,-19,2.2,'#d5d5a3');
};
const du:Detail=(b,_r,stage)=>{
  if(stage==='head') { plane(b,[[-2.5,-33],[3.5,-33],[3,-28],[0,-26],[-3,-29]],'#cac5b6');line(b,[[-2,-31],[2,-30]],'#858278',.7); }
  if(stage==='body') leafMark(b,0,-18,2.7,'#e4ddae');
  if(stage==='equipment') {plane(b,[[-18,-25],[-3,-26],[-2,2],[-9,7],[-18,2]],'#796b50');polygon(b,[[-16,-22],[-5,-23],[-4,0],[-9,4],[-16,0]],'transparent',TEAL,1.2);ellipse(b,-9,-10,2,2,STEEL,INK);line(b,[[-15,-14],[-10,-10]],'#544a3a',1);line(b,[[-11,-5],[-8,-1]],'#544a3a',.9);}
};
const tess:Detail=(b,r,stage)=>{
  if(stage==='head'){hair(b,'#7b4b2e');line(b,[[-2,-41],[-5,-46],[-8,-47]],'#d9ccae',1.2);line(b,[[-5,-46],[-4,-49]],'#d9ccae',1);}
  if(stage==='body'){ellipse(b,-10,-1,4.3,3.5,'#9c7f52',INK);for(const x of [-12,-9,-6])line(b,[[x,-5],[x-2,-15]],'#758956',1.1);}
  if(stage==='equipment')lantern(b,r);
};
const ig:Detail=(b,_r,stage)=>{
  if(stage==='head'){hair(b,'#2f2724');line(b,[[1,-35],[3,-32]],'#9c4a36',.8);scarf(b);}
  if(stage==='body'){line(b,[[7,-20],[10,-16]],'#9c4a36',1);}
  if(stage==='equipment'){plane(b,[[-11,-11],[-17,-17],[-13,-9],[-10,-7]],STEEL);line(b,[[-12,-9],[-8,-6]],GOLD,1.2);}
};
const warden:Detail=(b,_r,stage)=>{
  if(stage==='body')for(const x of [-5,-2,2,5])line(b,[[x,-24],[x,-12]],'#b5a572',.7);
  if(stage==='head'){plane(b,[[-4,-35],[-4,-39],[0,-42],[4,-39],[5,-35]],'#858d82');line(b,[[-6,-35],[6,-35]],'#b5b9a6',1.8);line(b,[[-3,-40],[-7,-45]],REED,1.3);}
};
const villager:Detail=(b,_r,stage)=>{
  if(stage==='body'){ellipse(b,-10,-16,4.5,6,'#cbb78b',INK);line(b,[[-13,-20],[-8,-11]],'#8c7750',1);plane(b,[[-3,-23],[3,-23],[4,-3],[-4,-3]],'#ccc1a6');}
  if(stage==='head'){ellipse(b,0,-37,8,1.7,'#c9ad68',INK);plane(b,[[-4,-38],[-3,-42],[2,-42],[4,-38]],'#c9ad68');}
};
const woman:Detail=(b,_r,stage)=>{
  if(stage==='body'){plane(b,[[-4,-23],[4,-23],[7,12],[-7,12]],'#dfd3b8');ellipse(b,-10,-3,4.5,3.5,'#b29563',INK);for(const x of [-13,-10,-7])line(b,[[x,-5],[x+1,-16]],REED,1);}
  if(stage==='head'){hair(b,'#d8c9a8');}
};
const refugee:Detail=(b,_r,stage)=>{if(stage==='body')for(const x of [-5,-1,4])line(b,[[x,10],[x+1,4]],'#46433d',1);};
const ashe:Detail=(b,r,stage)=>{if(stage==='head'){hair(b,'#2f2724');scarf(b);}if(stage==='equipment')ellipse(b,r.wrist[0],r.wrist[1],2.3,2.5,GLOW,'#9c4a36');};
const ashRaider:Detail=(b,r,stage)=>{
  if(stage==='head'){hair(b,'#4a4038');line(b,[[-2,-35],[3,-34]],'#982f23',1.3);}
  if(stage==='equipment'){const x=-9,y=-8;line(b,[[x,y],[x-2,y-16]],'#69533a',2);polygon(b,[[x-4,y-16],[x-2,y-25],[x+1,y-20],[x+2,y-16]],MAGMA,'#923b25',.6);}
};
const kharn:Detail=(b,r,stage)=>{
  if(stage==='head'){hair(b,'#3a3230');plane(b,[[0,-40],[4,-38],[4,-32],[0,-31]],'#504c48');polygon(b,[[1,-36],[2,-39],[3,-36],[2,-34]],MAGMA,'transparent',0);}
  if(stage==='body')for(const x of [-4,0,4])ellipse(b,x,-26,1,1.3,'#d6caab',INK);
  if(stage==='equipment'){b.save();b.translate(...r.wrist);b.rotate(r.angle);line(b,[[11,-26],[12,-19],[7,-17]],GLOW,1.3);b.restore();}
};
const pyre:Detail=(b,r,stage)=>{if(stage==='equipment')lantern(b,r,true);if(stage==='head')line(b,[[1,-35],[3,-35]],GLOW,.8);};
const oru:Detail=(b,r,stage)=>{pyre(b,r,stage);if(stage==='head')crown(b);if(stage==='body')for(let i=0;i<5;i++)plane(b,[[-9+i*4,-26],[-7+i*4,-19],[-5+i*4,-26]],'#4a4440');};
const obsidian:Detail=(b,_r,stage)=>{if(stage==='head'){plane(b,[[-4,-39],[0,-44],[4,-39],[4,-33],[-4,-33]],OBSIDIAN);line(b,[[0,-36],[3,-36]],GLOW,1);}if(stage==='body'){plane(b,[[-7,-24],[-2,-28],[6,-24],[5,-11],[-5,-11]],'#39343a');for(const x of [-4,2])plane(b,[[x,-22],[x+3,-25],[x+4,-18],[x,-16]],'#57505a');line(b,[[-4,-24],[2,-19],[-1,-13]],MAGMA,1);}if(stage==='equipment'){plane(b,[[-18,-27],[-3,-28],[-2,3],[-17,5]],'#262224');polygon(b,[[-16,-24],[-5,-25],[-4,1],[-15,2]],'transparent','#625967',.8);line(b,[[-14,-19],[-8,-10],[-13,-4]],MAGMA,1.2);}};
const vashka:Detail=(b,r,stage)=>{if(stage==='head')crown(b);if(stage==='body'){plane(b,[[-7,-25],[-13,-13],[-19,10],[-11,12],[-5,-9]],'#7a2418');line(b,[[-3,-23],[1,-18],[-2,-11]],GLOW,1.3);for(const x of [-17,-13])polygon(b,[[x-2,10],[x,4],[x+2,11]],MAGMA,'transparent',0);}if(stage==='equipment'){b.save();b.translate(...r.wrist);b.rotate(r.angle);line(b,[[39,0],[48,0]],GLOW,1.3);polygon(b,[[42,-1],[45,-7],[48,0]],MAGMA,'transparent',0);b.restore();}};

// Identifying details are re-authored on the low fallen anatomy. No live
// sprite rotation and no burning halo left over from an expired spell.
const fallenMarks=(name:string)=>(b:Brush)=>{
  if(name==='lynn'){line(b,[[-15,-7],[-22,-12]],'#b2ab93',1);line(b,[[-16,-3],[-10,2]],'#797365',1.2);}
  if(name==='du'){polygon(b,[[-18,-2],[-12,-1],[-14,2]],'#b5b1a4',INK,.5);polygon(b,[[-11,8],[-2,7],[0,14],[-10,15]],'#777566',INK,.65);}
  if(name==='ig'||name==='ashe')polygon(b,[[-10,-3],[-4,-1],[-9,2],[-16,3]],'#917d71',INK,.5);
  if(name==='tess'||name==='pyre'||name==='oru'){
    polygon(b,[[24,13],[29,14],[29,18],[24,17]],name==='tess'?'#aaa184':'#887c68',INK,.55);
    if(name==='tess')for(const x of [-8,-3])leafMark(b,x,0,2,'#858a70');
  }
  if(name==='warden'||name==='groveRider')for(const x of [-5,0,5])line(b,[[x,-3],[x+2,3]],'#aaa082',.7);
  if(name==='woman')ellipse(b,-8,10,3.5,2.5,'#a29476',INK);
  if(name==='refugee')for(const x of [9,14,19])line(b,[[x,4],[x-1,7]],'#777268',.7);
  if(name==='kharn')polygon(b,[[-18,-5],[-13,-6],[-12,-2],[-17,-1]],'#68645f',INK,.5);
  if(name==='oru')for(const x of [-7,-3,1])polygon(b,[[x,-4],[x+3,1],[x+5,-3]],'#747168',INK,.4);
  if(name==='obsidian') {polygon(b,[[-12,6],[0,7],[0,15],[-12,14]],'#615b5e',INK,.6);line(b,[[-9,8],[-4,11],[-8,13]],'#91806c',.7);}
  if(name==='vashka')polygon(b,[[-4,-5],[8,-3],[17,5],[1,6]],'#84716a',INK,.5);
  if(name==='alpha')for(const x of [0,4,8])polygon(b,[[x,-6],[x+1,-9],[x+4,-6]],'#969183',INK,.45);
  if(name==='hound')for(const x of [-6,0,6])line(b,[[x,-5],[x+2,-8]],'#9a8c74',.9);
  if(name==='colossus'||name==='broken'){
    ellipse(b,-3,-2,name==='broken'?5:3.5,2.6,'#aa9371',INK);
    if(name==='broken')for(const x of [-12,2,10])line(b,[[x,-5],[x+5,2],[x+2,5]],'#b3a387',1);
  }
};

export const paintLynn=storyFigure('archer',{remains:{detail:fallenMarks('lynn')},headwear:false,cloth:'#4c7a5a',detail:lynn});
export const paintDu=storyFigure('footman',{remains:{detail:fallenMarks('du')},cloth:'#6b705f',detail:du});
export const paintTess=storyFigure('priest',{remains:{detail:fallenMarks('tess')},headwear:false,cloth:'#5d6e4c',weapon:'staff',detail:tess});
export const paintIg=storyFigure('cinderRunner',{remains:{detail:fallenMarks('ig')},headwear:false,cloth:'#5a4c44',shield:false,detail:ig});
export const paintWarden=storyFigure('lancer',{remains:{detail:fallenMarks('warden')},headwear:false,cloth:REED,appearance:{armor:false},detail:warden});
export const paintVillager=storyFigure('worker',{remains:{headwear:true},headwear:false,cloth:'#a58a5c',weapon:'pitchfork',detail:villager});
export const paintVillagerWoman=storyFigure('priest',{remains:{detail:fallenMarks('woman')},headwear:false,cloth:'#8f6f7a',weapon:'none',detail:woman});
export const paintRefugee=storyFigure('summoner',{remains:{detail:fallenMarks('refugee')},cloth:'#77706a',weapon:'staff',detail:refugee});
export const paintAshe=storyFigure('worker',{remains:{detail:fallenMarks('ashe')},headwear:false,cloth:'#8a7f73',weapon:'none',detail:ashe},.85);
export const paintAshRaider=storyFigure('cinderRunner',{headwear:false,cloth:'#9a5a43',shield:false,detail:ashRaider});
export const paintKharn=storyFigure('ashChieftain',{remains:{detail:fallenMarks('kharn')},headwear:false,detail:kharn});
export const paintPyremancer=storyFigure('pyreCaller',{remains:{detail:fallenMarks('pyre')},cloth:'#57302a',detail:pyre});
export const paintOru=storyFigure('pyreCaller',{remains:{detail:fallenMarks('oru')},cloth:'#57302a',detail:oru});
export const paintObsidianGuard=storyFigure('ashWarden',{remains:{detail:fallenMarks('obsidian')},headwear:false,appearance:{armor:false},cloth:OBSIDIAN,detail:obsidian});
export const paintVashka=storyFigure('ashWarden',{remains:{detail:fallenMarks('vashka')},headwear:false,shield:false,cloth:'#3a3230',detail:vashka});
export const paintGroveRider=storyFigure('knight',{remains:{detail:fallenMarks('groveRider')},cloth:'#6f805a',detail:warden});

// Beast details decorate the same neck, limbs and torso used by the catalog.
const wolfDetail=(alpha=false,ember=false)=>(b:Brush,m:MotionPose)=>{
  const strike=m.castGlow?0:m.reach;
  const x=strike*7,neck=-13+strike*3;
  if(alpha) {for(let i=0;i<4;i++)plane(b,[[8-i*5,-13],[10-i*5,-21],[13-i*5,-13]],'#8b8474');line(b,[[29+x,neck-2],[33+x,neck+4]],'#8e2a1c',1);}
  if(ember){for(let i=0;i<5;i++)polygon(b,[[-19+i*6,-14],[-17+i*6,-24+i%2*3],[-14+i*6,-14]],MAGMA,'#773727',.6);for(const x of [-16,-7,3])line(b,[[x,-8],[x+3,-12]],GLOW,.8);}
};
export const paintFenWolf=storyCreature('wildling',{color:'#8b8474',detail:wolfDetail()});
export const paintFenWolfAlpha=storyCreature('wildling',{remains:{detail:fallenMarks('alpha')},color:'#6f685c',size:1.12,detail:wolfDetail(true)});
export const paintCinderHound=storyCreature('wildling',{remains:{detail:fallenMarks('hound')},color:'#3c3431',size:1.05,detail:wolfDetail(false,true)});
const heart=(broken=false)=>(b:Brush,_m:MotionPose)=>{
  ellipse(b,0,-16,broken?9:6,broken?9:6,MAGMA,'#783726');ellipse(b,0,-16,3.5,4,GLOW);
  for(const [x,y] of [[-15,-24],[13,-25],[-12,-8],[11,-5]])line(b,[[0,-16],[x!,y!]],broken?GLOW:MAGMA,broken?1.8:1);
  for(const x of [-6,6])plane(b,[[x-2,-43],[x*1.8,-51],[x+2,-43]],OBSIDIAN);
};
export const paintColossus=storyCreature('golem',{remains:{detail:fallenMarks('colossus')},color:'#353033',crown:false,detail:heart()});
export const paintColossusBroken=storyCreature('golem',{remains:{detail:fallenMarks('broken')},color:'#353033',crown:false,detail:heart(true)});
const canopy=(elder=false)=>(b:Brush,m:MotionPose)=>{
  for(const [x,y,r] of [[-12,-46,elder?12:8],[0,-51,elder?14:10],[12,-44,elder?10:7]])ellipse(b,x!,y!,r!,r!*.7,MOSS,'#526951');
  line(b,[[-3,-35],[6,-35]],'#e8d98a',1.3);
  for(const side of [-1,1]){const strike=m.castGlow?0:m.reach,x=side*24+strike*8,y=-1-strike*9;line(b,[[x,y],[x+side*3,y-9]],'#6f5c3f',2);leafMark(b,x+side*3,y-10,3.5,'#829755');}
  if(elder)plane(b,[[-3,-32],[3,-32],[1,-22],[-2,-25]],'#a9b58a');
};
export const paintElder=storyCreature('stonebackBrute',{color:'#7c6a48',size:1,crown:false,detail:canopy(true)});
export const paintTreant=storyCreature('stonebackBrute',{color:'#86734c',size:.88,crown:false,detail:canopy()});
export const MODEL_PALETTE={TEAL,REED,OBSIDIAN,MAGMA,MOSS,STEEL};
