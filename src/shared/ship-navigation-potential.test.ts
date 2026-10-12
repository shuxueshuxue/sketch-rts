import { describe,expect,it } from 'vitest';
import { buildSeaPotential,freeSeaDistance,seaCostPlanes,seaPotentialAt,SEA_STEPS } from './ship-navigation-potential';

class TestFrontier {
  entries:{id:number;cost:number;score:number}[]=[];poppedCost=0;
  get length(){return this.entries.length;}
  reset(){this.entries=[];}
  push(id:number,cost:number,score:number){this.entries.push({id,cost,score});}
  pop(){
    this.entries.sort((a,b)=>a.score-b.score || a.id-b.id);
    const first=this.entries.shift()!;this.poppedCost=first.cost;return first.id;
  }
}
function reference(water:Uint8Array,cols:number,rows:number,cell:number,seeds:number[],costs:number[]) {
  // Independent full-map shortest paths: a linear minimum scan rather than
  // the production frontier or its optimistic border seeds.
  const values=Array<number>(water.length).fill(Infinity),seen=new Set<number>();for(const seed of seeds)values[seed]=0;
  for(let visit=0;visit<water.length;visit++){
    let id=-1;
    for(let next=0;next<water.length;next++)if(!seen.has(next) && (id<0 || values[next]!<values[id]!))id=next;
    if(id<0 || !Number.isFinite(values[id]))break;seen.add(id);
    const x=id%cols,y=Math.floor(id/cols);
    for(let h=0;h<8;h++){
      const [dx,dy]=SEA_STEPS[h]!,nx=x+dx,ny=y+dy;
      if(nx<0 || ny<0 || nx>=cols || ny>=rows || !water[ny*cols+nx])continue;
      const to=ny*cols+nx,edge=cell*(dx && dy ? Math.SQRT2 : 1)*costs[(h+4)%8]!;
      values[to]=Math.min(values[to]!,values[id]!+edge);
    }
  }
  return values;
}

describe('local directed sea potential',()=>{
  it.each([
    [1,1,1,1,1,1,1,1],
    [1,1.4,5,2,1.05,1.6,1.1,4],
    [5,2,1,1.2,3,1.05,1.8,4],
  ])('is admissible against full-map shortest paths and consistent across both sides of every border',(...costs:number[])=>{
    const cols=20,rows=18,cell=32,water=Uint8Array.from({length:cols*rows},(_,i)=>
      i%cols>=7 && i%cols<=10 && Math.floor(i/cols)>=4 && Math.floor(i/cols)<=13 ? 0 : 1);
    const seed={x:14,y:9},bounds={left:3,top:3,right:18,bottom:15};
    const field=buildSeaPotential(water,cols,rows,cell,bounds,seed,costs,new TestFrontier());
    const full=reference(water,cols,rows,cell,[seed.y*cols+seed.x],costs);
    expect(seaPotentialAt(field,seed.x,seed.y)).toBe(0);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      if(!water[y*cols+x])continue;
      const potential=seaPotentialAt(field,x,y);
      expect(potential).toBeLessThanOrEqual(full[y*cols+x]!+1e-7);
      const free=freeSeaDistance(field.planes,(seed.x-x)*cell,(seed.y-y)*cell);
      expect(potential+1e-7).toBeGreaterThanOrEqual(free);
      for(let h=0;h<8;h++){
        const [dx,dy]=SEA_STEPS[h]!,nx=x+dx,ny=y+dy;
        if(nx<0 || ny<0 || nx>=cols || ny>=rows || !water[ny*cols+nx])continue;
        const edge=cell*(dx && dy ? Math.SQRT2 : 1)*costs[h]!;
        expect(potential).toBeLessThanOrEqual(edge+seaPotentialAt(field,nx,ny)+1e-7);
      }
    }
  });

  it('keeps every free-water dual facet below every asymmetric directed edge cost',()=>{
    const costs=[5,2,1,1.2,3,1.05,1.8,4],planes=seaCostPlanes(costs);
    for(const plane of planes)for(let h=0;h<8;h++){
      const [dx,dy]=SEA_STEPS[h]!;
      expect(plane.x*dx+plane.y*dy).toBeLessThanOrEqual((dx && dy ? Math.SQRT2 : 1)*costs[h]!);
    }
    expect(freeSeaDistance(planes,128,0)).not.toBe(freeSeaDistance(planes,-128,0));
  });
});
