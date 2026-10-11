/** Equipment is authored around a grip at (0,0), then attached to the solved wrist. */
import { type Brush, type XY, line, ellipse } from './kit';
import { INK, STEEL, EDGE, SHADE, HIDE, ITEM_MATERIAL, paintedPlane as poly, segment as seg } from './materials';
import { darker, lighter } from './kit';
import { arm, hand } from './body-parts';
import type { Figure } from './appearance';
import type { FigureRig } from './rig';
export type EquipmentKind = 'none' | 'sling' | 'javelin' | 'club' | 'pitchfork' | 'sword' | 'greatSword' | 'axe' | 'pike' | 'bow' | 'staff' | 'crozier' | 'pick';
export function shield(b:Brush,x:number,y:number,team:string,elite:boolean,facing:number,round=false){
  if(round){
    ellipse(b,x,y,9,11,ITEM_MATERIAL.leather,ITEM_MATERIAL.steel);
    line(b,[[x-6,y-7],[x-6,y+6]],'#a18b68',1);
    line(b,[[x+3,y-8],[x+3,y+8]],'#443b32',.8);
    ellipse(b,x,y,3,3.5,ITEM_MATERIAL.steel,INK);line(b,[[x-7,y-5],[x+7,y-5]],EDGE,.8);return;
  }
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
function sword(b:Brush,wrist:XY,angle:number,axe:boolean,great=false){
  b.save();b.translate(...wrist);b.rotate(angle);
  if(great)b.scale(1.15,1.15);
  seg(b,[0,great?8:3],[0,-4],2.2,HIDE,false);
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

export function paintEquipment(b:Brush,f:Figure,team:string,facing:1|-1,rig:FigureRig,cloth:string){
  const {impact,cast,wrist}=rig; const armor=!!f.armor;
  if(rig.weapon!=='pike'&&rig.weapon!=='pitchfork'&&rig.weapon!=='bow')arm(b,rig.shoulder,rig.elbow,wrist,cloth,armor,false);
  if(rig.weapon==='bow'){
    // Rear quiver, an actual drawing arm, and a string that relaxes on release.
    poly(b,[[-11,-26],[-7,-27],[-4,-12],[-8,-11]],HIDE);
    for(const x of [-10,-8])line(b,[[x,-25],[x-2,-34]],'#c8bba0',.8);
    const pull=.35*(1-rig.motion.recoil);
    const nock=rig.support;
    arm(b,rig.shoulder,rig.elbow,wrist,cloth,false,true);
    arm(b,[-5,-23],[1-pull*4,-18],nock,cloth,false,true);
    b.save();b.translate(...wrist);b.rotate(rig.angle);
    b.beginPath();b.moveTo(0,-18);b.bezierCurveTo(12,-10,11,11,0,18);b.strokeStyle='#463d31';b.lineWidth=2.1;b.stroke();
    b.beginPath();b.moveTo(0,-17);b.bezierCurveTo(10,-8,10,10,0,17);b.strokeStyle='#b7a078';b.lineWidth=.8;b.stroke();
    line(b,[[0,-18],[-3-pull*9,0],[0,18]],'#c8c0a8',.6);
    if(rig.motion.recoil<.5){line(b,[[-12,0],[12,0]],'#b9ae91',.8);poly(b,[[12,-2],[16,0],[12,2]],EDGE);}
    b.restore();hand(b,wrist);hand(b,nock);
  }else if(rig.weapon==='staff'||rig.weapon==='crozier'){
    arm(b,[-5,-23],[-10,-15-cast*7],[-13+cast*4,-12-cast*15],cloth,false,true);
    b.save();b.translate(...wrist);b.rotate(rig.angle);
    const top:XY=[0,-23];
    seg(b,[0,26],top,1.8,'#897151',true);
    if(rig.weapon==='crozier'){
      line(b,[[top[0]-4,top[1]+4],[top[0]+4,top[1]+4]],'#c0ac79',1.5);
      poly(b,[[top[0],top[1]-3],[top[0]+2.5,top[1]+1],[top[0],top[1]+5],[top[0]-2.5,top[1]+1]],'#ded0a0');
    }else{
      ellipse(b,top[0],top[1],4,5,'#333b3b','#a99873');
      ellipse(b,top[0]-.5,top[1]-1,2,3,f.ember?'#cf8b4f':'#a1beb5');
    }
    if(cast){
      b.save();b.globalAlpha*=cast*.65;
      ellipse(b,top[0],top[1],6+cast*4,7+cast*4,f.ember?'#e9a85435':'#c0d6bf35');
      line(b,[[top[0]-6,top[1]],[top[0]+6,top[1]]],'#ede4bf',.8);
      line(b,[[top[0],top[1]-8],[top[0],top[1]+8]],'#ede4bf',.8);b.restore();
    }
    b.restore();
  }else if(rig.weapon==='pike'||rig.weapon==='pitchfork'){
    // Rigid shaft rotates around the gripping hand; the tip and butt never
    // move independently. A mounted lance stays couched, with a short recovery.
    const grip=wrist;
    const angle=rig.angle;
    arm(b,[5,-23],[7,-17],grip,cloth,armor,true);
    b.save();b.translate(...grip);b.rotate(angle);
    seg(b,[-23,0],[40,0],f.mounted?2.2:1.8,'#877052',true);
    if(rig.weapon==='pitchfork'){
      line(b,[[36,-5],[36,5]],STEEL,1.6);
      for(const y of [-5,0,5])line(b,[[36,y],[45,y]],EDGE,1.4);
    }else{poly(b,[[39,-2],[48,0],[39,2],[36,0]],STEEL);line(b,[[39,-1.5],[47,0]],EDGE,.7);}
    // Grip wrap and a modest hand guard make the attachment legible at 1x.
    line(b,[[-3,0],[2,0]],HIDE,3);
    if(f.mounted)poly(b,[[3,-3.5],[5,-2],[5,2],[3,3.5]],'#a49d88');
    b.restore();hand(b,grip);
    if(rig.shield)shield(b,-9,-10,team,!!f.elite,facing,rig.shieldStyle==='round');
    else arm(b,[-5,-23],[-3,-15],rig.support,cloth,armor,true);
  }else if(rig.weapon==='pick'){
    const support=rig.support;
    arm(b,[-5,-23],[0,-16],support,cloth,false,true);
    b.save();b.translate(...wrist);b.rotate(rig.angle);
    seg(b,[0,7],[0,-22],1.9,'#9a8058',true);
    poly(b,[[-9,-18],[-4,-23],[3,-23],[10,-18],[3,-20],[-3,-20]],STEEL);b.restore();
    poly(b,[[-6,-9],[-1,-9],[-1,-3],[-7,-2]],HIDE);
  }else if(rig.weapon==='none'){
    arm(b,[-5,-23],[-10,-16],[-8,-3-cast*18-impact*10],cloth,armor,true);
    if(rig.shield)shield(b,-9,-10,team,!!f.elite,facing,rig.shieldStyle==='round');
  }else{
    if(rig.weapon==='sling'){
      b.save();b.translate(...wrist);b.rotate(rig.angle);
      line(b,[[-1,0],[-2,17],[2,17],[1,0]],'#9d8d6b',.85);
      poly(b,[[-2,16],[2,16],[3,20],[-3,20]],HIDE);
      if(impact<.7)ellipse(b,0,17.5,1.6,1.4,'#a5a593');b.restore();
    }else if(rig.weapon==='javelin'){if(impact<.7)paintRigidEquipment(b,'javelin',wrist,rig.angle);}
    else if(rig.weapon==='club')paintRigidEquipment(b,'club',wrist,rig.angle);
    else sword(b,wrist,rig.angle,rig.weapon==='axe',rig.weapon==='greatSword');
    if(rig.shield)shield(b,-9,-10,team,!!f.elite,facing,rig.shieldStyle==='round');
    else if(rig.weapon==='greatSword'){
      const support=rig.support;
      arm(b,[-5,-23],[2,-16],support,cloth,armor,true);
    }
    else arm(b,[-6,-23],[-10,-15],[-9,-8],cloth,armor,true);
  }
  if(rig.weapon!=='bow')hand(b,wrist);
}

/** Rigid tool assets accept sockets from any compatible anatomical rig. */
export function paintRigidEquipment(b:Brush,weapon:'club'|'staff'|'pike'|'javelin',grip:XY,angle:number,cast=0){
  b.save();b.translate(...grip);b.rotate(angle);
  if(weapon==='club'){
    seg(b,[0,5],[0,-31],2.8,'#706149',true);
    poly(b,[[-5,-29],[-3,-38],[5,-37],[7,-26],[2,-22],[-4,-24]],'#697170');
    line(b,[[-3,-35],[-3,-27]],EDGE,.9);
  }else if(weapon==='pike'||weapon==='javelin'){
    const top=weapon==='javelin'?-16:-22;
    seg(b,[0,weapon==='javelin'?14:25],[0,top],1.8,'#958572',true);
    poly(b,[[-3,top],[0,top-10],[3,top]],STEEL);line(b,[[-1,top-1],[0,top-8]],EDGE,.7);
  }else{
    seg(b,[0,25],[0,-24],2,'#897151',true);
    ellipse(b,0,-25,4,5,'#394b50','#a99873');ellipse(b,-1,-26,1.5,2.5,'#b8c7b5');
    if(cast){b.globalAlpha*=cast;ellipse(b,0,-25,9,10,'#dae3bd55');}
  }
  line(b,[[0,-2],[0,2]],HIDE,3);
  b.restore();
}
