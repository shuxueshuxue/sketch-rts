import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BOARDING_GAP } from '../../shared/naval';
import { distanceToHull } from '../../shared/ship-geometry';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';
import { transportRecovery } from './transport-recovery';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(race: 'grove' | 'ember', mirror: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  const soldier = race === 'grove' ? 'footman' : 'emberRavager';
  const game = sketchScene('ferry-departure').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(800), 2200).townHall('foe', x(400), 400)
    .building('us', 'shipyard', x(1536), 3000)
    .unit('us', 'transport', x(1712), 1500, { id: 'ferry', hpRatio: .8 })
    .unit('us', soldier, x(1712), 1640, { id: 'landed' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const column = mirror ? 127 - index % 128 : index % 128;
    return column < 50 ? '.' : column < 55 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const boat = game.units.find(unit => unit.id === 'ferry')!;
  boat.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 };
  const landed = game.units.find(unit => unit.id === 'landed')!;
  expect(distanceToHull(boat, landed)).toBeLessThanOrEqual(landed.radius + BOARDING_GAP);
  return { game, boat, landed, x };
}

it.each(cases)('$version clears healthy landed $race troops and pays for port repair (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const { game, boat, landed } = field(race, mirror), memory = createAiPolicyMemory();
    const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
    const initialGold = game.players.us!.gold;
    let cleared = false;
    for (let tick = 0; tick < 2400 && shipNeedsRepair(game, boat); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
        cleared ||= entries.some(entry => entry.command.type === 'move' && entry.command.unitIds.includes(landed.id));
        issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
    }
    const diagnostic = JSON.stringify({ boat, landed, memory, spent: game.match.stats.goldSpent.us });
    expect(cleared, diagnostic).toBe(true);
    expect(shipNeedsRepair(game, boat), diagnostic).toBe(false);
    expect(boat.y).toBeGreaterThan(2500);
    expect(landed.hp).toBe(landed.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBeGreaterThan(0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(initialGold);
  }, 60000);

it.each(cases)('$version preserves active combat, injured troops, workers and mounted jobs ($race, mirror=$mirror)',
  ({ version, race, mirror }) => {
    const { game, boat, landed, x } = field(race, mirror), memory = createAiPolicyMemory();
    const hurt = game.spawnUnit('us', landed.kind, x(1680), 1640); hurt.hp -= 1;
    const worker = game.spawnUnit('us', 'worker', x(1680), 1640);
    const rider = game.spawnUnit('us', race === 'grove' ? 'horseArcher' : 'cinderRunner', x(1680), 1640);
    memory.mounted = [{ unitIds: [rider.id], objective: { kind: 'camp', ids: [] } }];
    landed.order = { type: 'attackMove', x: x(400), y: 400 };
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
    const recovery = transportRecovery(snapshot, 'us', options);
    expect(recovery.ids.has(boat.id)).toBe(true);
    for (const unit of [landed, hurt, worker, rider]) expect(recovery.ids.has(unit.id)).toBe(false);
    issueCommandFrame(game, recovery.commands.map(command => ({ playerId: 'us', scriptId: 'recovery', command })));
    expect(landed.order.type).toBe('attackMove');
    expect(hurt.order.type).toBe('idle');
    expect(worker.order.type).toBe('idle');
    expect(rider.order.type).toBe('idle');
    expect(game.players.us!.gold).toBe(500);
  });

it.each(cases)('$version rejects a clearing road covered by a hostile tower ($race, mirror=$mirror)',
  ({ version, race, mirror }) => {
    const { game, landed, x } = field(race, mirror);
    const towerGame = sketchScene('dangerous-clearing-road').map('bareDuel').replaceDefaults()
      .player('foe').building('foe', 'defenseTower', x(1100), 1950).build().createGame();
    game.buildings.push(towerGame.buildings[0]!);
    setBuildingBodies(game.map, game.buildings);
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version,
      { memory: createAiPolicyMemory(), teams: game.teams });
    const recovery = transportRecovery(snapshot, 'us', options);
    expect(recovery.ids.has(landed.id)).toBe(false);
    expect(recovery.commands.some(command => 'unitIds' in command && command.unitIds.includes(landed.id))).toBe(false);
  });
