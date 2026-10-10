import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror => [3, 5].map(count => ({ version, race, mirror, count })))));

it.each(cases)('$version fires through $count $race infantry instead of one off-axis target (mirror=$mirror)',
  ({ version, race, mirror, count }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('ordinary-piercing-formation').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race, team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .unit('us', 'ballista', x(1500), 1500, { id: 'gun' })
      .unit('foe', race === 'grove' ? 'lancer' : 'emberRavager', x(1780), 1800, { id: 'off-axis' });
    for (let index = 0; index < count; index++) scene = scene.unit('foe', race === 'grove' ? 'footman' : 'ashWarden',
      x(1650 + index * 100), 1500, { id: `line-${index}` });
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const gun = game.units.find(unit => unit.id === 'gun')!;
    const foes = game.units.filter(unit => unit.owner === 'foe');
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: [gun.id] });
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: foes.map(unit => unit.id) });
    const entries = runAiCommandEntriesFromScripts(snapshotGame(game), 'us', bootstrapScripts(version).filter(script => script.id === 'abilities'),
      { version: 'v2', requestedVersion: version === 'v9_summoner' ? 'v7' : 'v9', memory: createAiPolicyMemory(), teams: game.teams });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.command).toMatchObject({ type: 'cast', ability: 'pinningBolt', targetId: 'line-2' });
    issuePlayerCommand(game, 'us', entries[0]!.command);
    // Execute the ordinary aim wind-up, then move away so basic shots do not contaminate the skill's damage.
    for (let tick = 0; tick < 80 && game.projectiles.length === 0; tick++) stepGame(game);
    expect(game.projectiles).toHaveLength(1);
    issuePlayerCommand(game, 'us', { type: 'move', unitIds: [gun.id], x: x(1000), y: 1500 });
    for (let tick = 0; tick < 30; tick++) stepGame(game);
    expect(foes.filter(unit => unit.hp < unit.maxHp).map(unit => unit.id)).toEqual(['line-0', 'line-1', 'line-2']);
    expect(foes.reduce((total, unit) => total + unit.maxHp - unit.hp, 0)).toBe(79);
    expect(foes.filter(unit => unit.effects.some(effect => effect.type === 'root'))).toHaveLength(3);
    expect(gun.hp).toBe(gun.maxHp);
    expect(game.players.us!.gold).toBe(500);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.match.winner).toBeNull();
  });
