import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapNaval } from './expedition-recovery';

const shipId = 'unit-p0-carrier-25442';
const saved = (tick: number) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/carrier-${tick}-actual-before-p0.json.gz`, import.meta.url))).toString());
const permanentCargo = (data: ReturnType<typeof saved>) => data.snapshot.units
  .filter((unit: any) => unit.deck?.shipId === shipId && unit.expiresTick === undefined).map((unit: any) => unit.id).join('|');
function firstActualWorld() {
  const data = saved(329130), memory = structuredClone(data.memories.p0), before = JSON.stringify(data.snapshot);
  const options = bootstrapPolicyContext(data.snapshot, 'p0', 'v9_summoner', { memory, teams: data.snapshot.teams });
  planBootstrapNaval(data.snapshot, 'p0', options);
  expect(JSON.stringify(data.snapshot)).toBe(before);
  return { data, memory };
}
it('rekeys only the existing ferry progress crew on the exact actual329130 world without counting its temporary passengers', () => {
  const { data, memory } = firstActualWorld();
  const progress = memory.naval!.ferries![shipId]!.progress!;
  expect(progress.crew).toBe(permanentCargo(data));
  expect(progress.tick).toBe(329130);
  expect(memory.naval!.ferries![shipId]!.crewIds).toContain('unit-p0-ashHexer-4268');
});
it('does not count the actual new spirit as progress on329145 with the candidate-derived preceding naval memory', () => {
  const { memory } = firstActualWorld(), data = saved(329145), before = JSON.stringify(data.snapshot);
  // The world is the true saved329145 world; this memory deliberately comes from the preceding candidate pure plan.
  const options = bootstrapPolicyContext(data.snapshot, 'p0', 'v9_summoner', { memory, teams: data.snapshot.teams });
  planBootstrapNaval(data.snapshot, 'p0', options);
  expect(JSON.stringify(data.snapshot)).toBe(before);
  const progress = memory.naval!.ferries![shipId]!.progress!;
  expect(progress.crew).toBe(permanentCargo(data));
  expect(progress.tick).toBe(329130);
});
