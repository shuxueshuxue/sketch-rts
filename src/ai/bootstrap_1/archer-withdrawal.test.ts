import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  '$race withdraws its outnumbered shooters without pulling an untouched camp (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const shooter = race === 'grove' ? 'archer' : 'sparkArcher';
    const enemy = race === 'grove' ? 'sparkArcher' : 'archer';
    let scene = sketchScene('archer-outnumbered-withdrawal').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: race === 'grove' ? 'ember' : 'grove', team: 'b' })
      .playerState('us', { gold: 500 }).townHall('us', x(500), 500).townHall('foe', x(3300), 3300)
      .unit('neutral', 'redDragon', x(1500), 1600, { id: 'dragon' });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', shooter,
      x(1800), 1500 + index * 35, { id: `shooter-${index}` });
    for (let index = 0; index < 10; index++) scene = scene.unit('foe', enemy,
      x(2100 + index % 2 * 30), 1460 + Math.floor(index / 2) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    let damage = 0;
    game.observer = { hit(_source, target, amount) { if (target.owner === 'us') damage += amount; } };
    for (let tick = 0; tick < 500; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    const survivors = game.units.filter(unit => unit.owner === 'us');
    expect(survivors).toHaveLength(4);
    expect(survivors.every(unit => unit.hp === unit.maxHp && Math.hypot(unit.x - x(500), unit.y - 500) < 300)).toBe(true);
    expect(damage).toBe(0);
    const dragon = game.units.find(unit => unit.id === 'dragon')!;
    expect(dragon.hp).toBe(dragon.maxHp);
    expect(game.players.us!.gold).toBe(500);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.match.winner).toBeNull();
  }, 30000);
