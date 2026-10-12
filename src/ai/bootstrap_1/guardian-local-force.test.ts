import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { GUARDIAN_SCROLL } from '../../shared/item-rules';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    [false, true].flatMap(reinforced => [false, true].map(contact => ({ version, race, mirror, reinforced, contact }))))));

it.each(cases)('$version judges the actual local $race fight (mirror=$mirror, reinforced=$reinforced, contact=$contact)',
  ({ version, race, mirror, reinforced, contact }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const bow = race === 'grove' ? 'archer' : 'sparkArcher';
    let scene = sketchScene('local-guardian-force').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', x(400), 500).townHall('foe', x(3600), 3500)
      .unit('us', bow, x(1500), 1500, { id: 'carrier' })
      .item('scroll', 'guardianScroll', x(1500), 1500, { carrierId: 'carrier' })
      .item('reserve-scroll', 'guardianScroll', x(1500), 1550, { carrierId: 'local-0' });
    for (let index = 0; index < 3; index++) scene = scene.unit('us', bow, x(1500), 1550 + index * 50, { id: `local-${index}` });
    for (let index = 0; index < 8; index++) scene = scene.unit('us', bow,
      x(reinforced ? 1300 : 400), 1000 + index * 35, { id: `reserve-${index}` });
    for (let index = 0; index < 6; index++) scene = scene.unit('foe', 'archer', x(contact ? 1735 : 1835), 1440 + index * 24, { id: `foe-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.scriptedVictory = true;
    const locals = game.units.filter(unit => unit.id === 'carrier' || unit.id.startsWith('local-'));
    const startHp = locals.map(unit => unit.hp);
    for (const foe of game.units.filter(unit => unit.owner === 'foe')) sdk.issue([
      { playerId: 'foe', scriptId: 'ranged-contact', command: { type: 'attack', unitIds: [foe.id], targetId: 'carrier' } },
    ], {}, { checksum: false });
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory,
      scripts: bootstrapScripts(version).filter(script => script.id === 'items') }, { teams: game.teams });
    const shouldCast = contact || !reinforced;
    expect(entries.some(entry => entry.command.type === 'useItem' && entry.command.itemId === 'scroll')).toBe(shouldCast);
    expect(entries.filter(entry => entry.command.type === 'useItem')).toHaveLength(shouldCast ? 1 : 0);
    sdk.issue(entries, {}, { checksum: false });
    expect(game.items.some(item => item.id === 'scroll')).toBe(!shouldCast);
    expect(locals.every(unit => unit.effects.some(effect => effect.type === 'guardian' && effect.remaining === GUARDIAN_SCROLL.duration))).toBe(shouldCast);
    if (shouldCast) {
      let enemyFired = false;
      for (let tick = 0; tick < 80; tick++) {
        stepGame(game);
        enemyFired ||= game.units.some(unit => unit.owner === 'foe' && unit.cooldown > 0);
      }
      expect(enemyFired).toBe(true);
      expect(locals.map(unit => unit.hp)).toEqual(startHp);
      expect(game.match.stats.unitsLost.us).toBe(0);
      expect(game.players.us!.gold).toBe(500);
      expect(game.units.filter(unit => unit.id.startsWith('reserve-')).every(unit => !unit.effects.some(effect => effect.type === 'guardian'))).toBe(true);
      expect(game.items.some(item => item.id === 'reserve-scroll')).toBe(true);
      const next = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory,
        scripts: bootstrapScripts(version).filter(script => script.id === 'items') }, { teams: game.teams });
      expect(next.some(entry => entry.command.type === 'useItem' && entry.command.itemId === 'reserve-scroll')).toBe(false);
    }
  });

it('uses both scrolls when two separate groups enter contact in the same frame', () => {
  let scene = sketchScene('separate-guardian-fields').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', 400, 500).townHall('foe', 3600, 3500);
  for (const center of [1000, 3000]) {
    for (let index = 0; index < 4; index++) scene = scene.unit('us', 'archer', center, 1500 + index * 40, { id: `ally-${center}-${index}` });
    for (let index = 0; index < 3; index++) scene = scene.unit('foe', 'archer', center + 235, 1500 + index * 40);
    scene = scene.item(`scroll-${center}`, 'guardianScroll', center, 1500, { carrierId: `ally-${center}-0` });
  }
  const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version: 'v9_archer', memory,
    scripts: bootstrapScripts('v9_archer').filter(script => script.id === 'items') }, { teams: game.teams });
  expect(entries.filter(entry => entry.command.type === 'useItem')).toHaveLength(2);
  sdk.issue(entries, {}, { checksum: false });
  expect(game.units.filter(unit => unit.owner === 'us').every(unit => unit.effects.some(effect => effect.type === 'guardian'))).toBe(true);
  expect(game.items.some(item => item.kind === 'guardianScroll')).toBe(false);
  expect(game.players.us!.gold).toBe(500);
});
