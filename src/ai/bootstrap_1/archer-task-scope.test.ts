import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['archer', 'sparkArcher', 'horseArcher'] as const).flatMap(kind =>
  [false, true].map(mirror => ({ kind, mirror })))) (
  'protects a free $kind while a separate camp retains its assigned shooter (mirror=$mirror)', ({ kind, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('camp-does-not-disable-free-shooters').map('bareDuel').replaceDefaults()
      .player('us', { race: kind === 'sparkArcher' ? 'ember' : 'grove', team: 'a' })
      .playerState('us', { gold: 0 }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).worker('us', x(600), 600)
      .townHall('foe', x(3500), 3500).worker('foe', x(3500), 3400)
      .unit('us', kind, x(1000), 2000, { id: 'free' })
      .unit('foe', 'footman', x(1080), 2000, { id: 'pursuer', order: { type: 'attack', targetId: 'free' } })
      .unit('us', kind, x(2700), 1900, { id: 'camp-shooter' })
      .unit('foe', 'footman', x(2780), 1900, { id: 'camp-pursuer', order: { type: 'attack', targetId: 'camp-shooter' } })
      .unit('neutral', 'wildling', x(3300), 1900, { id: 'camp-guard' });
    const group = ['camp-shooter'];
    for (let i = 0; i < 4; i++) {
      group.push(`camp-front-${i}`);
      scene = scene.unit('us', 'footman', x(2670), 1840 + i * 40, { id: `camp-front-${i}` });
    }
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { general: { mode: 'creep', target: { x: x(3300), y: 1900 } },
      creep: { center: { x: x(3300), y: 1900 }, reach: 0, staging: { x: x(3000), y: 1900 }, stage: 'gather', since: 0, group } };
    const free = game.units.find(unit => unit.id === 'free')!, startingHp = free.hp;
    for (const unit of game.units.filter(unit => unit.id === 'free' || unit.id === 'camp-shooter')) unit.cooldown = UNIT_DEFS[kind].attackCooldown;
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_archer', memory }, { teams: game.teams });
    issueCommandFrame(game, entries);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    const diagnostic = JSON.stringify({ entries, free: { x: free.x, y: free.y, hp: free.hp, order: free.order }, creep: memory.v6.creep });
    expect(free.hp, diagnostic).toBe(startingHp);
    expect(entries.some(entry => entry.scriptId === 'skirmishPreservation' && 'unitIds' in entry.command
      && entry.command.unitIds.includes('free')), diagnostic).toBe(true);
    expect(entries.some(entry => entry.scriptId === 'skirmishPreservation' && 'unitIds' in entry.command
      && entry.command.unitIds.includes('camp-shooter')), diagnostic).toBe(false);
    expect(memory.v6.creep!.group).toContain('camp-shooter');
    expect(memory.v6.creep!.group).not.toContain('free');
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
