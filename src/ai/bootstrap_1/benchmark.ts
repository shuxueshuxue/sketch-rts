import { MAP_POOL } from '../../shared/map-pool';
import { createGame, snapshotGame, type Game } from '../../shared/sim';
import { isBuildPlacementClear } from '../../shared/build-placement';
import { sameGround, snapToFootprint, walkableGoal } from '../../shared/terrain';
import type { BootstrapAiVersion, MapId, RaceId } from '../../shared/types';
import type { AiGameAgent } from '../game-runner';
import type { BenchmarkMatchInput } from '../../sdk/benchmark/core';
import { BOOTSTRAP_VERSIONS } from './policy';

export const BOOTSTRAP_OPPONENTS = [ ['v5'], ['v7'], ['v8'], ['v5','v7'], ['v5','v8'], ['v7','v8'], ['v5','v5'], ['v7','v7'], ['v8','v8'] ] as const;
export type BootstrapMatch = BenchmarkMatchInput<AiGameAgent> & { subject: BootstrapAiVersion; side: 0 | 1; seed: string; unseen: boolean };

export function bootstrapMatches(seed: string, maps: readonly MapId[] = MAP_POOL.map(map => map.id), maxTicks = 48000, unseen = false): BootstrapMatch[] {
  return maps.flatMap(mapId => BOOTSTRAP_VERSIONS.flatMap(subject => BOOTSTRAP_OPPONENTS.flatMap(opponents => (['grove','ember'] as const).flatMap(race => ([0,1] as const).map(side => {
    const agents: Record<string, AiGameAgent> = {p0:{version:subject, race, controller:'external-agent', team:'a'}};
    opponents.forEach((version, index) => {agents[`p${index+1}`]={version,race:index % 2 === 0 ? (race === 'grove' ? 'ember' : 'grove') : race,controller:'external-agent',team:'b'};});
    return {name:`${mapId}/${subject}/${opponents.join('+')}/${race}/${side}`,mapId,subject,side,seed,unseen,agents,maxTicks,thinkInterval:15};
  })))));
}

// Keep the original named map's full seat count, terrain, camps and resources.
// Unused seats lose their owned entities; alliances never redraw the map.
export function bootstrapGame(match: BootstrapMatch): Game {
  const pool = MAP_POOL.find(map => map.id === match.mapId)!;
  const seats = Array.from({length:pool.players}, (_, index) => `seat${index}`);
  const physicalTeams=Object.fromEntries(seats.map((seat,index)=>[seat,pool.layout.kind==='sides' ? `shore-${index%2}` : seat]));
  const original = createGame(pool.id, {players:seats,aiPlayers:[],...(match.unseen ? {layout:{...pool.layout,seed:`${match.seed}:${pool.id}`},teams:physicalTeams} : {})});
  if (match.unseen) original.map.id='ladder';
  const owners = Object.keys(match.agents);
  const teams = Object.fromEntries(owners.map(owner => [owner, match.agents[owner]!.team]));
  const races = Object.fromEntries(owners.map(owner => [owner, match.agents[owner]!.race!])) as Record<string, RaceId>;
  const initial = createGame('bareDuel', {players:owners,teams,races,aiPlayers:[]});
  const game: Game = {...original,players:initial.players,match:initial.match,teams,activePlayers:owners,
    units:original.units.filter(unit=>unit.owner==='neutral'),buildings:[]};
  const subjectSeat = pool.layout.kind === 'sides' ? match.side : match.side * Math.floor(pool.players / 2);
  const firstRivalSeat = pool.layout.kind === 'sides' ? 1-match.side : (subjectSeat + Math.floor(pool.players/2)) % pool.players;
  const indices = [subjectSeat,firstRivalSeat,pool.layout.kind === 'sides' ? firstRivalSeat+2 : (firstRivalSeat+1)%pool.players];
  for (const [index, owner] of owners.entries()) {
    if (index === 2 && pool.players === 2) continue;
    const seat = seats[indices[index]!]!;
    for (const unit of original.units.filter(unit => unit.owner === seat)) game.units.push({...structuredClone(unit),owner,id:unit.id.replaceAll(seat,owner)});
    for (const building of original.buildings.filter(building => building.owner === seat)) game.buildings.push({...structuredClone(building),owner,id:building.id.replaceAll(seat,owner)});
  }
  if (owners.length === 3 && pool.players === 2) addTeammateStart(game);
  return game;
}

function addTeammateStart(game: Game) {
  const hall = game.buildings.find(building => building.owner === 'p1')!;
  const mine = game.resources.find(resource=>Math.hypot(resource.x-hall.x,resource.y-hall.y)<300)!;
  const mainDistance = Math.hypot(mine.x-hall.x,mine.y-hall.y);
  const cell = game.map.terrain!.cell;
  const candidates = Array.from({length:41*41},(_,index)=>snapToFootprint(game.map,hall.radius,{x:hall.x+(index%41-20)*cell,y:hall.y+(Math.floor(index/41)-20)*cell}))
    .sort((a,b)=>Math.hypot(a.x-hall.x,a.y-hall.y)-Math.hypot(b.x-hall.x,b.y-hall.y));
  const point = candidates.find(point => isBuildPlacementClear(game,'townHall',point) && sameGround(game.map,hall,point)
    && game.buildings.every(building=>Math.hypot(point.x-building.x,point.y-building.y)>180)
    && Math.hypot(point.x-mine.x,point.y-mine.y)>mainDistance+50
    && (()=>{
      const at=walkableGoal(game.map,point.x+mine.x-hall.x,point.y+mine.y-hall.y);
      return Math.hypot(at.x-hall.x,at.y-hall.y)>mainDistance+50
        && Math.hypot(at.x-point.x,at.y-point.y)>=mainDistance-10
        && game.resources.every(resource=>Math.hypot(resource.x-at.x,resource.y-at.y)>100);
    })())!;
  const mineAt = walkableGoal(game.map,point.x+(mine.x-hall.x),point.y+(mine.y-hall.y));
  game.buildings.push({...structuredClone(hall),id:'building-p2-townhall',owner:'p2',x:point.x,y:point.y});
  game.resources.push({...mine,id:'gold-p2-main',x:mineAt.x,y:mineAt.y});
  for (const worker of game.units.filter(unit=>unit.owner==='p1')) {
    const at = walkableGoal(game.map,point.x+worker.x-hall.x,point.y+worker.y-hall.y);
    game.units.push({...structuredClone(worker),id:worker.id.replaceAll('p1','p2'),owner:'p2',x:at.x,y:at.y});
  }
}

export function initialBootstrapSnapshot(match: BootstrapMatch) { return snapshotGame(bootstrapGame(match)); }
