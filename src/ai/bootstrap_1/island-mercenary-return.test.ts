import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { mercenaryControl } from './mercenary-control';
import { controlledMercenaryGoals } from './mercenary-goals';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version returns paid $race island recruits to a reachable owned hall (mirror=$mirror)', ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const scene = sketchScene('island-mercenary-home').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
      .townHall('us', x(500), 500).townHall('us', x(2500), 1600, { id: 'island-home' })
      .townHall('peer', x(3500), 3500)
      .farms('us', 5, x(500), 1000)
      .unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(2650), 1650, { id: 'courier' })
      .mercenaryCamp('camp', x(3300), 1600, { hireKind: 'mercenary', cost: 160, stock: 2, cooldownSeconds: 16 });
    const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.scriptedVictory = true;
    const water = Array.from({ length: 128 }, () => '.'.repeat(62) + '~'.repeat(4) + '.'.repeat(62)).join('');
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: water };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    let paid = 0;
    for (let tick = 0; tick < 2400; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        const purchases = controlledMercenaryGoals(snapshot, 'us', options).flatMap(goal => {
          if (goal.cost > game.players.us!.gold) return [];
          const command = goal.issue();
          return command ? [command] : [];
        });
        for (const command of purchases) if (command.type === 'hire') paid += 160;
        sdk.issue([...purchases, ...mercenaryControl.run(snapshot, 'us', options)]
          .map(command => ({ playerId: 'us', scriptId: 'mercenaryControl', command })), {}, { checksum: false });
      }
      stepGame(game);
    }
    expect(paid).toBe(320);
    const hall = game.buildings.find(building => building.id === 'island-home')!;
    const returned = game.units.filter(unit => unit.id === 'courier' || unit.owner === 'us' && unit.kind === 'mercenary');
    expect(returned).toHaveLength(3);
    for (const unit of returned) expect(Math.hypot(unit.x - hall.x, unit.y - hall.y)).toBeLessThanOrEqual(V7_GATHERED_RANGE);
    expect(game.players.us!.gold).toBe(180);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(memory.mercenaryCourier).toBeUndefined();
  }, 30000);

it.each([false, true])('a paid recruit chooses the shorter road around water (mirror=%s)', mirror => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const scene = sketchScene('mercenary-road-home').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('peer', { team: 'a' })
    .townHall('us', x(1800), 2000, { id: 'across-water' })
    .townHall('us', x(2500), 2800, { id: 'road-home' }).townHall('peer', x(3500), 3500)
    .unit('us', 'footman', x(2200), 2000, { id: 'buyer' })
    .mercenaryCamp('camp', x(2200), 2000, { hireKind: 'mercenary', cost: 160, stock: 1, cooldownSeconds: 16 });
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  game.scriptedVictory = true;
  const cells = Array.from({ length: 128 }, (_, row) => row > 3 && row < 123
    ? '.'.repeat(62) + '~'.repeat(4) + '.'.repeat(62) : '.'.repeat(128)).join('');
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  sdk.issue([{ playerId: 'us', scriptId: 'purchase', command: { type: 'hire', campId: 'camp' } }], {}, { checksum: false });
  for (let tick = 0; tick < 1000; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory, teams: game.teams });
      sdk.issue(mercenaryControl.run(snapshot, 'us', options).map(command => ({ playerId: 'us', scriptId: 'mercenaryControl', command })), {}, { checksum: false });
    }
    stepGame(game);
  }
  const recruit = game.units.find(unit => unit.kind === 'mercenary')!;
  const roadHome = game.buildings.find(building => building.id === 'road-home')!;
  expect(Math.hypot(recruit.x - roadHome.x, recruit.y - roadHome.y)).toBeLessThanOrEqual(V7_GATHERED_RANGE);
  expect(game.players.us!.gold).toBe(340);
  expect(game.match.stats.unitsLost.us).toBe(0);
});
