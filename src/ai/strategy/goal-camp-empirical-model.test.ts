import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { neutralCamps } from '../policy/v7/creep';
import { CAMP_ENCOUNTER_FEATURE_NAMES, campCompositionSignature, campEncounterFeatureVector, campModelMember, campWalkableFraction } from './goal-camp-features';
import { predictEmpiricalCamp, quoteEmpiricalCampChoices, type CampEmpiricalTable } from './goal-camp-empirical-model';
import { landIdAt, regionIndex } from './regions';
import { evaluateSituation } from './situation';

const leaf = { zeroProbability: .75, winProbability: .8, positiveLossGold: [[.5, 40], [.5, 200]] as const,
  battleTicks: 51.25, rows: 20, weight: 20 };
const table: CampEmpiricalTable = { format: 'camp-gold-v2', modelId: 'synthetic-reader-contract-only', features: CAMP_ENCOUNTER_FEATURE_NAMES,
  sourceSha: 'synthetic-not-fitted-model', trainingRows: 20, support: { sample: CAMP_ENCOUNTER_FEATURE_NAMES.map(() => [-1, 1]) }, tree: leaf };

describe('bounded empirical camp quotation contracts (not a fitted-model acceptance)', () => {
  it('separates probability of zero loss, conditional positive losses and victory without a margin', () => {
    const input = { signature: 'sample', features: CAMP_ENCOUNTER_FEATURE_NAMES.map(() => 0), capitalGold: 400, factIds: ['actual-group'] };
    const result = predictEmpiricalCamp(table, input);
    expect(result).toMatchObject({ state: 'met', value: { expectedLossGold: 30, successProbability: .8, battleTicks: 52,
      lossDistribution: { zeroProbability: .75, positive: [{ probability: .5, lossGold: 40 }, { probability: .5, lossGold: 200 }] } } });
    expect(predictEmpiricalCamp({ ...table, tree: { ...leaf, zeroProbability: 1, positiveLossGold: [] } }, input))
      .toMatchObject({ state: 'met', value: { expectedLossGold: 0, lossDistribution: { zeroProbability: 1, positive: [] } } });
    expect(predictEmpiricalCamp(table, { ...input, signature: 'unseen' }))
      .toMatchObject({ state: 'pending', reason: { code: 'camp-model-composition-outside-support' } });
    expect(predictEmpiricalCamp(table, { ...input, features: input.features.map((x, i) => i === 0 ? 2 : x) }))
      .toMatchObject({ state: 'pending', reason: { code: 'camp-model-feature-outside-support' } });
    expect(predictEmpiricalCamp({ ...table, tree: { ...leaf, zeroProbability: null } }, input))
      .toMatchObject({ state: 'pending', reason: { code: 'camp-model-leaf-label-unavailable' } });
  });

  it('quotes real none/use inventory alternatives separately, without an action/grant or invented worker income', () => {
    const snapshot = snapshotGame(sketchScene('camp-model-two-inventory-choices').map('bareDuel').replaceDefaults().player('us')
      .unit('us', 'footman', 1000, 1000, { id: 'fighter' }).worker('us', 1010, 1020, { id: 'worker' })
      .unit('neutral', 'murlocPeon', 1400, 1400, { id: 'guard' })
      .item('scroll', 'healingScroll', 1000, 1000, { carrierId: 'fighter' }).build().createGame());
    regionIndex(snapshot.map);
    const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
    const camp = neutralCamps(snapshot)[0]!, units = snapshot.units.filter(u => u.owner === 'us');
    const allies = units.map(u => campModelMember(snapshot, u)), enemies = camp.creeps.map(u => campModelMember(snapshot, u));
    const features = campEncounterFeatureVector(snapshot, { allies, enemies, consumable: 'none',
      campWalkableFraction: campWalkableFraction(snapshot, camp.center),
      stagingWalkableFraction: units.reduce((sum, unit) => sum + campWalkableFraction(snapshot, unit), 0) / units.length });
    const bounds = features.map((v, i) => i === 23 || i === 24 ? [0, 1] as const : [v - 1, v + 1] as const);
    const model: CampEmpiricalTable = { ...table, support: {
      [campCompositionSignature(allies, enemies, 'none')]: bounds,
      [campCompositionSignature(allies, enemies, 'healingScroll')]: bounds,
    }, tree: { feature: 23, threshold: .5, left: leaf, right: { ...leaf, zeroProbability: .9, winProbability: .95 } } };
    const input = { snapshot, situation, target: { landId: landIdAt(snapshot.map, camp.center)!, point: camp.center },
      unitIds: units.map(u => u.id), battleStartTicks: 0 };
    const before = JSON.stringify(snapshot);
    const choices = withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => quoteEmpiricalCampChoices(model, input,
        [{ kind: 'healingScroll', itemId: 'scroll', carrierId: 'fighter' }])));
    expect(choices.map(choice => choice.consumableValueGold)).toEqual([0, 100]);
    expect(choices.every(choice => choice.workerCount === 1 && choice.workerIncomeLossGold === null)).toBe(true);
    expect(choices[0]!.battle).toMatchObject({ state: 'met', value: { successProbability: .8 } });
    expect(choices[1]!.battle).toMatchObject({ state: 'met', value: { successProbability: .95 } });
    expect(choices.every(choice => !('demands' in choice) && !('executor' in choice))).toBe(true);
    expect(quoteEmpiricalCampChoices(model, input, [{ kind: 'healingScroll', itemId: 'scroll', carrierId: 'worker' }])[1]!.battle)
      .toMatchObject({ state: 'pending', reason: { code: 'camp-model-consumable-unavailable' } });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
