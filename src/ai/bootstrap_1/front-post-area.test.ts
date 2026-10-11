import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version restores a $race patient while the escaped storm is still active (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('storm-front-care-handover').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'ember', team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
      .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(1100), 1700, { id: 'well' })
      .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(1700), 1700, { id: 'patient' })
      .unit('foe', 'ballista', x(1700), 1300, { id: 'gun-1' })
      .unit('foe', 'ballista', x(1700), 2100, { id: 'gun-2' })
      .unit('foe', 'footman', x(2000), 1700, { id: 'caster' })
      .item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' }).build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const patient = game.units.find(unit => unit.id === 'patient')!;
    const guns = game.units.filter(unit => unit.kind === 'ballista');
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: [patient.id] });
    for (const gun of guns) issuePlayerCommand(game, 'foe', { type: 'cast', unitId: gun.id, ability: 'pinningBolt', targetId: patient.id });
    for (let tick = 0; tick < 100 && game.projectiles.length < 2; tick++) stepGame(game);
    expect(game.projectiles).toHaveLength(2);
    issuePlayerCommand(game, 'foe', { type: 'move', unitIds: guns.map(unit => unit.id), x: x(500), y: 3500, avoidCombat: true });
    for (let tick = 0; tick < 45; tick++) stepGame(game);
    expect(patient.hp).toBe(patient.maxHp - 72);
    issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: 'caster', itemId: 'staff', x: patient.x, y: patient.y });
    issuePlayerCommand(game, 'foe', { type: 'move', unitIds: ['caster'], x: x(3500), y: 3000, avoidCombat: true });
    for (let tick = 0; tick < 100 && patient.hp >= patient.maxHp * .35; tick++) stepGame(game);
    expect(patient.hp).toBeGreaterThan(0);
    expect(patient.hp).toBeLessThan(patient.maxHp * .35);
    expect(game.effects.some(effect => effect.type === 'storm' && effect.remaining > 90)).toBe(true);
    const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    const well = game.buildings.find(building => building.id === 'well')!;
    let careBeforeStormEnded = false, fullHealth = false;
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version, policyMode: 'combat', memory }, { teams: game.teams });
        if (entries.some(entry => entry.command.type === 'move' && entry.command.unitIds.includes(patient.id)
          && Math.hypot(entry.command.x - well.x, entry.command.y - well.y) <= well.attackRange)
          && game.effects.some(effect => effect.type === 'storm')) careBeforeStormEnded = true;
        sdk.issue(entries, {}, { checksum: false });
      }
      stepGame(game);
      if (patient.hp === patient.maxHp) fullHealth = true;
    }
    expect(careBeforeStormEnded).toBe(true);
    expect(fullHealth).toBe(true);
    expect(game.units).toContain(patient);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
