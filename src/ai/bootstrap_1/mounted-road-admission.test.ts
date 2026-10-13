import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => (['open', 'detour', 'closed'] as const).map(road => ({ version, mirror, road }))))) (
  '$version admits the actual raid road before sending its independent riders (mirror=$mirror, road=$road)', ({ version, mirror, road }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('mounted-road-admission').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).playerState('us', { gold: 0 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .townHall('foe', x(1900), 500, { id: 'raid-hall' }).worker('foe', x(1800), 500, { id: 'target' })
      .unit('us', 'horseArcher', x(850), 500, { id: 'rider-a' }).unit('us', 'horseArcher', x(900), 500, { id: 'rider-b' })
      .unit('neutral', 'wildling', x(700), 2200, { id: 'safe-camp' }).goldMine('camp-mine', x(700), 2440, 4000)
      .unit('neutral', 'wildling', x(400), 3200, { id: 'second-camp' }).goldMine('second-camp-mine', x(400), 3440, 4000);
    if (road !== 'open') scene = scene.tower('foe', x(1200), 1430, { id: 'road-tower' });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const wall = Math.floor(x(1280) / 32);
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
      index % 128 === wall && (road === 'closed' || Math.floor(index / 128) < 40) ? 'T' : '.').join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['target'] });
    let raids = 0, campOrders = 0;
    for (let tick = 0; tick < 2400 && game.units.some(unit => road === 'closed'
      ? unit.id === 'safe-camp' || unit.id === 'second-camp' : unit.id === 'target'); tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
        raids += memory.mounted!.filter(job => job.objective.kind === 'raid').length;
        campOrders += memory.mounted!.filter(job => job.objective.kind === 'camp').length;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    if (road === 'closed') {
      expect(raids).toBe(0);
      expect(campOrders).toBeGreaterThan(0);
      expect(game.units.some(unit => unit.id === 'safe-camp' || unit.id === 'second-camp')).toBe(false);
      expect(game.units.find(unit => unit.id === 'target')!.hp).toBe(game.units.find(unit => unit.id === 'target')!.maxHp);
    } else {
      expect(raids).toBeGreaterThan(0);
      expect(game.units.some(unit => unit.id === 'target')).toBe(false);
    }
    expect(game.units.filter(unit => unit.id.startsWith('rider-'))).toHaveLength(2);
    expect(game.units.filter(unit => unit.id.startsWith('rider-')).every(unit => unit.hp === unit.maxHp)).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
