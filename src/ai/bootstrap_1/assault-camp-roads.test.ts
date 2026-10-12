import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';
import { PASS_CLEARANCE } from '../policy/v9/march';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].map(cliff => ({ version, race, mirror, cliff })))));

it.each(cases)('$version marches its $race army around a camp on the physical road (mirror=$mirror, cliff=$cliff)',
  ({ version, race, mirror, cliff }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('assault-road-creep-contact').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 0 })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .townHall('foe', x(3100), 1800, { id: 'target' })
      .worker('foe', x(3500), 3350)
      .unit('neutral', 'graniteGolem', x(1900), 2700, { id: 'road-camp' });
    for (let index = 0; index < 8; index++) scene = scene.unit('us', race === 'grove' ? 'knight' : 'ashChieftain',
      x(1000 + index % 2 * 40), 1800 + Math.floor(index / 2) * 40, { id: `fighter-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const row = Math.floor(index / 128), col = mirror ? 127 - index % 128 : index % 128;
      return cliff && col >= 56 && col <= 60 && row < 80 ? '#' : '.';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { phase: 1, general: { mode: 'attack', targetHallId: 'target',
      target: { x: x(3100), y: 1800 }, group: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), groupStart: 20 } };
    const start = game.units.find(unit => unit.id === 'fighter-0')!, initial = { x: start.x, y: start.y };
    const target = game.buildings.find(building => building.id === 'target')!;
    expect(routeClearsDisks(groundSteeringRoute(game.map, initial, target),
      [{ x: x(1900), y: 2700, radius: PASS_CLEARANCE }])).toBe(!cliff);
    let detours = 0;
    // Observe transit until the first hit on its destination; later camp tasks are a different decision.
    for (let tick = 0; tick < 2200 && target.hp === target.maxHp; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), commands = planBootstrapGeneral(snapshot, 'us',
          bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams }));
        detours += commands.filter(command => command.type === 'move' && command.avoidCombat).length;
        issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
      }
      stepGame(game);
    }
    const fighters = game.units.filter(unit => unit.id.startsWith('fighter-'));
    expect(fighters).toHaveLength(8);
    expect(fighters.every(unit => unit.hp === unit.maxHp)).toBe(true);
    const camp = game.units.find(unit => unit.id === 'road-camp')!;
    expect(camp.hp).toBe(camp.maxHp);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(detours > 0).toBe(cliff);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
