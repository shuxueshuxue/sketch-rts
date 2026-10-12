import { convexHull, type Point } from './navigation-math';

export const SEA_STEPS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]] as const;
export type SeaPotential = {
  left:number;top:number;cols:number;rows:number;cell:number;
  seedX:number;seedY:number;planes:Point[];values:Float64Array;
};
type Frontier = {
  length:number;poppedCost:number;
  reset():unknown;push(id:number,cost:number,score:number):void;pop():number;
};

/** Dual facets of the open-water wind metric. Each facet satisfies
 * n·step <= the actual directed edge cost. Their maximum is therefore a
 * consistent lower bound, including movement across a local field's border.
 */
export function seaCostPlanes(directionCosts:readonly number[]):Point[] {
  const weights=SEA_STEPS.map(([x,y],h)=>(x && y ? Math.SQRT2 : 1)*directionCosts[h]!);
  const polygon=convexHull(SEA_STEPS.map(([x,y],h)=>({x:x/weights[h]!,y:y/weights[h]!})));
  return polygon.map((a,i)=>{
    const b=polygon[(i+1)%polygon.length]!,det=a.x*b.y-a.y*b.x;
    const x=(b.y-a.y)/det,y=(a.x-b.x)/det;
    let ratio=1;
    for(let h=0;h<SEA_STEPS.length;h++){
      const [dx,dy]=SEA_STEPS[h]!;ratio=Math.max(ratio,(x*dx+y*dy)/weights[h]!);
    }
    // Preserve the inequality despite floating projection error. This tiny
    // inward rounding cannot authorize a terrain or traffic passage.
    const scale=ratio*(1+1e-12);
    return{x:x/scale,y:y/scale};
  });
}
export function freeSeaDistance(planes:readonly Point[],x:number,y:number):number {
  let value=0;for(const plane of planes)value=Math.max(value,plane.x*x+plane.y*y);return value;
}
export function seaPotentialAt(field:SeaPotential,x:number,y:number):number {
  if(x>=field.left && y>=field.top && x<field.left+field.cols && y<field.top+field.rows){
    const value=field.values[(y-field.top)*field.cols+x-field.left]!;
    if(Number.isFinite(value))return value;
  }
  return freeSeaDistance(field.planes,(field.seedX-x)*field.cell,(field.seedY-y)*field.cell);
}

/** Inside the fixed local box, reverse Dijkstra ends either at the landmark
 * or at a border's optimistic open-water continuation. Outside, use that same
 * continuation directly. Every inside route costs at least the free metric,
 * so border seeds retain exactly that value: both directions across every
 * border edge are consistent. Allowing the optimistic continuation can only
 * shorten the full terrain-only path. Actual hull edges are checked elsewhere.
 */
export function buildSeaPotential(water:Uint8Array,mapCols:number,mapRows:number,cell:number,
  bounds:{left:number;top:number;right:number;bottom:number},seed:Point,
  directionCosts:readonly number[],frontier:Frontier):SeaPotential {
  const cols=bounds.right-bounds.left,rows=bounds.bottom-bounds.top;
  const planes=seaCostPlanes(directionCosts),values=new Float64Array(cols*rows);values.fill(Infinity);
  const field={left:bounds.left,top:bounds.top,cols,rows,cell,seedX:seed.x,seedY:seed.y,planes,values};
  const weights=SEA_STEPS.map(([x,y],h)=>cell*(x && y ? Math.SQRT2 : 1)*directionCosts[h]!);
  const open=(x:number,y:number)=>x>=0 && y>=0 && x<mapCols && y<mapRows && water[y*mapCols+x]===1;
  frontier.reset();
  const add=(x:number,y:number,cost:number)=>{
    if(!open(x,y))return;
    const id=(y-bounds.top)*cols+x-bounds.left;
    if(cost>=values[id]!)return;
    values[id]=cost;frontier.push(id,cost,cost);
  };
  add(seed.x,seed.y,0);
  const border=(x:number,y:number)=>{
    add(x,y,freeSeaDistance(planes,(seed.x-x)*cell,(seed.y-y)*cell));
  };
  for(let x=bounds.left;x<bounds.right;x++){
    border(x,bounds.top);
    if(rows>1)border(x,bounds.bottom-1);
  }
  for(let y=bounds.top+1;y<bounds.bottom-1;y++){
    border(bounds.left,y);
    if(cols>1)border(bounds.right-1,y);
  }
  while(frontier.length){
    const id=frontier.pop(),cost=frontier.poppedCost;
    if(cost!==values[id])continue;
    const x=id%cols+bounds.left,y=Math.floor(id/cols)+bounds.top;
    for(let h=0;h<SEA_STEPS.length;h++){
      const [dx,dy]=SEA_STEPS[h]!,nx=x+dx,ny=y+dy;
      if(nx<bounds.left || ny<bounds.top || nx>=bounds.right || ny>=bounds.bottom || !open(nx,ny))continue;
      const to=(ny-bounds.top)*cols+nx-bounds.left,distance=cost+weights[(h+4)%SEA_STEPS.length]!;
      if(distance>=values[to]!)continue;
      values[to]=distance;frontier.push(to,distance,distance);
    }
  }
  return field;
}
