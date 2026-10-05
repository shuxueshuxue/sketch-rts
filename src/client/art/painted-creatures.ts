/** Non-human silhouettes use the same warm light, cool shadow and fine ink as
 * the soldiers. Anatomy and equipment remain legible at battlefield scale. */
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
import { type Brush, polygon, ellipse, line, darker, lighter } from './kit';

type Shape = 'hound' | 'stag' | 'spider' | 'dragon' | 'stone' | 'ogre' | 'fish' | 'turtle' | 'spirit' | 'ship' | 'wood';
const creatures: Partial<Record<UnitKind, { shape: Shape; color: string; size?: number; crown?: boolean }>> = {
  wildling: {shape:'hound',color:'#80735a'}, mossGnawer:{shape:'hound',color:'#666d50'},
  ancientStag:{shape:'stag',color:'#8b7657'},
  spiderling:{shape:'spider',color:'#756e61',size:.7}, venomSpider:{shape:'spider',color:'#60624c'}, spiderQueen:{shape:'spider',color:'#59505a',size:1.17,crown:true},
  dragonWhelp:{shape:'dragon',color:'#a17b5e',size:.8}, redDragon:{shape:'dragon',color:'#8d5445',size:1.17,crown:true},
  golem:{shape:'stone',color:'#747b71',crown:true}, rubbleGolem:{shape:'stone',color:'#a0957f',size:.8}, rockGolem:{shape:'stone',color:'#7d8078'}, graniteGolem:{shape:'stone',color:'#646b70',size:1.17,crown:true},
  stonebackBrute:{shape:'wood',color:'#707360',size:1.12},
  ogreWarrior:{shape:'ogre',color:'#998875',size:.88}, ogreMage:{shape:'ogre',color:'#819195',size:.88}, ogreLord:{shape:'ogre',color:'#8d8074',size:1.02,crown:true},
  murlocPeon:{shape:'fish',color:'#848c70',size:.86}, murlocHunter:{shape:'fish',color:'#72817d'}, tidePriest:{shape:'fish',color:'#697d8a',crown:true},
  deepSnapper:{shape:'turtle',color:'#697564'}, spirit:{shape:'spirit',color:'#c5c9b9'},
  transport:{shape:'ship',color:'#877258'}, warship:{shape:'ship',color:'#706251',crown:true},
};
export const hasPaintedCreature = (kind: UnitKind) => !!creatures[kind];
export function creatureShadow(kind: UnitKind) {
  const def = creatures[kind];
  if (!def || def.shape === 'ship' || def.shape === 'spirit') return undefined;
  const rx = def.shape === 'ogre' || def.shape === 'stone' || def.shape === 'wood' ? 22 : def.shape === 'fish' ? 18 : def.shape === 'spider' ? 29 : 31;
  return { rx: rx * (def.size ?? 1), ry: (def.shape === 'ogre' ? 5.5 : 5) * (def.size ?? 1), y: def.shape === 'ogre' ? 18 : (def.shape === 'stone' || def.shape === 'wood' ? 23 : 18) * (def.size ?? 1) };
}
const ink='#30312e';
function plane(b: Brush, points: number[][], color: string) {
  polygon(b, points, color, ink, .65);
  b.save(); b.clip();
  const xs=points.map(p=>p[0]!),ys=points.map(p=>p[1]!);
  const x=Math.min(...xs), y=Math.min(...ys), w=Math.max(...xs)-x, h=Math.max(...ys)-y;
  const glaze=b.createLinearGradient(x,y,x+w,y+h);
  glaze.addColorStop(0,'#e4d3ac26');glaze.addColorStop(.45,'#e4d3ac00');glaze.addColorStop(1,'#1d29312d');
  b.fillStyle=glaze;b.fillRect(x,y,w,h);
  for(let i=0;i<Math.min(40,w*h/10);i++) {
    const f=(v:number)=>{const r=Math.sin(v)*43758.5453;return r-Math.floor(r);};
    const xx=x+f(i*12.31+x)*w,yy=y+f(i*7.7+y)*h;
    line(b,[[xx,yy],[xx+1,yy+.7]],i%2?'#e5dac024':'#252d2924',.45);
  }
  b.restore();
  // Every plane receives the same upper-left grazing light.
  line(b, points.slice(0, 3), lighter(color,.25), .8);
}
function limb(b: Brush, points: number[][], color: string, width: number) {
  line(b,points,ink,width+1.3); line(b,points,color,width);
  line(b,points.map(([x,y])=>[x!-.7,y!-.6]),lighter(color,.2),Math.max(.7,width*.23));
}
export function paintCreature(b: Brush, kind: UnitKind, team: string, pose: UnitAnimationFrame) {
  const def=creatures[kind]; if(!def) return false;
  const {shape,color,crown}=def;
  const walk=pose.mode==='walk'?Math.sin(pose.frame/8*Math.PI*2):0;
  const strike=pose.mode==='attack'||pose.mode==='cast'?Math.sin(pose.frame/5*Math.PI):0;
  const size = def.size ?? 1;
  b.save();
  if (shape === 'ogre') b.translate(0, 18 - 23 * size);
  b.scale(size,size);
  if(shape==='ship') {
    ellipse(b,0,20,43,7,'#b1b7a92b');
    line(b,[[-45,20],[-22,25],[24,25],[45,17]],'#d3d3bd88',1);
    plane(b,[[-43,4],[-28,22],[26,22],[44,0],[10,9]],darker(color,.22));
    plane(b,[[-43,4],[-14,-8],[31,-8],[44,0],[10,9]],color);
    for(let y=0;y<16;y+=4) line(b,[[-30,y+4],[24,y+4]],'#3e38303d',.7);
    limb(b,[[0,8],[0,-48]],'#918476',2.1);
    plane(b,[[2,-43],[27,-34],[31,-9],[2,-13]],'#c6c1ac');
    plane(b,[[-2,-43],[-21,-31],[-24,-11],[-2,-13]],'#9c9d90');
    line(b,[[0,-47],[-35,3]],'#514a40',.65); line(b,[[0,-47],[36,0]],'#514a40',.65);
    plane(b,[[0,-48],[16,-46],[12,-40],[0,-42]],team);
    if(crown) for(const x of [-21,14]) { ellipse(b,x,5,6,4,'#414645'); limb(b,[[x,5],[x+9,-1]],'#7c8380',3); }
  } else if(shape==='spider') {
    for(const side of [-1,1]) for(let i=0;i<4;i++) {
      const phase=walk*(i%2?1:-1)*3;
      limb(b,[[side*6,-5+i*4],[side*(20+i*2),-16+i*9+phase],[side*(31+i*2),16+i*.3]],darker(color,.18),1.5);
    }
    ellipse(b,-8,-7,16,12,darker(color,.25),ink);
    plane(b,[[-23,-8],[-12,-20],[0,-17],[6,-7],[-8,2]],color);
    ellipse(b,9,0,9,8,color,ink);
    for(const y of [-3,1]) ellipse(b,15,y,1.1,1,'#c6b892');
    limb(b,[[15,5],[21,7],[20,12]],'#b6ac92',1.6);
    if(crown) line(b,[[-16,-13],[-8,-10],[-13,-6]],'#bba98a',1.5);
  } else if(shape==='stone'||shape==='wood'||shape==='ogre') {
    for(const side of [-1,1]) {
      const stride=side*walk*4;
      limb(b,[[side*9,-1],[side*12,9],[side*13+stride,20]],darker(color,.2),8);
      plane(b,[[side*13+stride-6,16],[side*13+stride+4,16],[side*13+stride+8,22],[side*13+stride-6,23]],color);
      limb(b,[[side*17,-23],[side*23,-9],[side*24+strike*8,-1-strike*9]],color,9);
    }
    plane(b,[[-20,-25],[-9,-33],[12,-32],[21,-20],[12,3],[-12,3]],color);
    plane(b,[[2,-30],[19,-22],[12,3],[2,0]],darker(color,.23));
    plane(b,[[-9,-43],[4,-46],[11,-38],[8,-27],[-7,-27],[-12,-35]],lighter(color,.05));
    line(b,[[-2,-35],[7,-35]],'#292d29',1.5);
    if(shape==='ogre'){
      plane(b,[[-3,-34],[1,-32],[5,-30],[3,-27],[-2,-28]],darker(color,.12));
      line(b,[[-5,-29],[5,-29]],'#4b4138',.8);
      for(const x of [-5,5]) plane(b,[[x-1,-27],[x,-32],[x+2,-27]],'#c7bfa6');
      line(b,[[-14,-19],[-4,-21],[0,-13],[8,-21],[16,-19]],lighter(color,.18),1.2);
      line(b,[[0,-10],[0,-2]],darker(color,.25),.8);
    }
    if(shape==='ogre') {
      plane(b,[[-13,-1],[12,-1],[18,11],[-16,11]],'#655747');
      limb(b,[[24,-1],[35,-32+strike*12]],'#706149',3);
      plane(b,[[29,-34+strike*12],[37,-40+strike*12],[43,-27+strike*12],[34,-22+strike*12]],'#697170');
      plane(b,[[-16,-23],[-7,-25],[-6,-15],[-16,-12]],team);
    } else for(let i=0;i<5;i++) line(b,[[-14+i*6,-24+i%2*4],[-9+i*5,-16],[-12+i*5,-8]],darker(color,.32),.7);
    if(crown) for(const x of [-7,0,7]) plane(b,[[x-3,-43],[x,-51],[x+3,-43]],'#b2a684');
  } else if(shape==='fish') {
    limb(b,[[-5,1],[-11,14],[-18,17]],color,4); limb(b,[[7,2],[13,12+walk*3],[22,14]],color,4);
    plane(b,[[-13,-23],[-7,-35],[5,-27],[15,-20],[11,4],[-8,6]],color);
    plane(b,[[-9,-22],[-20,-27],[-13,-8],[-18,0],[-8,5]],darker(color,.22));
    plane(b,[[6,-26],[23,-20],[27,-14],[9,-13]],lighter(color,.1));
    ellipse(b,16,-23,1.3,1.5,'#d8c9a5');
    limb(b,[[9,-9],[19,-4],[25,-11-strike*7]],color,3);
    limb(b,[[25,14],[25,-35-strike*7]],'#958572',1.7);
    plane(b,[[22,-33-strike*7],[25,-43-strike*7],[28,-33-strike*7]],'#b3b9b3');
    if(crown) plane(b,[[-7,-33],[-8,-46],[3,-36],[10,-43],[9,-29]],'#a69f81');
  } else if(shape==='spirit') {
    for(let i=3;i>0;i--) ellipse(b,0,-11,i*6,i*10,`rgba(185,198,188,${.07+i*.015})`);
    plane(b,[[-4,-35],[7,-34],[11,-20],[6,-5],[13,13],[0,7],[-8,17],[-5,-5],[-12,-17]],'#b6bfb0aa');
    line(b,[[-2,-29],[3,-29]],'#f4e8c9',1);
  } else {
    const dragon=shape==='dragon', stag=shape==='stag', turtle=shape==='turtle';
    for(const side of [-1,1]) for(const x of [-17,16]) {
      const stride=walk*side*(x<0?-1:1)*5+side*2.5;
      limb(b,[[x,0],[x+stride,10],[x+stride+4,18]],darker(color,side===1?.08:.27),turtle?4:3);
    }
    plane(b,[[-28,-8],[-17,-18],[12,-18],[26,-7],[15,6],[-18,6]],color);
    plane(b,[[-24,-4],[3,-2],[23,-8],[15,6],[-18,6]],darker(color,.2));
    if(turtle) {
      plane(b,[[-27,-7],[-15,-25],[8,-27],[23,-14],[17,0],[-14,4]],'#686953');
      for(let i=0;i<4;i++) line(b,[[-17+i*9,-19],[-14+i*8,-7],[-18+i*9,2]],'#a6a58b',.8);
    }
    const neck=stag?-27:dragon?-20:-13;
    plane(b,[[15,-8],[19,neck],[28,neck-5],[35,neck+1],[39,neck+5],[26,neck+10],[23,2]],color);
    ellipse(b,30,neck+1,1,1,'#d3c49a');
    limb(b,[[-25,-4],[-36,-1],[-45,dragon?-12:6]],color,dragon?4:2);
    if(stag) for(const side of [-1,1]) {
      limb(b,[[24,neck-3],[24+side*8,-41],[25+side*14,-48]],'#b9b09a',1.5);
      limb(b,[[24+side*8,-41],[22+side*3,-48]],'#b9b09a',1.1);
    }
    if(dragon) {
      const lift=walk*4+strike*6;
      for(const side of [-1,1]) {
        b.save(); if(side===-1)b.translate(12,-2);
        plane(b,[[-3,-11],[-20,-39-lift],[-43,-29],[-32,-16],[-27,-4],[-18,-14]],side===1?'#896451':'#5b5550');
        plane(b,[[-20,-39-lift],[-38,-29],[-31,-20],[-24,-21]],side===1?'#a18164':'#776a59');
        for(const tip of [[-43,-29],[-32,-16],[-27,-4]])line(b,[[-20,-39-lift],tip],side===1?'#c1a27a':'#93856d',.75);
        line(b,[[-3,-11],[-20,-39-lift],[-43,-29]],'#cfb28b',1.1);
        b.restore();
      }
      // The neck, jaw and claw highlights carry the silhouette at game scale.
      plane(b,[[15,-8],[20,-18],[29,-23],[36,-18],[40,-15],[31,-12],[23,2]],color);
      plane(b,[[24,-12],[35,-15],[31,-8],[23,2]],'#b39a73');
      line(b,[[30,-17],[35,-17]],'#e1bc6d',1.1);
      line(b,[[31,-12],[39,-15]],'#352d28',1.1);
      for(const x of [24,29])plane(b,[[x,-21],[x-6,-30],[x+2,-23]],'#c3b798');
      for(let i=0;i<5;i++)plane(b,[[-22+i*7,-16],[-25+i*7,-24+i*.5],[-17+i*7,-16]],'#b29f7d');
      for(const x of [-15,20])for(let i=0;i<3;i++)line(b,[[x+i*2,16],[x+i*2+2,19]],'#d2c5a4',.9);
      if(crown)line(b,[[19,-19],[23,-16],[24,-10]],'#d3ac6e',1);

    }
  }
  b.restore(); return true;
}
