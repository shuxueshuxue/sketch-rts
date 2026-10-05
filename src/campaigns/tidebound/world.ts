import type { GameMap } from '../../shared/types';

export const WORLD = { width: 24576, height: 18432, cell: 64 };
export const HOME = { x: 4300, y: 9200 };
export const BEACON = { x: 5420, y: 9020 };
export const EMBARK = { x: 6040, y: 8740 };
export const LANDING = { x: 10300, y: 5360 };
export const CITADEL = { x: 17000, y: 9200 };
export const SEAL = { x: 15700, y: 8630 };
export const MAGE = { x: 11900, y: 14800 };
export const LANES = [4200, 9200, 14200] as const;
export const ISLANDS = [
  { x: 4300, y: 9200, rx: 2350, ry: 3000 },
  ...LANES.map(y => ({ x: 12800, y, rx: 5350, ry: 1800 })),
  { x: 20900, y: 9200, rx: 2200, ry: 2900 },
  { x: 5700, y: 2500, rx: 1400, ry: 1100 },
  { x: 5700, y: 15700, rx: 1450, ry: 1150 },
  { x: 20000, y: 15800, rx: 1400, ry: 1100 },
] as const;

/** Shared by the mission and its menu preview; no decorative substitute map. */
export function tideboundMap(): GameMap {
  const { width, height, cell } = WORLD;
  const cols = width / cell, rows = height / cell;
  const cells: string[] = [];
  const levels: string[] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = (x + .5) * cell, py = (y + .5) * cell;
    const d = Math.min(...ISLANDS.map((i, index) => {
      const dx=(px-i.x)/i.rx,dy=(py-i.y)/i.ry,angle=Math.atan2(dy,dx);
      const coast=1+.055*Math.sin(angle*5+index*1.7)+.035*Math.sin(angle*9-index*.8);
      return (dx*dx+dy*dy)/(coast*coast);
    }));
    // Shallows belong to both navigation layers; the blue channels separate the islands.
    let kind=d < .9 ? '.' : d < 1.08 ? ',' : '~';
    if(kind==='.'&&LANES.some(lane=>((px-11800)/310)**2+((py-lane+1180)/220)**2<1||((px-13800)/360)**2+((py-lane-1200)/230)**2<1))kind='T';
    if(kind==='.'&&LANES.some(lane=>((px-12500)/250)**2+((py-lane-800)/150)**2<1))kind='#';
    cells.push(kind);
    levels.push(kind==='.'&&Math.abs(py-9200)<950&&px>16100&&px<17900?(px<16400?'2':'1'):'0');
  }
  const map: GameMap = { id: 'bareDuel', name: '潮汐王座 · 诸港群岛', width, height, landmarks: [], terrain: { cell, cols, rows, cells: cells.join(''),levels:levels.join(''),palette:'coastal' } };
  for (let i = 0; i < 600; i++) {
    const island = ISLANDS[i % ISLANDS.length]!;
    const angle = i * 2.39996, radius = .25 + (i % 11) * .045;
    map.landmarks.push({ id: `tide-landmark-${i}`, kind: i % 5 === 0 ? 'reeds' : 'pebbles', x: island.x + Math.cos(angle) * island.rx * radius, y: island.y + Math.sin(angle) * island.ry * radius, size: 14 + i % 23, rotation: angle });
  }
  for(let i=0;i<35;i++){
    const angle=i*2.39996;
    map.landmarks.push({id:`home-bush-${i}`,kind:i%5===0?'flowers':'bush',x:HOME.x+Math.cos(angle)*(950+i%4*200),y:HOME.y+Math.sin(angle)*(900+i%3*230),size:18+i%4*8,rotation:angle});
  }
  for(let i=0;i<12;i++)map.landmarks.push({id:`home-road-${i}`,kind:'road',x:HOME.x+(BEACON.x-HOME.x)*i/11,y:HOME.y+(BEACON.y-HOME.y)*i/11,size:104,straight:true,rotation:Math.atan2(BEACON.y-HOME.y,BEACON.x-HOME.x)});
  map.landmarks.push({id:'harbor-sign',kind:'signpost',x:HOME.x+820,y:HOME.y-100,size:24,rotation:0},{id:'beacon-campfire',kind:'campfire',x:BEACON.x-250,y:BEACON.y+250,size:22,rotation:0});
  return map;
}
