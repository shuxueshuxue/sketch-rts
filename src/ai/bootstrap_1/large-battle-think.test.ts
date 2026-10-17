import { expect, it } from 'vitest';
import { createGame, warmGameCaches } from '../../shared/sim';
import { poolMap } from '../../shared/map-pool';
import { isOpenGround, sameGround } from '../../shared/terrain';
import { CommandFrameRuntime } from '../../shared/sim/command-frame-runtime';
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from '../runtime';

// A live match waits for no think (see @@@planner-schedule), but a think that runs for seconds leaves its AI blind for
// as long. Four sides on Temple Spring, each with 80 mixed troops attack-moving into the centre and gold to keep
// building: the late multi-faction battle in which the mounted threat roads once took 5 to 30 s a think. The bound is
// loose (machines differ); it catches a cost that grows with the armies again.
const THINK_BOUND_MS = 2000;
const TICKS = 900;
const KINDS = { grove: ['footman', 'archer', 'lancer', 'knight', 'priest', 'archer'], ember: ['raider', 'horseArcher', 'ashWarden', 'emberRavager', 'sparkArcher', 'ashHexer'] } as const;

it('keeps every AI think of a four-army battle within a bound', () => {
  const players = ['player', 'enemy', 'enemy2', 'player-4'], aiPlayers = players.slice(1);
  const races = { player: 'grove', enemy: 'ember', enemy2: 'grove', 'player-4': 'ember' } as const;
  const versions = { enemy: 'v9_knight', enemy2: 'v9_archer', 'player-4': 'v9_summoner' } as const;
  const setup = { players, aiPlayers, aiVersions: versions, races,
    teams: { player: 'team-1', enemy: 'team-2', enemy2: 'team-3', 'player-4': 'team-4' },
    layout: { ...poolMap('templeSpring')!.layout, seed: 'pool-templeSpring-1' } };
  // Each army on open ground joined to its hall and the centre, searched outward from 45% of the way between them.
  const plain = createGame('templeSpring', setup);
  const centre = { x: plain.map.width / 2, y: plain.map.height / 2 };
  const addUnits = players.flatMap(owner => {
    const hall = plain.buildings.find(building => building.owner === owner && building.kind === 'townHall')!;
    const anchor = { x: hall.x + (centre.x - hall.x) * 0.45, y: hall.y + (centre.y - hall.y) * 0.45 }, taken: { x: number; y: number }[] = [];
    for (let r = 0; taken.length < 80 && r < 2000; r += 18) for (let a = 0; a < 2 * Math.PI && taken.length < 80; a += 36 / Math.max(r, 18)) {
      const point = { x: Math.round(anchor.x + Math.cos(a) * r), y: Math.round(anchor.y + Math.sin(a) * r) };
      if (isOpenGround(plain.map, point.x, point.y) && sameGround(plain.map, point, hall) && sameGround(plain.map, point, centre)
        && !taken.some(other => Math.hypot(other.x - point.x, other.y - point.y) < 34)) taken.push(point);
    }
    return taken.map((point, index) => ({ id: `army-${owner}-${index}`, owner, kind: KINDS[races[owner as keyof typeof races]][index % 6]!,
      ...point, order: { type: 'attackMove' as const, ...centre } }));
  });
  const game = createGame('templeSpring', { ...setup, scenario: { players: Object.fromEntries(players.map(owner => [owner, { gold: 20000 }])), addUnits } });
  warmGameCaches(game);
  const runtime = new CommandFrameRuntime({ game, roomId: 'large-battle', rejectionLabel: 'Large battle rejected',
    aiPlanner: createPresetAiRuntimeFramePlanner(game, createAiRuntime(aiPlayers, { versions })) });
  let slowest = 0;
  for (let tick = 0; tick < TICKS && !game.match.winner; tick += 1) {
    const started = performance.now();
    runtime.tick();
    slowest = Math.max(slowest, performance.now() - started);
  }
  expect(game.tick).toBe(TICKS);
  expect(slowest).toBeLessThan(THINK_BOUND_MS);
}, 240_000);
