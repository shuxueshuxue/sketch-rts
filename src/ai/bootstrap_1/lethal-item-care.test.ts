import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { UNIT_DEFS } from '../../shared/catalog';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { frontRecovery } from './front-recovery';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(version: typeof cases[number]['version'], race: 'grove' | 'ember', mirror: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  const kind = version === 'v9_archer' ? race === 'grove' ? 'horseArcher' : 'sparkArcher'
    : version === 'v9_summoner' ? 'summoner'
      : race === 'grove' ? 'knight' : 'ashChieftain';
  const scene = sketchScene('lethal-carried-items-before-fixed-wounded-threshold').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 3500).townHall('foe', x(3500), 3500)
    .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(1000), 1000)
    .unit('us', kind, x(1400), 1000, { id: 'patient', hp: Math.min(160, UNIT_DEFS[kind].hp * .5),
      order: { type: 'move', x: x(2300), y: 1000 } })
    .unit('neutral', 'ogreLord', x(1680), 1000, { id: 'caster-1' })
    .unit('neutral', 'ogreLord', x(1680), 1040, { id: 'caster-2' })
    .item('rod-1', 'lightningRod', 0, 0, { carrierId: 'caster-1' })
    .item('rod-2', 'lightningRod', 0, 0, { carrierId: 'caster-2' });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const patient = game.units.find(unit => unit.id === 'patient')!;
  const marching: AiScript = { id: 'ordinary-march', phase: 'tactics', run: () =>
    ({ type: 'move', unitIds: [patient.id], x: x(2300), y: 1000 }) };
  return { game, patient, marching };
}

it.each(cases)('$version saves a $race marcher before ready carried impacts can kill it (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const { game, patient, marching } = field(version, race, mirror), memory = createAiPolicyMemory();
    expect(patient.hp).toBeGreaterThan(patient.maxHp * .35);
    let damage = 0;
    game.observer = { hit(_source, target, taken) { if (target.id === patient.id) damage += taken; } };
    for (let elapsed = 0; elapsed < 2400 && game.units.includes(patient) && patient.hp < patient.maxHp; elapsed++) {
      if (elapsed % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [frontRecovery, marching], options);
        if (elapsed === 0) expect(entries.some(entry => entry.scriptId === 'frontRecovery')).toBe(true);
        issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
      }
      stepGame(game);
    }
    expect(game.units).toContain(patient);
    expect(patient.hp).toBe(patient.maxHp);
    expect(damage).toBe(0);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.match.winner).toBeNull();
    const view = snapshotGame(game), options = bootstrapPolicyContext(view, 'us', version, { memory, teams: game.teams });
    expect(runAiCommandEntriesFromScripts(view, 'us', [frontRecovery, marching], options)
      .some(entry => entry.scriptId === 'ordinary-march')).toBe(true);
  });

it.each(['cooling', 'protected', 'friendly', 'distant', 'packed'] as const)('keeps normal marching when the carried impact is %s', mode => {
  const { game, patient, marching } = field('v9_knight', 'grove', false), memory = createAiPolicyMemory();
  if (mode === 'cooling') for (const item of game.items) item.cooldownRemaining = 60;
  if (mode === 'protected') patient.effects.push({ type: 'guardian', remaining: 1000 });
  if (mode === 'friendly') for (const caster of game.units.filter(unit => unit.owner === 'neutral')) caster.owner = 'us';
  if (mode === 'distant') for (const caster of game.units.filter(unit => unit.owner === 'neutral')) caster.x = 3000;
  if (mode === 'packed') for (const item of game.items) if (item.kind === 'lightningRod') item.slot = 'carry0';
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
  const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [frontRecovery, marching], options);
  expect(entries.some(entry => entry.scriptId === 'frontRecovery')).toBe(false);
  expect(entries.some(entry => entry.scriptId === 'ordinary-march')).toBe(true);
  issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
  expect(patient.order.type).toBe('move');
});
