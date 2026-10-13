import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { mercenaryControl } from './mercenary-control';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].map(mirror => ({ version, race, mirror }))))) (
  '$version returns its $race courier when new enemies cut the buying road (mirror=$mirror)', ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('mercenary-trip-cut-road').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 1200).townHall('foe', x(3500), 3500)
      .unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(650), 1200, { id: 'courier' })
      .mercenaryCamp('camp', x(3000), 1200, { hireKind: 'mercenary', cost: 160, stock: 2, cooldownSeconds: 16 });
    for (let i = 0; i < 6; i++) scene = scene.unit('foe', 'archer', x(2150 + i % 3 * 30), 2400 + Math.floor(i / 3) * 30, { id: `blocker-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    sdk.issue([{ playerId: 'foe', scriptId: 'intercept-road', command: { type: 'attackMove',
      unitIds: game.units.filter(unit => unit.id.startsWith('blocker-')).map(unit => unit.id), x: x(2150), y: 1200 } }], {}, { checksum: false });
    let left = false, returned = false;
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        const commands = mercenaryControl.run(snapshot, 'us', options);
        left ||= commands.some(command => command.type === 'move' && command.x === x(3000));
        returned ||= left && commands.some(command => command.type === 'move' && Math.abs(command.x - x(500)) < 32);
        sdk.issue(commands.map(command => ({ playerId: 'us', scriptId: 'mercenaryControl', command })), {}, { checksum: false });
      }
      stepGame(game);
    }
    expect(left).toBe(true);
    expect(returned).toBe(true);
    const courier = game.units.filter(unit => unit.id === 'courier');
    expect(courier).toHaveLength(1);
    const home = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
    expect(Math.hypot(courier[0]!.x - home.x, courier[0]!.y - home.y)).toBeLessThanOrEqual(V7_GATHERED_RANGE);
    expect(courier[0]!.hp).toBe(courier[0]!.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
