import { describe, expect, it } from 'vitest';
import { createGame, stepGame, strikeUnit } from '../shared/sim';
import type { ObservedSource } from '../shared/sim/observation';
import { AiDeathLedger } from './death-ledger';
import { classifyAiDeath, classifyAiDeathV1 } from './death-ledger-classification';
import { inferAiDeathEngagement } from './death-ledger-engagement';
import { summarizeAiDeaths } from './death-ledger-summary';

function casualty() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; delete game.map.terrain; game.scriptedVictory = true;
  const unit = game.spawnUnit('player', 'footman', 500, 500), enemy = game.spawnUnit('enemy', 'archer', 600, 500);
  const ledger = new AiDeathLedger(game, { owners: ['player'] });
  strikeUnit(game, enemy, unit, 99999, 'spell'); stepGame(game);
  const record = ledger.records()[0]!; ledger.dispose();
  const identities = new Map<string, Pick<ObservedSource, 'kind' | 'owner' | 'entityType'>>([[enemy.id, { ...enemy, entityType: 'unit' }]]);
  return { record, identities, teams: game.teams, enemy };
}

describe('death classification v2', () => {
  it('treats failed withdrawal in an observed engagement as normal loss, retaining v1 intact', () => {
    const { record } = casualty(); record.context.retreating = true; record.context.treatment = true;
    const v1 = classifyAiDeathV1(record), classification = classifyAiDeath(record, record.classification.engagement, v1);
    expect(v1.disposition).toBe('abnormal');
    expect(classification).toMatchObject({ disposition: 'normal', primary: 'combat-loss', diagnosticVersion: 2, v1 });
    expect(classification.tags).toEqual([...v1.tags, 'retreat-failed']);
  });

  it('separates each structural combat diagnosis into suspicious, regardless of retreat or local disadvantage', () => {
    for (const label of ['recent-reassignment', 'out-of-bounds', 'post-worn-abandonment'] as const) {
      const { record } = casualty(); record.context.retreating = true; record.context.balance.ratio = .1;
      if (label === 'recent-reassignment') record.context.switches = [{ tick: record.tick, from: 'a', to: 'b', attribution: 'inferred' }];
      if (label === 'out-of-bounds') record.context.outsidePerimeter = true;
      if (label === 'post-worn-abandonment') record.context.wornRetreatTick = record.tick;
      expect(classifyAiDeath(record, record.classification.engagement)).toMatchObject({ disposition: 'suspicious', primary: label });
    }
  });

  it('does not turn enemy towers, allies or an unplanned neutral fight into nearby enemy combat units', () => {
    const { record, identities, teams, enemy } = casualty();
    for (const identity of [{ ...enemy, entityType: 'building' as const }, { ...enemy, entityType: 'unit' as const, owner: 'player' },
      { ...enemy, entityType: 'unit' as const, owner: 'neutral' }]) {
      identities.set(enemy.id, identity);
      const engagement = inferAiDeathEngagement(record, { identities, teams, dealtDamage: null, provenance: 'reclassified-native-records' });
      expect(engagement.status).toBe('outside-combat');
    }
  });

  it('requires observed exchanges, preserves missing outgoing evidence and distinguishes unknown identities', () => {
    const { record, identities, teams } = casualty(); record.damageWindow.sources = [];
    const infer = (dealtDamage: number | null) => inferAiDeathEngagement(record, { identities, teams, dealtDamage, provenance: 'reclassified-native-records' });
    expect(infer(12).status).toBe('engaged');
    expect(infer(0).status).toBe('outside-combat');
    expect(infer(null).status).toBe('unknown');
    identities.clear(); expect(infer(12).status).toBe('unknown');
    expect(classifyAiDeath(record, infer(null)).disposition).toBe('unattributed');
  });

  it('keeps outside-combat task failures abnormal and intentional neutral clearing distinct', () => {
    const { record, identities, teams, enemy } = casualty();
    const neutral = { ...enemy, owner: 'neutral', entityType: 'unit' as const };
    identities.set(enemy.id, neutral); record.killer = { ...record.killer!, owner: 'neutral' };
    for (const hit of record.damageWindow.sources) hit.source = { ...hit.source, owner: 'neutral' };
    const infer = () => inferAiDeathEngagement(record, { identities, teams, dealtDamage: null, provenance: 'reclassified-native-records' });
    expect(classifyAiDeath(record, infer())).toMatchObject({ disposition: 'abnormal', primary: 'neutral-outside-clearing' });
    record.assignment.task = { id: 'clear', kind: 'clear', targetId: 'camp', stage: null, source: 'test', attribution: 'inferred',
      methodId: null, utility: null, combat: true, clearing: true, perimeter: null };
    expect(classifyAiDeath(record, infer()).disposition).toBe('normal');
  });

  it('does not count unrelated neutral wounds as an exchange with nearby player opponents', () => {
    const { record, identities, teams } = casualty();
    record.killer = { ...record.killer!, owner: 'neutral' };
    for (const hit of record.damageWindow.sources) hit.source = { ...hit.source, owner: 'neutral' };
    const infer = (dealtDamage: number | null) => inferAiDeathEngagement(record, { identities, teams, dealtDamage, provenance: 'reclassified-native-records' });
    expect(infer(null)).toMatchObject({ status: 'unknown', receivedDamage: 0 });
    expect(classifyAiDeath(record, infer(null)).disposition).toBe('unattributed');
    expect(classifyAiDeath(record, infer(0))).toMatchObject({ disposition: 'abnormal', primary: 'neutral-outside-clearing' });
  });

  it('reclassifies the same facts without altering any original observation or v1 label', () => {
    const { record, identities, teams } = casualty(), before = structuredClone(record);
    const engagement = inferAiDeathEngagement(record, { identities, teams, dealtDamage: null, provenance: 'reclassified-native-records' });
    const result = classifyAiDeath(record, engagement, record.classification.v1);
    expect(record).toEqual(before); expect(result.v1).toEqual(before.classification.v1);
    expect(result.tags).toEqual(expect.arrayContaining(before.classification.v1.tags));
    const rows = [{ ...record, classification: result }], summary = summarizeAiDeaths(rows);
    expect(['normal', 'suspicious', 'abnormal', 'unattributed', 'lifecycle'].reduce((sum, key) =>
      sum + summary[key as 'normal'].count, 0)).toBe(summary.events);
    expect(summary.normal.count).toBe(1);
  });
});
