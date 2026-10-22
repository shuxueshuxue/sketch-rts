import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import { CAMP_FEATURE_NAMES, CAMP_ENCOUNTER_FEATURE_NAMES, campEncounterFeatureVector, campFeatureVector, campModelMember, campWalkableFraction } from './goal-camp-features';

describe('native camp model covariates', () => {
  it('keeps actual wounded bodies on both sides and separates native-zero workers from their actual DPS', () => {
    const snapshot = snapshotGame(sketchScene('camp-model-actual-bodies').map('bareDuel').replaceDefaults()
      .player('us').unit('us', 'footman', 1000, 1000, { id: 'fighter', hp: 40 })
      .worker('us', 1020, 1020, { id: 'worker' })
      .unit('neutral', 'ogreWarrior', 1400, 1000, { id: 'guard', hp: 120 }).build().createGame());
    const before = JSON.stringify(snapshot), body = (id: string) => snapshot.units.find(u => u.id === id)!;
    const allies = ['fighter', 'worker'].map(id => campModelMember(snapshot, body(id)));
    const enemies = [campModelMember(snapshot, body('guard'))];
    expect(allies[1]!.nativeCombatRating).toBe(0);
    expect(allies[1]!.nativeCapability.dps).toBeGreaterThan(0);
    const input = { allies, enemies, campWalkableFraction: 1, stagingWalkableFraction: 1, consumable: 'none' as const };
    const features = withNavigationAudit(event => { if (event.phase === 'strategy-planning') throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => campFeatureVector(input)));
    expect(features).toHaveLength(CAMP_FEATURE_NAMES.length);
    const value = (name: typeof CAMP_FEATURE_NAMES[number], vector = features) => vector[CAMP_FEATURE_NAMES.indexOf(name)]!;
    expect(value('workerCount')).toBe(1); expect(value('minimumOwnHpFraction')).toBeCloseTo(40 / body('fighter').maxHp);
    expect(value('campHpFraction')).toBeCloseTo(120 / body('guard').maxHp);
    expect(value('useHealingScroll')).toBe(0);
    const noWorker = campFeatureVector({ ...input, allies: allies.slice(0, 1) });
    expect(value('logDpsRatio')).toBeGreaterThan(value('logDpsRatio', noWorker));
    const hurtCamp = campFeatureVector({ ...input, enemies: [{ ...enemies[0]!, body: { ...body('guard'), hp: 60 } }] });
    expect(value('logHpRatio', hurtCamp)).toBeGreaterThan(value('logHpRatio'));
    expect(value('logCampForceRatio', hurtCamp)).toBeGreaterThan(value('logCampForceRatio'));
    expect(campFeatureVector({ ...input, consumable: 'healingScroll' })[23]).toBe(1);
    expect(campFeatureVector({ ...input, consumable: 'guardianScroll' })[24]).toBe(1);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('reads finite local terrain without creating a route or assigning an invented choke category', () => {
    const snapshot = snapshotGame(sketchScene('camp-model-terrain').map('bareDuel').build().createGame());
    const fraction = withNavigationAudit(event => { if (event.phase === 'strategy-planning') throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => campWalkableFraction(snapshot, { x: 1000, y: 1000 })));
    expect(fraction).toBeGreaterThanOrEqual(0); expect(fraction).toBeLessThanOrEqual(1);
  });

  it('distinguishes a trailing group using only pre-contact poses under the navigation guard', () => {
    const snapshot = snapshotGame(sketchScene('camp-model-arrival-dispersion').map('bareDuel').replaceDefaults().player('us')
      .unit('us', 'footman', 1000, 1000, { id: 'first' }).unit('us', 'footman', 1000, 1000, { id: 'last' })
      .unit('neutral', 'ogreWarrior', 1400, 1000, { id: 'guard' }).build().createGame());
    const ours = snapshot.units.filter(u => u.owner === 'us'), enemies = snapshot.units.filter(u => u.owner === 'neutral').map(u => campModelMember(snapshot, u));
    const vector = (back: number) => withNavigationAudit(event => { if (event.phase === 'strategy-planning') throw Error(event.operation); },
      () => withNavigationPhase('strategy-planning', () => campEncounterFeatureVector(snapshot, {
        allies: ours.map((u, i) => campModelMember(snapshot, { ...u, x: u.x - (i ? back : 0) })), enemies,
        consumable: 'none', campWalkableFraction: 1, stagingWalkableFraction: 1,
      })));
    const together = vector(0), trailing = vector(600);
    const at = (name: typeof CAMP_ENCOUNTER_FEATURE_NAMES[number]) => CAMP_ENCOUNTER_FEATURE_NAMES.indexOf(name);
    expect(together[at('logGeometricArrivalSpreadTicks')]).toBe(0);
    expect(together[at('firstWaveRatingShare15Ticks')]).toBe(1);
    expect(trailing[at('logGeometricArrivalSpreadTicks')]).toBeGreaterThan(0);
    expect(trailing[at('firstWaveRatingShare15Ticks')]).toBe(.5);
    expect(trailing[at('firstWaveRatingShare30Ticks')]).toBe(.5);
    expect(trailing).toHaveLength(CAMP_ENCOUNTER_FEATURE_NAMES.length);
    expect(snapshot.units.find(u => u.id === 'last')!.x).toBe(1000);
  });
});
