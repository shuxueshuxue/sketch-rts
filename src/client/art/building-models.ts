/** Small authored 3D constructions, orthographically projected into the Canvas
 * atlas. Shared camera, material lighting and ground-plane shadow projection.
 * Geometry is cached as a sprite by atlas-art; no mesh work in steady frames. */
import type { BuildingKind } from '../../shared/types';
import { type Brush, polygon, line, darker } from './kit';
type V = [number,number,number];
type Face = { p:V[]; color:string; normal:V; grain:number };
const STONE='#dfd3b7', CUT='#b8b5a0', WOOD='#8b7054', SLATE='#71928f', IRON='#86948f';
const project=([x,y,z]:V):[number,number]=>[x*.82-y*.57,x*.28+y*.4-z+19];
function tint(hex:string,light:number){
  const n=parseInt(hex.slice(1),16);
  return `rgb(${[16,8,0].map((s,i)=>Math.max(0,Math.min(255,Math.round(((n>>s)&255)*light+(light<.9 ? [0,4,9][i]! : [8,5,0][i]!))))).join(',')})`;
}
class Construction {
  faces:Face[]=[];
  face(p:V[],color:string,normal:V,grain=1){this.faces.push({p,color,normal,grain});}
  box(x:number,y:number,z:number,w:number,d:number,h:number,color:string,grain=1){
    const a=x-w/2,aa=x+w/2,bb=y+d/2,q=y-d/2,top=z+h;
    this.face([[a,bb,z],[aa,bb,z],[aa,bb,top],[a,bb,top]],color,[0,1,0],grain);
    this.face([[aa,q,z],[aa,bb,z],[aa,bb,top],[aa,q,top]],color,[1,0,0],grain);
    this.face([[a,q,top],[aa,q,top],[aa,bb,top],[a,bb,top]],color,[0,0,1],grain);
    this.face([[a,q,z],[a,q,top],[aa,q,top],[aa,q,z]],color,[0,-1,0],grain);
    this.face([[a,q,z],[a,bb,z],[a,bb,top],[a,q,top]],color,[-1,0,0],grain);
    this.face([[a,q,z],[aa,q,z],[aa,bb,z],[a,bb,z]],color,[0,0,-1],0);
  }
  roof(x:number,y:number,z:number,w:number,d:number,h:number,color=SLATE){
    const a=x-w/2,aa=x+w/2,q=y-d/2,bb=y+d/2;
    this.face([[a,q,z],[aa,q,z],[aa,y,z+h],[a,y,z+h]],color,[0,-.75,.66]);
    this.face([[a,y,z+h],[aa,y,z+h],[aa,bb,z],[a,bb,z]],color,[0,.75,.66]);
    this.face([[aa,q,z],[aa,bb,z],[aa,y,z+h]],STONE,[1,0,0]);
    this.face([[a,q,z],[a,y,z+h],[a,bb,z]],STONE,[-1,0,0]);
    this.face([[a,q,z],[a,bb,z],[aa,bb,z],[aa,q,z]],color,[0,0,-1]);
    // Slate courses follow the actual roof plane, not screen-space stripes.
    for(let row=1;row<5;row++){
      const t=row/5,yy=y+(d/2)*t,zz=z+h*(1-t)+.18;
      this.face([[a,yy,zz],[aa,yy,zz],[aa,yy+.35,zz-.15],[a,yy+.35,zz-.15]],'#9a9c8b',[0,.75,.66],0);
      for(let k=0;k<5;k++){
        const xx=a+(k+(row%2)*.5)*w/5;
        this.face([[xx,yy,zz+.03],[xx+.35,yy,zz+.03],[xx+.35,yy+d/10,zz-h/5],[xx,yy+d/10,zz-h/5]],'#39494b',[0,.75,.66],0);
      }
    }
    this.box(x,y,z+h-.5,w+1,1.2,1.2,'#a6a18b',0);
  }
  // Tapered polygonal masses give each building a legible roof/body silhouette.
  drum(x:number,y:number,z:number,r:number,h:number,color:string,n=8,top=r){
    for(let i=0;i<n;i++){
      const a=i*Math.PI*2/n,q=(i+1)*Math.PI*2/n,mid=(a+q)/2;

      this.face([[x+Math.cos(a)*r,y+Math.sin(a)*r,z],[x+Math.cos(q)*r,y+Math.sin(q)*r,z],[x+Math.cos(q)*top,y+Math.sin(q)*top,z+h],[x+Math.cos(a)*top,y+Math.sin(a)*top,z+h]],color,[Math.cos(mid),Math.sin(mid),0]);
    }
    this.face(Array.from({length:n},(_,i)=>[x+Math.cos(-i*2*Math.PI/n)*r,y+Math.sin(-i*2*Math.PI/n)*r,z] as V),color,[0,0,-1]);
    this.face(Array.from({length:n},(_,i)=>[x+Math.cos(i*2*Math.PI/n)*top,y+Math.sin(i*2*Math.PI/n)*top,z+h] as V),color,[0,0,1]);
  }
  cap(x:number,y:number,z:number,r:number,h:number,color=SLATE,n=8){
    for(let i=0;i<n;i++){
      const a=i*Math.PI*2/n,q=(i+1)*Math.PI*2/n,mid=(a+q)/2;
      this.face([[x+Math.cos(a)*r,y+Math.sin(a)*r,z],[x+Math.cos(q)*r,y+Math.sin(q)*r,z],[x,y,z+h]],color,[Math.cos(mid)*.65,Math.sin(mid)*.65,.76]);
    }
  }
  banner(x:number,y:number,z:number,team:string){
    this.box(x,y,0,.9,.9,z+2,WOOD,0);
    this.face([[x+.5,y,z],[x+9,y,z-1],[x+7,y,z-8],[x+.5,y,z-7]],team,[0,1,0],0);
  }
  door(x:number,y:number,z:number,w:number,h:number){
    const p:V[]=[[x-w/2,y,z],[x+w/2,y,z],[x+w/2,y,z+h*.7],[x+w*.3,y,z+h*.92],[x,y,z+h],[x-w*.3,y,z+h*.92],[x-w/2,y,z+h*.7]];
    this.face(p,'#303831',[0,1,0],0);
    this.box(x-w/2-1,y, z,1.4,1.4,h*.72,CUT);this.box(x+w/2+1,y,z,1.4,1.4,h*.72,CUT);
    this.box(x,y+2,0,w+5,5,1.5,CUT);
  }
  fence(x:number,y:number,w:number){
    for(let i=0;i<=4;i++)this.box(x-w/2+i*w/4,y,0,1.3,1.3,8,WOOD);
    for(const z of [3,6])this.box(x,y,z,w,1,1,WOOD);
  }
}
const BASALT='#898b7c', COPPER='#b3825d', BRASS='#d2b779';
export type SiteModelKind = 'citadel' | 'shop' | 'camp' | 'well' | 'statue' | 'beacon' | 'fort-lance' | 'fort-flame' | 'fort-mortar' | 'fort-ward' | 'fort-wall';
function build(kind:BuildingKind | SiteModelKind,team:string):Construction{
  const m=new Construction();
  switch(kind){
    case 'citadel': {
      m.box(0,0,0,67,56,3,CUT);
      m.box(0,0,3,55,44,11,BASALT);
      m.box(0,-6,14,30,27,25,STONE);m.roof(0,-6,39,36,32,11,SLATE);
      for(const x of [-24,24])for(const y of [-19,19]){
        m.drum(x,y,3,9,30,STONE,8);m.drum(x,y,31,10,4,CUT,8);m.cap(x,y,35,12,12,SLATE);
        m.door(x,y+9,14,3,7);
      }
      m.box(0,22,3,25,7,22,STONE);m.door(0,26,3,11,18);
      for(const x of [-10,0,10])m.box(x,22,25,5,8,4,CUT);
      for(const x of [-9,9])m.door(x,8,24,3,8);
      m.banner(-19,-8,53,team);m.banner(18,-8,51,team);
      break;
    }
    case 'shop': {
      m.box(0,0,0,62,44,2,CUT);
      m.box(-5,-8,2,37,25,23,STONE); m.roof(-5,-8,25,44,32,14,SLATE);
      m.box(0,14,2,42,9,12,WOOD); m.box(0,14,14,46,12,2,'#a38e6a');
      for(const x of [-24,24]) m.box(x,22,0,1.8,1.8,27,WOOD);
      m.face([[-25,0,30],[25,0,30],[25,24,25],[-25,24,25]],'#bcad8c',[0,.25,1]);
      for(const x of [-18,-6,6,18]) m.face([[x-3,0,30.1],[x+3,0,30.1],[x+3,24,25.1],[x-3,24,25.1]],'#776355',[0,.25,1]);
      m.box(27,-7,0,2,2,34,WOOD); m.box(34,-7,31,16,1.5,1.5,WOOD);
      m.box(38,-7,20,11,2,9,'#a38c59');m.drum(38,-5.5,23,2,3,BRASS,8);
      for(const [x,color] of [[-14,'#8e7c55'],[-3,'#536965'],[9,'#a39777']] as const) m.drum(x,13,16,3.5,5,color,8,2);
      for(const x of [23,31]) m.box(x,-14,0,7,8,8,WOOD);
      break;
    }
    case 'camp': {
      m.box(0,0,0,58,44,1,'#80765e');
      // Canvas ridge tent, open dark entrance and guy ropes grounded at stakes.
      m.face([[-24,-17,2],[-24,17,2],[-24,0,34]],'#b4a78a',[-1,0,.5]);
      m.face([[-24,0,34],[22,0,34],[27,20,1],[-28,20,1]],'#9a8a6f',[0,.75,.65]);
      m.face([[-24,-17,2],[22,-17,2],[22,0,34],[-24,0,34]],'#c3b494',[0,-.75,.65]);
      m.face([[22,-17,2],[27,20,1],[22,0,34]],'#75694f',[1,0,.3]);
      m.face([[25,4,2],[25,14,2],[23,4,23]],'#353731',[1,0,0]);
      for(const x of [-28,28]) for(const y of [-25,25]) {m.box(x,y,0,1,1,4,WOOD);m.face([[x,y,3],[x+.6,y,3],[x*.8,y*.65,26]],'#8f8164',[0,1,0],0);}
      m.banner(-32,15,38,'#8b6e49'); m.box(30,-12,0,8,10,8,WOOD);
      m.box(-22,28,0,15,4,3,WOOD);m.box(-22,28,3,9,1,12,IRON);
      break;
    }
    case 'well': { m.drum(0,0,0,16,12,CUT,10); m.drum(0,0,12,13,1,'#3e4848',10); for(const x of [-17,17])m.box(x,0,0,2,2,34,WOOD);m.roof(0,0,32,43,30,10);break; }
    case 'statue': { m.box(0,0,0,28,24,5,CUT);m.box(0,0,5,20,17,9,STONE);m.box(0,0,14,24,21,3,CUT);for(const x of [-4,4])m.box(x,0,17,5,6,16,CUT);m.drum(0,0,31,9,17,STONE,5,12);m.drum(0,0,48,5,8,STONE,6);m.box(13,0,22,1,2,43,IRON);m.box(13,0,42,9,2,1,IRON);break; }
    case 'beacon': {m.drum(0,0,0,14,6,CUT,8);m.drum(0,0,6,9,35,STONE,8,7);m.drum(0,0,41,13,3,IRON,8);for(const x of [-7,7])m.box(x,0,44,1,1,12,IRON);m.cap(0,0,56,15,8,SLATE,8);m.drum(0,0,45,5,9,'#c39b60',8);break;}

    case 'fort-wall': {
      m.box(0,0,0,66,22,4,CUT);m.box(0,0,4,62,15,24,STONE);
      for(let x=-27;x<30;x+=12)m.box(x,0,28,8,18,7,CUT);m.banner(-20,0,39,team);break;
    }
    case 'fort-lance': case 'fort-flame': case 'fort-mortar': case 'fort-ward': {
      m.box(0,0,0,56,44,4,CUT);m.drum(0,0,4,23,23,STONE,6,21);
      m.drum(0,0,27,27,4,CUT,6);m.door(0,20,5,10,16);
      if(kind==='fort-lance'){
        m.box(0,0,31,7,8,14,WOOD);m.box(0,0,44,51,3,3,IRON);m.box(5,0,44,3,39,3,WOOD);m.box(0,15,43,1,27,1,'#d8cdb5');
      }else if(kind==='fort-mortar'){
        m.drum(0,0,31,12,6,IRON,8);m.drum(0,0,37,10,12,IRON,8,7);m.drum(0,0,49,6,1,'#242c31',8);
        for(const x of [-21,21])m.box(x,0,31,5,28,10,CUT);
      }else if(kind==='fort-flame'){
        m.drum(0,0,31,15,9,'#946d44',8);m.cap(0,0,40,10,17,'#d19d5c',6);
        for(const x of [-22,22])m.box(x,0,31,3,4,17,IRON);
      }else{
        for(const x of [-16,16])m.box(x,0,31,4,4,19,CUT);
        m.cap(0,0,50,24,12,SLATE,6);m.drum(0,0,32,10,3,'#7ca1a4',8);
      }
      m.banner(-28,10,40,team);break;
    }
    case 'townHall': {
      // Council courtyard: octagonal civic hall, low side wing and open porch.
      m.box(0,3,0,58,45,2.5,CUT);
      m.box(-21,-5,2,17,26,17,STONE);m.roof(-21,-5,19,22,31,11);
      m.drum(3,-5,2,21,25,STONE);m.drum(3,-5,25,22,2,WOOD);
      m.cap(3,-5,27,26,18);m.drum(3,-5,44,4,5,BRASS,6);m.cap(3,-5,49,6,7);
      m.door(3,15,3,10,16);
      for(const x of [-9,15])m.box(x,23,2,2,2,16,WOOD);
      m.roof(3,20,18,29,16,6);m.banner(-24,18,33,team);
      break;
    }
    case 'barracks': {
      // Fortified drill yard, broad gate and crenellated corner keeps.
      m.box(0,0,0,55,43,2,CUT);m.box(0,-12,2,49,16,19,STONE);
      m.roof(0,-12,21,54,21,9);
      for(const x of [-23,23]){
        m.box(x,13,2,11,14,24,CUT);m.box(x,13,26,14,17,2,STONE);
        for(const a of [-4,4])for(const d of [-5,5])m.box(x+a,13+d,28,3.5,4,4,STONE);
      }
      m.box(0,18,2,36,3,12,STONE);m.door(0,19.6,2,12,12);
      m.box(0,18,15,36,4,2,WOOD);m.banner(-15,20,29,team);
      break;
    }
    case 'archeryRange': {
      // Open canvas shooting canopy with three distinct round straw targets.
      m.box(0,0,0,54,42,1.5,'#968465');
      for(const x of [-24,24])for(const y of [-17,2])m.box(x,y,0,1.8,1.8,21,WOOD);
      m.roof(0,-8,22,56,25,8,'#a49776');
      for(const x of [-16,0,16]){
        m.box(x,14,0,1.3,2,13,WOOD);
        const ring=(r:number,z:number,color:string)=>m.face(Array.from({length:10},(_,i)=>[x+Math.cos(i*Math.PI/5)*r,15+z,13+Math.sin(i*Math.PI/5)*r] as V),color,[0,1,0],0);
        ring(6,0,'#c3af76');ring(3.8,.1,'#6d6853');ring(1.7,.2,team);
      }
      m.box(-25,4,0,4,10,9,WOOD);break;
    }
    case 'stables': {
      // Long low stable with open stalls, a hay loft and fenced turnout.
      m.box(0,-8,0,54,23,2,CUT);m.box(0,-17,2,51,3,18,STONE);
      for(const x of [-25,-9,9,25])m.box(x,2,2,2.3,3,18,WOOD);
      m.box(0,2,18,53,3,2.5,WOOD);m.roof(0,-8,21,60,29,10,'#737465');
      for(const x of [-16,0,16])m.box(x,-4,3,11,7,7,'#494b3d');
      m.fence(0,24,54);m.box(-26,13,0,1.5,20,6,WOOD);
      m.box(20,14,0,9,9,7,'#b6a273');m.banner(-24,4,31,team);break;
    }
    case 'farm': {
      // A compact windmill/granary, not a house with a lawn.
      m.drum(-12,-7,0,14,29,STONE,6,9);m.cap(-12,-7,29,14,12,'#8f7c58',6);
      m.door(-12,3,0,6,11);
      for(let i=0;i<4;i++){
        const a=Math.PI/4+i*Math.PI/2,ux=Math.cos(a),uz=Math.sin(a),cx=-12,cz=26;
        m.face([[cx+ux*3,6,cz+uz*3],[cx+ux*21,6,cz+uz*21],[cx+ux*21-uz*4,6,cz+uz*21+ux*4],[cx+ux*5-uz*2,6,cz+uz*5+ux*2]],'#b4a180',[0,1,0]);
      }
      m.box(14,12,0,25,28,1,'#817354');
      for(let row=0;row<4;row++)m.box(14,2+row*6,1,24,2,3,'#baaa79');
      m.fence(15,28,27);break;
    }
    case 'workshop': {
      // Saw workshop: exposed frame, lean-to and a large working wheel.
      m.box(-8,-5,0,33,32,3,CUT);m.box(-8,-9,3,30,20,17,STONE);
      m.roof(-8,-9,21,36,28,12);
      for(const x of [-23,8])m.box(x,15,0,2,2,14,WOOD);
      m.roof(-8,10,14,36,19,4,'#8d8064');m.box(-7,12,2,21,8,6,WOOD);
      const x=21,y=3,z=14;
      for(let i=0;i<12;i++){
        const a=i*Math.PI/6,q=(i+1)*Math.PI/6;
        m.face([[x,y+Math.cos(a)*14,z+Math.sin(a)*14],[x,y+Math.cos(q)*14,z+Math.sin(q)*14],[x,y+Math.cos(q)*10,z+Math.sin(q)*10],[x,y+Math.cos(a)*10,z+Math.sin(a)*10]],WOOD,[1,0,0]);
        if(i%2===0)m.face([[x,y,z],[x,y+Math.cos(a)*13,z+Math.sin(a)*13],[x,y+Math.cos(a+.12)*13,z+Math.sin(a+.12)*13]],BRASS,[1,0,0]);
      }
      m.box(12,0,0,6,8,15,CUT);break;
    }
    case 'defenseTower': {
      m.drum(0,0,0,14,21,CUT,6,11);
      for(const x of [-9,9])for(const y of [-9,9])m.box(x,y,20,2,2,23,WOOD);
      m.box(0,0,29,29,29,3,WOOD);
      for(const x of [-13,13])m.box(x,0,32,1.5,28,5,WOOD);
      m.box(0,13,32,27,1.5,5,WOOD);m.cap(0,0,43,22,12,SLATE,4);
      m.banner(-12,13,34,team);break;
    }
    case 'sanctum': {
      // Stepped observatory with a copper dome and three stone fins.
      m.drum(0,0,0,28,3,CUT);m.drum(0,0,3,21,24,STONE);
      m.drum(0,0,27,24,3,BRASS);m.drum(0,0,30,21,10,SLATE,10,13);m.cap(0,0,40,13,8);
      for(const [x,y] of [[-21,-8],[15,-17],[14,18]]){m.drum(x!,y!,0,5,33,CUT,4,3);m.cap(x!,y!,33,4,7,BRASS,4);}
      m.door(-4,20,3,8,17);m.drum(0,0,48,2,5,BRASS,6);break;
    }
    case 'moonWell': {
      // Sunken water court with a crescent-shaped stone screen.
      m.drum(0,0,0,29,3,CUT,12);m.drum(0,0,3,24,4,STONE,12);
      m.drum(0,0,7,20,.2,'#709c97',12);
      for(let i=0;i<5;i++){
        const a=Math.PI+i*Math.PI/5,x=Math.cos(a)*24,y=Math.sin(a)*24;
        m.drum(x,y,0,3.5,22+Math.sin(i*Math.PI/4)*12,CUT,4,2.5);
        m.cap(x,y,22+Math.sin(i*Math.PI/4)*12,4,5,SLATE,4);
      }
      m.box(0,25,0,14,10,2,CUT);break;
    }
    case 'shipyard': {
      for(let i=0;i<12;i++)m.box(-28+i*5,0,0,4.7,52,2.5,WOOD);
      // Exposed boat ribs on the slipway and an asymmetrical lifting crane.
      for(let i=0;i<6;i++){
        const y=-17+i*7,w=7+Math.sin(i*Math.PI/5)*8;
        m.face([[-w,y,11],[-w*.6,y,4],[w*.6,y,4],[w,y,11],[w-2,y,11],[w*.45,y,6],[-w*.45,y,6],[-w+2,y,11]],'#a18c67',[0,1,0]);
      }
      m.box(-23,-13,0,3,3,40,WOOD);m.box(-7,-13,37,35,2.5,3,WOOD);
      m.box(9,-13,14,.7,.7,24,IRON);m.box(9,-13,12,4,2,3,IRON);
      m.roof(21,-13,15,17,24,8,'#a99e7f');break;
    }
    case 'emberForge': {
      m.drum(0,0,0,29,4,BASALT,8);m.drum(0,0,4,23,20,BASALT,8,18);m.cap(0,0,24,22,10,COPPER,8);
      for(const [x,y,h] of [[-14,-9,45],[2,-13,53],[17,-6,39]]){
        m.drum(x!,y!,10,4,h!-10,BASALT,6,3);m.drum(x!,y!,h!,5,2,IRON,6);
      }
      m.door(0,21,4,12,12);m.face([[-4,21.1,5],[4,21.1,5],[3,21.1,12],[-3,21.1,12]],'#cf9054',[0,1,0],0);
      for(const x of [-18,18])m.box(x,18,0,5,7,18,IRON);break;
    }
    case 'cinderSpire': {
      m.drum(0,0,0,23,5,BASALT,6);m.drum(0,0,5,15,34,BASALT,6,8);
      m.drum(0,0,39,16,4,IRON,6);
      for(let i=0;i<3;i++){const a=i*Math.PI*2/3;m.drum(Math.cos(a)*11,Math.sin(a)*11,36,3,22,COPPER,4,1);}
      m.drum(0,0,43,4,8,'#bc8754',6,7);m.cap(0,0,51,7,10,'#d2aa72',6);break;
    }
    case 'ashenHall': {
      m.box(0,0,0,57,43,4,BASALT);m.box(0,-6,4,40,27,24,BASALT);
      m.roof(0,-6,28,46,32,13,COPPER);
      for(const x of [-23,23]){m.drum(x,9,0,10,34,BASALT,4,7);m.cap(x,9,34,10,10,IRON,4);}
      m.box(0,18,3,34,5,21,BASALT);m.door(0,21,3,13,18);
      m.box(0,18,25,36,9,3,COPPER);m.banner(-18,22,37,team);break;
    }
    case 'emberShrine': {
      m.drum(0,0,0,28,3,BASALT,6);m.drum(0,0,3,19,7,COPPER,6,23);
      m.drum(0,0,10,19,1,'#513f32',8);m.cap(0,0,11,8,17,'#cc9154',5);
      for(const [x,y,h] of [[-22,-7,31],[11,-21,39],[18,18,23]]){m.drum(x!,y!,0,5,h!,BASALT,4,3);m.cap(x!,y!,h!,4,7,COPPER,4);}
      break;
    }
  }
  return m;
}
export function buildingGeometry(kind:BuildingKind | SiteModelKind,team="#ff00ff"){return build(kind,team).faces;}

export function paintBuildingModel(b:Brush,kind:BuildingKind | SiteModelKind,team:string){
  const m=build(kind,team);
  m.faces=m.faces.filter(f=>f.normal[0]*.57+f.normal[1]*.82+f.normal[2]*.8>-.01);
  b.save();b.lineJoin='round';
  // Ground contact comes from the footprint, independent of the cast shadow.
  // An irregular soil edge and a tight dark rim anchor masonry into the terrain.
  const feet=m.faces.flatMap(f=>f.p.filter(p=>p[2]<=3).map(([x,y])=>project([x,y,0])));
  const hull=groundHull(feet);
  if(hull.length>2){
    polygon(b,hull.map(([x,y],i)=>[x*1.14+(noise(i)-.5)*2,19+(y-19)*1.2]),'#a59c7424','transparent',0);
    polygon(b,hull.map(([x,y])=>[x*1.035,19+(y-19)*1.045]),'#59624b30','transparent',0);
  }
  // Union silhouettes into a single fill: overlapping faces do not darken shadows.
  b.beginPath();
  for(const f of m.faces){
    const p=f.p.map(([x,y,z])=>project([x+z*.45,y+z*.3,0]));
    p.forEach(([x,y],i)=>i?b.lineTo(x,y):b.moveTo(x,y));b.closePath();
  }
  b.fillStyle='#56686b20';b.fill();
  m.faces.sort((a,z)=>{
    const gap=depth(a)-depth(z);
    return Math.abs(gap)>.001?gap:height(a)-height(z);
  });
  for(const f of m.faces){
    const p=f.p.map(project);
    // Soft daylight: the front faces receive sun and the sides retain cool
    // ambient fill. Geometry and texture density are unchanged.
    const light=.66+Math.max(0,-f.normal[0]*.35+f.normal[1]*.45+f.normal[2]*.82)*.39;
    const fill=tint(f.color,light);
    polygon(b,p,fill,darker(f.color,.18),.38);
    // Narrow highlights on dressed edges; broad stone/wood faces remain matte.
    if (light > 1 && (f.color === IRON || f.color === SLATE || f.color === CUT)) {
      let edge = 0;
      for (let i=1;i<p.length;i++) if (p[i]![1]+p[(i+1)%p.length]![1] < p[edge]![1]+p[(edge+1)%p.length]![1]) edge=i;
      line(b,[p[edge]!,p[(edge+1)%p.length]!],f.color===IRON?'#eee3c4b0':'#e5d7b369',.7);
    }
    if(f.normal[2]===0){
      const foot=f.p.filter(p=>p[2]===0);
      if(foot.length===2)line(b,foot.map(project),'#69705b99',.75);
    }
    if(f.grain){
      b.save();b.clip();
      const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);
      const minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY;
      // Stable dry-brush flecks locked to each projected face, baked only once.
      for(let i=0;i<Math.min(50,w*h/13);i++){
        const x=minX+noise(i+f.p[0]![0]*13)*w,y=minY+noise(i*3.7+f.p[0]![1]*17)*h;
        line(b,[[x,y],[x+1+noise(i+7)*2,y-.35]],i%3?'#fff4d91a':'#5862530b',.55);
      }b.restore();
    }
  }
  b.restore();
}
function depth(f:Face){return f.p.reduce((sum,[x,y])=>sum+x*.6+y*.8,0)/f.p.length;}
function height(f:Face){return f.p.reduce((sum,p)=>sum+p[2],0)/f.p.length;}
function noise(x:number){const v=Math.sin(x*12.9898+78.233)*43758.5453;return v-Math.floor(v);}

/** Convex footprint of low construction vertices; no per-frame work. */
function groundHull(points:[number,number][]):[number,number][]{
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a:number[],b:number[],c:number[])=>(b[0]!-a[0]!)*(c[1]!-a[1]!)-(b[1]!-a[1]!)*(c[0]!-a[0]!);
  const half=(ps:[number,number][])=>{const h:[number,number][]=[];for(const p of ps){while(h.length>=2&&cross(h[h.length-2]!,h[h.length-1]!,p)<=0)h.pop();h.push(p);}return h.slice(0,-1);};
  return [...half(sorted),...half([...sorted].reverse())];
}
