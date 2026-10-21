import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { neutralCamps } from '../policy/v7/creep';
import { calibratedAlphaGoalCampBattleModel, type GoalCampBattleModel } from './goal-camp-quotation';
import { createDefaultGoalCampBattleModel, createGoalCampModelUsage, createSupportedGoalCampBattleModel,
  GOAL_CAMP_DEFAULT_PAYLOAD_SHA256 } from './goal-camp-default-model';
import { landIdAt, regionIndex } from './regions';
import { evaluateSituation } from './situation';
const quote = (modelId: string, loss: number): ReturnType<GoalCampBattleModel> => ({ state: 'met', factIds: ['model-input'],
  value: { modelId, expectedLossGold: loss, successProbability: .9, battleTicks: 30, requiredForce: 2,
    lossDistribution: null, factIds: ['model-input'] } });
const pending = (code: string): ReturnType<GoalCampBattleModel> => ({ state: 'pending', requestIds: ['unpublished'],
  reason: { code, factIds: ['unpublished'], values: {} } });
function fixture() {
  const snapshot = snapshotGame(sketchScene('bounded-default-camp-model').map('bareDuel').replaceDefaults()
    .player('us').unit('us', 'footman', 1000, 1000, { id: 'fighter' })
    .unit('neutral', 'murlocPeon', 1300, 1000, { id: 'guard' }).build().createGame());
  regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory()), camp = neutralCamps(snapshot)[0]!;
  return { snapshot, situation, target: { landId: landIdAt(snapshot.map, camp.center)!, point: camp.center },
    unitIds: ['fighter'], battleStartTicks: 0 };
}
describe('supported empirical default with explicit alpha fallback', () => {
  it('uses the empirical quote unchanged inside support and counts each selection locally', () => {
    const input = fixture(), selected = createGoalCampModelUsage(), alpha = vi.fn(() => quote('alpha', 40)), expected = quote('empirical', 2);
    const model = createSupportedGoalCampBattleModel(() => expected, alpha, selected.observe);
    expect(model(input)).toBe(expected); expect(alpha).not.toHaveBeenCalled();
    expect(selected.counts).toEqual({ quotes: 1, empirical: 1, alpha: 0, outsideSupport: 0, pending: 0 });
  });
  it('uses alpha only on a known support boundary, preserving price/P and the boundary in trace facts', () => {
    const input = fixture(), selected = createGoalCampModelUsage();
    for (const code of ['camp-model-composition-outside-support', 'camp-model-feature-outside-support']) {
      const actual = createSupportedGoalCampBattleModel(() => pending(code), () => quote('alpha', 17), selected.observe)(input);
      expect(actual).toMatchObject({ state: 'met', value: { modelId: 'alpha', expectedLossGold: 17, successProbability: .9 } });
      if (actual.state !== 'met') throw Error('alpha should be known');
      expect(actual.factIds).toContain(`camp-model:outside-support:${code}`);
    }
    expect(selected.counts).toEqual({ quotes: 2, empirical: 0, alpha: 2, outsideSupport: 2, pending: 0 });
  });
  it('retains unknown facts or damaged model labels as pending, including alpha unknown after an outside-support result', () => {
    const input = fixture(), alpha = vi.fn(() => quote('alpha', 17)), selected = createGoalCampModelUsage();
    for (const code of ['combat-enemy-unload-binding-pending', 'camp-model-leaf-label-unavailable', 'camp-model-feature-schema-unavailable'])
      expect(createSupportedGoalCampBattleModel(() => pending(code), alpha, selected.observe)(input))
        .toMatchObject({ state: 'pending', reason: { code } });
    expect(alpha).not.toHaveBeenCalled();
    expect(createSupportedGoalCampBattleModel(() => pending('camp-model-feature-outside-support'),
      () => pending('opponent-arrival-unpublished'), selected.observe)(input))
      .toMatchObject({ state: 'pending', reason: { code: 'opponent-arrival-unpublished' } });
    expect(selected.counts).toEqual({ quotes: 4, empirical: 0, alpha: 0, outsideSupport: 1, pending: 4 });
  });
  it('quotes the native four-footmen/two-murloc controlled start inside support without alpha', () => {
    const record = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-camp-four-footmen-native.json.gz', import.meta.url))).toString());
    const { snapshot, owner, unitIds, battleStartTicks } = record;
    regionIndex(snapshot.map);
    const camp = neutralCamps(snapshot)[0]!, input = { snapshot, situation: evaluateSituation(snapshot, owner, createAiPolicyMemory()),
      target: { landId: landIdAt(snapshot.map, camp.center)!, point: camp.center }, unitIds, battleStartTicks };
    const usage = createGoalCampModelUsage(), before = JSON.stringify(snapshot);
    const result = withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => createDefaultGoalCampBattleModel(usage.observe)(input)));
    expect(result.state).toBe('met');
    expect(usage.counts).toEqual({ quotes: 1, empirical: 1, alpha: 0, outsideSupport: 0, pending: 0 });
    expect(result.state === 'met' && result.value.lossDistribution).not.toBeNull();
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(record.rawOutcome).toMatchObject({ win: true, lossGold: 0 });
  });

  it('reads the frozen lossless model in browser form and keeps real unsupported quotation identical to native alpha', () => {
    const carrier = JSON.parse(readFileSync(new URL('./data/goal-camp-model.gzip.json', import.meta.url), 'utf8'));
    const payload = gunzipSync(Buffer.from(carrier.gzipBase64, 'base64'));
    expect(createHash('sha256').update(payload).digest('hex')).toBe(GOAL_CAMP_DEFAULT_PAYLOAD_SHA256);
    const table = JSON.parse(payload.toString()), input = fixture(), selected = createGoalCampModelUsage(), before = JSON.stringify(input.snapshot);
    expect(table.format).toBe('camp-gold-v2'); expect(table.trainingRows).toBeGreaterThan(21000);
    // One footman against one guard is not a signature in the calibrated data.
    const result = withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => createDefaultGoalCampBattleModel(selected.observe)(input)));
    const alpha = calibratedAlphaGoalCampBattleModel(input);
    expect(result.state).toBe(alpha.state);
    if (result.state !== 'met' || alpha.state !== 'met') throw Error('expected known alpha');
    const { factIds: _actualFacts, ...actualValue } = result.value, { factIds: _alphaFacts, ...alphaValue } = alpha.value;
    expect(actualValue).toEqual(alphaValue);
    expect(result.factIds).toEqual(expect.arrayContaining([...alpha.factIds]));
    expect(selected.counts.outsideSupport).toBe(1); expect(JSON.stringify(input.snapshot)).toBe(before);
  });
});
