import { MAP_POOL } from '../../shared/map-pool';
import { createRoom, roomToGameSetup } from '../../shared/rooms';
import { createGame } from '../../shared/sim';
import { sameGround } from '../../shared/terrain';
import type { RaceId, RoomAiVersion } from '../../shared/types';
import type { BenchmarkInput, BenchmarkMatchInput } from '../../sdk/benchmark/core';
import type { AiGameAgent } from '../game-runner';
import { DEFAULT_AI_THINK_INTERVAL } from '../runtime';

export type NavalRoomMatch = BenchmarkMatchInput<AiGameAgent> & {
  naval: { subject: RoomAiVersion; rival: 'v8' | 'v9'; subjectTeam: string; outDir?: string; sampleSeconds: number };
  metrics?: readonly string[];
};

export function navalRoomSetup(map: (typeof MAP_POOL)[number], race: RaceId = 'grove') {
  const room = createRoom({
    id: `naval-bench-${map.id}`, host: { id: 'bench-host', name: 'Benchmark' }, mapId: map.id,
    humanCount: 1, aiCount: map.players - 1,
    seatSetup: Array.from({ length: map.players }, (_, index) => ({ controller: 'ai' as const, race, team: `team-${index % 2 + 1}`, aiVersion: 'v9_archer' as const })),
  });
  return roomToGameSetup(room);
}

/** Select by connectivity with all the named map's seats, rather than by the map's name or art. */
export function auditNavalPool() {
  return MAP_POOL.map(map => {
    const setup = navalRoomSetup(map);
    const game = createGame(setup.mapId, { ...setup.options, aiPlayers: [] });
    const homes = setup.options.players!.map(owner => game.buildings.find(b => b.owner === owner && b.kind === 'townHall')!);
    const remoteMines = homes.map(home => game.resources.filter(mine => !sameGround(game.map, home, mine)).length);
    const unreachableEnemies = homes.map(home => homes.filter(other => game.teams[home.owner] !== game.teams[other.owner] && !sameGround(game.map, home, other)).length);
    return { mapId: map.id, players: map.players, remoteMines, unreachableEnemies, selected: remoteMines.some(count => count > 0) || unreachableEnemies.some(count => count > 0) };
  });
}

export function createNavalRoomInput(options: {
  rival: 'v8' | 'v9'; subjects: readonly RoomAiVersion[]; maps?: readonly string[];
  maxTicks?: number; outDir?: string; sampleSeconds?: number; metrics?: readonly string[];
}): BenchmarkInput<AiGameAgent> {
  const selected = options.maps ?? auditNavalPool().filter(map => map.selected).map(map => map.mapId);
  const maps = selected.map(id => {
    const map = MAP_POOL.find(map => map.id === id);
    if (!map) throw new Error(`Unknown pool map ${id}`);
    return map;
  });
  return {
    name: `Naval room AIs vs ${options.rival}`,
    evaluations: options.subjects.map(subject => ({
      name: `${subject} vs ${options.rival}`, tag: 'naval-room',
      matches: maps.flatMap(map => (['grove', 'ember'] as const).flatMap(race => [1, 2].map(side => {
        const setup = navalRoomSetup(map, race);
        const subjectTeam = `team-${side}`;
        const agents = Object.fromEntries(setup.playerSlots.map(slot => {
          const version = setup.options.teams![slot.playerId] === subjectTeam ? subject : options.rival;
          return [slot.playerId, { controller: 'external-agent' as const, team: setup.options.teams![slot.playerId]!, race: slot.race, version, policyVersion: version, versionLabel: version }];
        }));
        return {
          name: `${map.id} ${subject} ${race} side-${side} vs-${options.rival}`,
          mapId: setup.mapId, options: { ...setup.options, aiPlayers: [] }, agents,
          maxTicks: options.maxTicks ?? 48_000, thinkInterval: DEFAULT_AI_THINK_INTERVAL,
          naval: { subject, rival: options.rival, subjectTeam, sampleSeconds: options.sampleSeconds ?? 30, ...(options.outDir ? { outDir: options.outDir } : {}) },
          ...(options.metrics ? { metrics: options.metrics } : {}),
        } satisfies NavalRoomMatch;
      }))),
    })),
  };
}
