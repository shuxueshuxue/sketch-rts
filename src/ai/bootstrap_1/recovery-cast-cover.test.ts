import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { frontRecovery, postRecoveryAssignments } from './front-recovery';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version respects a ready item on a retreating enemy during $race recovery (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('retreating-caster-care-coverage').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 3500).townHall('foe', x(3500), 3500)
      .unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(1200), 1000, { id: 'patient', hp: 21 })
      .unit('foe', 'footman', x(2250), 1240, { id: 'caster' })
      .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(2300), 1000, { id: 'near' })
      .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(32), 1000, { id: 'far' })
      .item('staff', 'stormStaff', 0, 0, { carrierId: 'caster' }).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const patient = game.units.find(unit => unit.id === 'patient')!, caster = game.units.find(unit => unit.id === 'caster')!;
    issuePlayerCommand(game, 'foe', { type: 'move', unitIds: [caster.id], x: x(3500), y: 3500, avoidCombat: true });
    const memory = createAiPolicyMemory(), snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
    expect(postRecoveryAssignments(snapshot, 'us', options).find(item => item.patient.id === patient.id)!.post.id).toBe('far');
    issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', [frontRecovery], options).map(entry => ({ ...entry, playerId: 'us' })));
    const near = game.buildings.find(building => building.id === 'near')!;
    issuePlayerCommand(game, 'foe', { type: 'useItem', unitId: caster.id, itemId: 'staff', x: near.x, y: near.y });
    expect(caster.order.type).toBe('move');
    expect(game.effects.some(effect => effect.type === 'storm')).toBe(true);
    let damage = 0;
    game.observer = { hit(_source, target, taken) { if (target.id === patient.id) damage += taken; } };
    for (let tick = 0; tick < 2400 && game.units.includes(patient) && patient.hp < patient.maxHp; tick++) {
      if (tick % 15 === 0) {
        const view = snapshotGame(game), context = bootstrapPolicyContext(view, 'us', version, { memory, teams: game.teams });
        issueCommandFrame(game, runAiCommandEntriesFromScripts(view, 'us', [frontRecovery], context).map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
    }
    expect(game.units).toContain(patient);
    expect(patient.hp).toBe(patient.maxHp);
    expect(damage).toBe(0);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
