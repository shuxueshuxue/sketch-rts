import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';

describe('bootstrap_1 shared medical recovery', () => {
  it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).map(race => ({ version, race }))))(
    '$version/$race keeps its healer with critical permanent troops, then returns it to the army', ({ version, race }) => {
      const body = race === 'grove' ? 'footman' : 'emberRavager';
      const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
      let scene = sketchScene('shared-healer-command').map('openClaims').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 0 })
        .townHall('us', 500, 500).townHall('foe', 3500, 3500)
        .unit('us', healer, 1300, 1000, { id: 'healer' })
        .unit('us', body, 600, 1800, { id: 'patient', hp: 8 });
      for (let index = 0; index < 4; index++) scene = scene.unit('us', body, 2300, 900 + index * 50, { id: `front-${index}` });
      const game = scene.build().createGame(), memory = createAiPolicyMemory();
      memory.v6 = { general: { mode: 'attack', target: { x: 3500, y: 3500 },
        group: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), groupStart: 6 } };
      let assigned = false, released = false;
      for (let tick = 0; tick < 900; tick++) {
        if (tick % 15 === 0) {
          const patient = game.units.find(unit => unit.id === 'patient')!;
          const entries = planAiOwnerCommandEntries(snapshotGame(game),
            { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
          const medical = entries.some(entry => entry.scriptId === 'medicalRecovery');
          if (patient.hp < patient.maxHp * V7_WOUNDED_SHARE) {
            assigned ||= medical;
            expect(entries.some(entry => entry.scriptId === 'v6General' && 'unitIds' in entry.command
              && entry.command.unitIds.includes('patient'))).toBe(false);
          } else if (assigned && !medical) released = true;
          issueCommandFrame(game, entries);
        }
        stepGame(game);
      }
      const patient = game.units.find(unit => unit.id === 'patient')!;
      expect(assigned).toBe(true);
      expect(patient.hp).toBeGreaterThanOrEqual(patient.maxHp * V7_WOUNDED_SHARE);
      expect(released).toBe(true);
      expect(game.units.some(unit => unit.id === 'healer')).toBe(true);
      expect(game.match.stats.goldSpent.us).toBe(0);
    });

  it.each(['grove', 'ember'] as const)('%s keeps its second healer with the marching army while one patient returns', race => {
    const body = race === 'grove' ? 'footman' : 'emberRavager';
    const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
    let scene = sketchScene('one-patient-two-healers').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 0 })
      .townHall('us', 500, 500).townHall('foe', 3500, 3500)
      .unit('us', healer, 1300, 1000, { id: 'doctor' })
      .unit('us', healer, 1300, 900, { id: 'support' })
      .unit('us', body, 600, 1800, { id: 'patient', hp: 8 });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', body, 1750, 900 + index * 50, { id: `front-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    memory.v6 = { general: { mode: 'attack', target: { x: 3500, y: 3500 },
      group: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), groupStart: 7 } };
    for (let tick = 0; tick < 900; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_knight', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
      if (tick === 180) {
        const doctor = game.units.find(unit => unit.id === 'doctor')!, support = game.units.find(unit => unit.id === 'support')!;
        expect(Math.hypot(doctor.x - 1300, doctor.y - 1000)).toBeLessThan(50);
        expect(support.x).toBeGreaterThan(1500);
      }
    }
    const patient = game.units.find(unit => unit.id === 'patient')!;
    expect(patient.hp).toBeGreaterThanOrEqual(patient.maxHp * V7_WOUNDED_SHARE);
    expect(game.units.filter(unit => unit.kind === healer)).toHaveLength(2);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it.each(['grove', 'ember'] as const)('%s lets a critical healer heal itself before returning to its screen', race => {
    const healer = race === 'grove' ? 'priest' : 'emberAcolyte';
    const game = sketchScene('medical-self-heal').map('openClaims').replaceDefaults()
      .player('us', { race }).player('foe').playerState('us', { gold: 0 })
      .townHall('us', 500, 500).townHall('foe', 3500, 3500)
      .unit('us', healer, 1300, 1000, { id: 'doctor', hp: 8 }).build().createGame();
    const memory = createAiPolicyMemory();
    for (let tick = 0; tick < 30; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_knight', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    const doctor = game.units.find(unit => unit.id === 'doctor')!;
    expect(doctor.hp).toBeGreaterThanOrEqual(doctor.maxHp * V7_WOUNDED_SHARE);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
