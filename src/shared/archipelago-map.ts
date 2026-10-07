import { createBuilding, createUnit } from "./map";
import { fractalNoise, coordinateRandom } from "./environment/noise";
import { campRoster, campMembers } from "./camps";
import { detCos, detSin } from "./det-math";
import {ecologicalDressing,prepareEcology} from './map-dressing';
import type { GeneratedMap } from "./generated-map";
import type { GeneratedLayoutOptions, PlayerId } from "./types";
/** A terrain generator only. Naval policy reads connectivity and resources, never this layout's identity. */
export function archipelagoMap(options: GeneratedLayoutOptions, players: PlayerId[]): GeneratedMap {
    const size = options.size ?? 6144;
    const cell = 32, cols = Math.ceil(size / cell);
    let seed = 2166136261;
    for (const c of options.seed)
        seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
    const rotation = (seed % 1000) / 1000 * Math.PI * 2;
    const center = { x: size / 2, y: size / 2 };
    const point = (angle: number, reach: number) => ({ x: center.x + detCos(angle) * reach, y: center.y + detSin(angle) * reach });
    const homes = players.map((owner, index) => ({ owner, at: point(rotation + index * Math.PI * 2 / players.length, size * .345), radius: size * .095 }));
    const large=players.length>=6;
    const mainland = { at: center, radius: size * (large ? .12 : .155) };
    const satellites=large?players.map((_,i)=>({at:point(rotation+(i+.5)*Math.PI*2/players.length,size*.225),radius:size*.047})):[];
    const land = [mainland, ...homes,...satellites];
    let cells = "";
    for (let row = 0; row < cols; row++)
        for (let col = 0; col < cols; col++) {
            const at = { x: col * cell + cell / 2, y: row * cell + cell / 2 };
            const gap = Math.min(...land.map(disk => Math.hypot(at.x - disk.at.x, at.y - disk.at.y) - disk.radius
                - (fractalNoise(seed, at.x, at.y, 520, 90) - .5) * disk.radius * .3));
            const home=homes.find(home=>Math.hypot(at.x-home.at.x,at.y-home.at.y)<home.radius-120);
            const outward=home && Math.hypot(at.x-center.x,at.y-center.y)>Math.hypot(home.at.x-center.x,home.at.y-center.y);
            const patch=fractalNoise(seed,at.x,at.y,700,50);
            cells += gap <= -64 ? large && home && Math.hypot(at.x-home.at.x,at.y-home.at.y)>350 && outward && patch>.65 ? 'T'
                : large && gap<-150 && (!home || Math.hypot(at.x-home.at.x,at.y-home.at.y)>350) && patch<.27 ? '#' : '.' : gap <= 48 ? "," : "~";
        }
    const result: GeneratedMap = { kind: "ring", idea: "islandStarts", size, starts: {}, buildings: [], units: [], resources: [], mercenaryCamps: [], items: [], landmarks: [], terrain: { cell, cols, rows: cols, cells, palette: "coastal" }, camps: [], sites: [], obstacles: [] };
    for (const { owner, at } of homes) {
        const mine = { x: at.x + 165, y: at.y };
        result.starts[owner] = { baseX: at.x, baseY: at.y, mineX: mine.x, mineY: mine.y };
        result.buildings.push(createBuilding(`building-${owner}-townhall`, owner, "townHall", at.x, at.y, true));
        for (let i = 0; i < 3; i++)
            result.units.push(createUnit(`unit-${owner}-worker-${i + 1}`, owner, "worker", at.x - 55 + i * 50, at.y + 90));
        result.resources.push({ id: `gold-${owner}-main`, kind: "goldMine", ...mine, amount: 6000 });
    }
    // Shoreward resources permit several independent bridgeheads; the mainland has no scripted owner or capture event.
    const used = new Set<string>();
    const mainlandTier = large ? "red" : "orange";
    const mainlandRoster = campRoster(() => coordinateRandom(seed, 0, 0, 20), mainlandTier, "open", used).kinds;
    const satelliteRoster = campRoster(() => coordinateRandom(seed, 0, 0, 21), "orange", "water", used).kinds;
    for (let index = 0; index < players.length * (large?1:2); index++) {
        const at = point(rotation + index * Math.PI * (large?2:1) / players.length, size * (large?.072:.095));
        result.resources.push({ id: `gold-mainland-${index}`, kind: "goldMine", ...at, amount: 9000 });
        const center = { x: at.x, y: at.y + 120 };
        result.units.push(...campMembers(mainlandRoster, center).map((member, i) => createUnit(`guard-${index}-${i}`, "neutral", member.kind, member.x, member.y)));
        result.camps.push({ ...center, tier: mainlandTier, habitat: "open" });
    }
    result.sites.push({ kind: "shop", ...center });
    satellites.forEach((island,index)=>{
        result.resources.push({id:`gold-satellite-${index}`,kind:'goldMine',...island.at,amount:7500});
        const center = { x: island.at.x + 85, y: island.at.y + 110 };
        result.units.push(...campMembers(satelliteRoster, center).map((member, i) => createUnit(`satellite-guard-${index}-${i}`, 'neutral', member.kind, member.x, member.y)));
        result.camps.push({...center,tier:'orange',habitat:'water'});
        result.landmarks.push({id:`satellite-wreck-${index}`,kind:'wreck',x:island.at.x+island.radius*.6,y:island.at.y,size:100,rotation});
    });
    // Camps, shops and mineral seams must remain usable through the wooded interior.
    if(large){
        const open=[...result.resources,...result.units.filter(unit=>unit.owner==='neutral'),...result.sites];
        result.terrain.cells=[...result.terrain.cells].map((tile,index)=>{
            if(tile!=='T'&&tile!=='#')return tile;
            const at={x:(index%cols+.5)*cell,y:(Math.floor(index/cols)+.5)*cell};
            return open.some(point=>Math.hypot(at.x-point.x,at.y-point.y)<240)?'.':tile;
        }).join('');
    }
    prepareEcology(result.terrain,options.seed);
    result.landmarks.push(...ecologicalDressing(result.terrain,[...homes.map(home=>home.at),...result.resources],options.seed));
    for(const mine of result.resources)result.landmarks.push({id:`scar-${mine.id}`,kind:'mineScar',x:mine.x,y:mine.y,size:160,rotation:0});
    return result;
}
