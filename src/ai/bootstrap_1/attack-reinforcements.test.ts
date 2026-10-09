import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import type { RaceId } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { strengthOf } from '../policy/v6/strength';
import { BOOTSTRAP_VERSIONS } from './policy';

function attack(race: RaceId, gunX: number) {
  const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
  const artillery = race === 'grove' ? 'ballista' : 'catapult';
  let scene = sketchScene('attack-reinforcement').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 0 })
    .townHall('us', 400, 1000).townHall('foe', 3400, 3500, { id: 'main' })
    .townHall('foe', 3000, 1000, { id: 'outpost' })
    .worker('foe', 3300, 3400).worker('foe', 3400, 3400).worker('foe', 3500, 3400)
    .unit('us', artillery, gunX, 1300, { id: 'late-gun' });
  for (let i = 0; i < 8; i++) scene = scene.unit('us', heavy, 2000 + i * 35, 1400, { id: `main-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  const group = game.units.filter(unit => unit.owner === 'us' && unit.id !== 'late-gun');
  memory.v6 = { general: { mode: 'attack', targetHallId: 'outpost', target: { x: 3000, y: 1000 },
    group: group.map(unit => unit.id), groupStart: strengthOf(group) } };
  return { game, memory };
}

describe('bootstrap_1 assault reinforcements', () => {
  for (const version of BOOTSTRAP_VERSIONS) for (const race of ['grove', 'ember'] as const) {
    it(`${version}/${race} sends distant artillery toward the live army without counting it as arrived`, () => {
      const { game, memory } = attack(race, 650);
      const first = snapshotGame(game);
      const members = first.units.filter(unit => memory.v6!.general!.group!.includes(unit.id));
      const center = { x: members.reduce((sum, unit) => sum + unit.x / members.length, 0),
        y: members.reduce((sum, unit) => sum + unit.y / members.length, 0) };
      const initial = Math.hypot(650 - center.x, 1300 - center.y);
      for (let tick = 0; tick < 150; tick++) {
        if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams }));
        if (tick === 0) {
          const gun = game.units.find(unit => unit.id === 'late-gun')!;
          expect(gun.order.type).toBe('attackMove');
          const destination = gun.order as { x: number; y: number };
          expect(Math.hypot(destination.x - center.x, destination.y - center.y)).toBeLessThan(700);
        }
        expect(memory.v6!.general!.mode).toBe('attack');
        expect(memory.v6!.general!.group).not.toContain('late-gun');
        stepGame(game);
      }
      const gun = game.units.find(unit => unit.id === 'late-gun')!;
      expect(Math.hypot(gun.x - center.x, gun.y - center.y)).toBeLessThan(initial - 200);
      expect(gun.hp).toBe(gun.maxHp);
      expect(game.match.stats.goldSpent.us).toBe(0);
    });
  }

  it.each(['grove', 'ember'] as const)('joins %s artillery already within the army’s real arrival radius', race => {
    const { game, memory } = attack(race, 2100);
    issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version: 'v9_knight', memory, policyMode: 'combat' }, { teams: game.teams }));
    expect(memory.v6!.general!.group).toContain('late-gun');
    expect(game.units.find(unit => unit.id === 'late-gun')!.order.type).toBe('attackMove');
    stepGame(game);
  });
});
