/** The same material study is used in shops, inventories and world drops. */
import type { ItemKind } from '../../shared/types';
import { type Brush, type Point, polygon, ellipse, line } from './kit';

const INK = '#303738', PAPER = '#d9c9a7', GOLD = '#b7a274', STEEL = '#a8b3ad', LEATHER = '#80644c';
export function drawPaintedItem(b: Brush, kind: ItemKind, point: Point, size = 32, ground = false) {
  b.save(); b.translate(point.x,point.y); b.scale(size/40,size/40);
  b.lineJoin='round'; b.lineCap='round';
  if (ground) ellipse(b,2,15,15,4,'#222a3040');
  const plane=(p:number[][],fill:string)=>polygon(b,p,fill,INK,.9);
  const edge=(p:number[][],fill=GOLD,width=1)=>line(b,p,fill,width);
  switch(kind) {
    case 'speedBoots':
      for(const [dx,dy] of [[-8,-3],[5,4]]) {
        b.save(); b.translate(dx!,dy!);
        plane([[-6,-16],[4,-15],[3,2],[11,6],[12,11],[-7,11],[-8,6]],LEATHER);
        plane([[-7,8],[11,8],[12,12],[-7,12]],'#423e36');
        edge([[-5,-13],[-4,5],[5,7]],'#bc9d76');
        for(const y of [-9,-3]) { plane([[-6,y],[4,y],[4,y+3],[-6,y+3]],'#574b3e'); plane([[-1,y],[3,y],[3,y+3],[-1,y+3]],GOLD); }
        b.restore();
      } break;
    case 'regenRing':
      ellipse(b,0,3,11,10,'#887248',INK); ellipse(b,0,4,7.3,6.5,'#263037',GOLD);
      edge([[-9,0],[-7,-5],[0,-7],[8,-3]],'#dfcca4',1.3);
      plane([[-6,-8],[0,-14],[7,-8],[1,-3]],'#647f78');
      plane([[0,-14],[1,-3],[7,-8]],'#9aac94'); edge([[-5,-8],[0,-13],[3,-10]],'#d3d9b5'); break;
    case 'healingScroll': case 'guardianScroll':
      plane([[-12,-11],[12,-11],[12,13],[-12,13]],PAPER);
      plane([[7,-10],[12,-10],[12,13],[7,13]],'#b19e7e');
      for(const y of [-11,13]) { ellipse(b,0,y,14,3.3,'#c5ae83',INK); edge([[-11,y-1],[9,y-1]],'#f0dfbc'); }
      for(const y of [-5,-1,3]) edge([[-7,y],[5,y]],'#86745d',.65);
      if(kind==='healingScroll') { plane([[-2,-5],[2,-5],[2,-1],[6,-1],[6,3],[2,3],[2,7],[-2,7],[-2,3],[-6,3],[-6,-1],[-2,-1]],'#9c6050'); }
      else { ellipse(b,0,4,6,6,'#697d83',INK); edge([[-3,3],[0,0],[3,3],[0,8],[-3,3]],'#d1c59f'); }
      break;
    case 'experienceBook':
      plane([[-14,-13],[9,-16],[15,-10],[15,13],[-9,17],[-14,12]],'#635d57');
      plane([[-9,11],[14,7],[14,13],[-9,17]],PAPER);
      plane([[-14,-13],[9,-16],[13,-12],[13,7],[-9,12],[-14,8]],'#647675');
      edge([[-10,-11],[-10,9],[10,5]],GOLD); edge([[-6,-7],[6,-10]],GOLD,.7);
      plane([[-2,-5],[4,-6],[4,2],[-2,4]],GOLD); edge([[0,-5],[0,3]],'#dfd2a9'); break;
    case 'flameCloak':
      plane([[-6,-16],[7,-16],[11,-9],[17,13],[6,16],[0,13],[-9,16],[-17,12],[-10,-8]],'#985d4d');
      plane([[-3,-11],[0,12],[-9,16],[-5,1]],'#6e4b43');
      plane([[4,-12],[11,11],[6,16],[1,13]],'#b77b5b');
      edge([[-9,-9],[-6,-15],[6,-15],[10,-9]],GOLD); ellipse(b,0,-12,2,2,STEEL);
      edge([[-12,10],[-9,13],[-4,10],[1,12],[5,9],[11,12]],'#d0a370'); break;
    case 'lightningRod': case 'stormStaff':
      edge([[-10,16],[8,-11]],INK,4.4); edge([[-10,16],[8,-11]],kind==='stormStaff'?LEATHER:STEEL,2.4);
      for(const t of [0,1,2]) edge([[-5+t*3,8-t*4],[-1+t*3,9-t*4]],GOLD,.8);
      if(kind==='lightningRod') {
        plane([[5,-12],[9,-19],[14,-14],[11,-11],[15,-7],[9,-7],[6,-10]],'#b8ac81');
        edge([[9,-17],[11,-14],[9,-11]],'#e5ddbc');
      } else {
        ellipse(b,8,-12,7,7,'#657f8b',INK); ellipse(b,6,-14,2,2,'#bdc4b4');
        edge([[1,-12],[2,-17],[7,-19],[13,-16],[15,-11]],GOLD,1.3);
      } break;
    case 'breachCharge':
      plane([[-12,-8],[-6,-13],[10,-10],[13,-4],[11,13],[-11,13]],'#7a6a58');
      plane([[-7,-11],[7,-9],[7,12],[-7,12]],'#a27f58');
      for(const y of [-4,8]) plane([[-12,y],[12,y],[12,y+3],[-12,y+3]],'#4e5858');
      edge([[1,-11],[2,-18],[7,-18],[9,-15]],GOLD,1.3); ellipse(b,9,-15,1.2,1.2,'#cf9a64'); break;
    case 'ivoryTower':
      plane([[-12,11],[1,6],[14,10],[0,16]],'#7c7770');
      plane([[-7,-11],[5,-14],[5,8],[-7,12]],'#c5c6b5');
      plane([[5,-14],[11,-10],[11,11],[5,8]],'#8d9e9b');
      plane([[-10,-14],[2,-18],[13,-13],[4,-9]],PAPER);
      for(const x of [-7,-1,5])plane([[x,-16],[x+3,-17],[x+3,-12],[x,-11]],'#dfd5bb');
      plane([[-3,3],[1,1],[1,10],[-3,11]],'#465456'); edge([[-6,-7],[-6,8]],'#e3dcc5'); break;
  }
  b.restore();
}
