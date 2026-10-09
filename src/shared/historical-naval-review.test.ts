import { describe, expect, it } from 'vitest';
import { historicalNavalScenarios, historicalNavalSources, replayHistoricalCheckpoint, runHistoricalScenario } from '../../scripts/historical-naval-review';
import { SIM_TICKS_PER_SECOND } from './time';

describe('documented historical naval mechanisms through stepGame', () => {
  it.each(historicalNavalScenarios)('$id', scene => {
    const result = runHistoricalScenario(scene);
    expect(result.criteria.filter(check => !check.passed), JSON.stringify(result.criteria.filter(check => !check.passed))).toEqual([]);
    expect(result.quality.normalHp).toBe(true);
    expect(result.frames).toHaveLength(scene.duration + 1);
    expect(result.frames.map(frame => frame.second)).toEqual(Array.from({ length: scene.duration + 1 }, (_, i) => i));
    expect(result.checkpoints.at(-1)!.tick).toBe(scene.duration * SIM_TICKS_PER_SECOND / 2);
    expect(result.replay?.matched).toBe(true);
    for (const check of result.criteria.filter(check => check.basis === 'mechanism')) {
      expect(check.sources.length).toBeGreaterThan(0);
      expect(check.sources.every(id => result.sourceIds.includes(id))).toBe(true);
    }
  }, 120_000);

  it('continues a JSON save before a future weather command with the same final state', () => {
    const scene = historicalNavalScenarios.find(scene => scene.id === 'constitution-calm-chase')!;
    const result = runHistoricalScenario(scene, { seed: 'weather-replay-2', replay: false });
    const checkpoint = JSON.parse(JSON.stringify(result.checkpoints[0]!));
    expect(checkpoint.completedActions).toEqual([]);
    expect(replayHistoricalCheckpoint(scene, result.seed, checkpoint, scene.duration * SIM_TICKS_PER_SECOND)).toBe(result.checksum);
    expect(result.events.some(event => event.actionId === 'wind-restored')).toBe(true);
    expect(result.frames[19]!.wind!.speed).toBe(0);
    expect(result.frames[21]!.wind!.speed).toBe(80);
  });

  it('maps scenario evidence to the reviewed documents and keeps quantitative limits explicit', () => {
    const ids = new Set(historicalNavalSources.map(source => source.id));
    expect(historicalNavalScenarios).toHaveLength(7);
    for (const scene of historicalNavalScenarios) {
      expect(scene.sources.every(id => ids.has(id))).toBe(true);
      expect(scene.scope).toMatch(/ordinary-HP|normal-HP/);
      expect(scene.limits.length).toBeGreaterThan(0);
    }
    expect(historicalNavalSources.map(source => source.documentaryId)).toEqual(['S01', 'S04', 'S05', 'S06', 'S08', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16']);
  });
});
