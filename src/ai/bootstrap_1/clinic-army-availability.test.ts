import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { strengthOf } from '../policy/v6/strength';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror }))))(
  '$version withdraws an attack whose teammates are actually in treatment (mirror=$mirror)', ({ version, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('clinic-units-are-not-ready-army').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).playerState('us', { gold: 0 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .building('us', 'moonWell', x(800), 800)
      .townHall('foe', x(3500), 3500, { id: 'enemy-hall' }).worker('foe', x(3400), 3400)
      .unit('us', 'footman', x(1000), 1000, { id: 'ready' });
    for (let i = 0; i < 3; i++) scene = scene.unit('us', 'footman', x(760 + i * 40), 740,
      { id: `patient-${i}`, hp: 90, order: { type: 'hold', x: x(760 + i * 40), y: 740 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const group = game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman');
    const enemy = game.buildings.find(building => building.id === 'enemy-hall')!;
    memory.v6 = { general: { mode: 'attack', target: { x: enemy.x, y: enemy.y }, targetHallId: enemy.id,
      group: group.map(unit => unit.id), groupStart: strengthOf(group) } };
    const ready = game.units.find(unit => unit.id === 'ready')!, home = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
    const distanceBefore = Math.hypot(ready.x - home.x, ready.y - home.y);
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
    const diagnostic = JSON.stringify({ memory, entries });
    expect(entries.filter(entry => entry.scriptId === 'frontRecovery')).toHaveLength(3);
    expect(memory.v6.general?.mode, diagnostic).not.toBe('attack');
    issueCommandFrame(game, entries);
    for (let tick = 0; tick < 30; tick++) stepGame(game);
    expect(Math.hypot(ready.x - home.x, ready.y - home.y), diagnostic).toBeLessThan(distanceBefore);
    expect(game.units.filter(unit => unit.id.startsWith('patient-'))).toHaveLength(3);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
