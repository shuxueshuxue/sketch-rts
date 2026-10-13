import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { boardUnit } from '../../shared/decks';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext, bootstrapScripts } from './policy';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].flatMap(mirror => (['aboard', 'boarding'] as const).flatMap(stage =>
    (['depleted', 'working'] as const).map(state => ({ version, race, mirror, stage, state }))))))) (
  '$version retires a $state $race mine transfer with workers $stage (mirror=$mirror)', ({ version, race, mirror, stage, state }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('depleted-worker-transfer').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
      .townHall('us', x(500), 500, { id: 'source' }).goldMine('source-mine', x(500 + GOLD_MINE_RULES.mainDistance), 500, 5000)
      .townHall('us', x(3012), 500).goldMine('target-mine', x(3300), 500, state === 'depleted' ? 20 : 10000)
      .townHall('peer', x(500), 3500).unit('us', 'transport', x(2000), 2200, { id: 'ferry' })
      .worker('us', x(1200), 2160, { id: 'passenger-0' }).worker('us', x(1200), 2240, { id: 'passenger-1' });
    for (let index = 0; index < 5; index++) scene = scene.worker('us', x(3100), 650 + index * 25, { id: `miner-${index}`,
      order: { type: 'mine', resourceId: 'target-mine', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const col = mirror ? 127 - index % 128 : index % 128;
      return col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    for (let tick = 0; tick < 500; tick++) stepGame(game);
    const mine = game.resources.find(mine => mine.id === 'target-mine')!;
    expect(state === 'depleted' ? mine.amount === 0 : mine.amount > 0).toBe(true);
    const boat = game.units.find(unit => unit.id === 'ferry')!;
    const passengers = game.units.filter(unit => unit.id.startsWith('passenger-'));
    if (stage === 'aboard') for (const unit of passengers) expect(boardUnit(boat, unit, game.units)).toBe(true);
    else issuePlayerCommand(game, 'us', { type: 'board', unitIds: passengers.map(unit => unit.id), transportId: boat.id });
    const from = { x: x(1264), y: 2200 }, to = { x: x(2960), y: 500 };
    memory.naval = { ferries: { ferry: { purpose: 'rebase', targetId: mine.id, from, to,
      phase: stage === 'aboard' ? 'sailing' : 'loading', crewIds: passengers.map(unit => unit.id), sinceTick: game.tick } } };
    const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
    let landed = false;
    for (let tick = 0; tick < (stage === 'aboard' ? 4000 : 15) && !landed; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options)
          .map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
      if (stage === 'aboard') landed = passengers.every(unit => !unit.deck);
    }
    if (stage === 'aboard') {
      expect(landed).toBe(true);
      const destination = state === 'depleted' ? game.buildings.find(building => building.id === 'source')! : mine;
      expect(passengers.every(unit => sameGround(game.map, unit, destination))).toBe(true);
    } else expect(passengers.every(unit => unit.order.type === 'board')).toBe(state === 'working');
    for (const unit of [...passengers, boat]) expect(unit.hp).toBe(unit.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
