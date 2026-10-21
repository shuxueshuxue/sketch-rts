import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import type { BootstrapAiVersion, GameSnapshot, PlayerId, TrainableUnitKind, UnitKind } from '../../shared/types';
import type { DecisionFacts } from './decision';
import type { ConditionalAssemblyProduction } from './force-assembly-forecast';
import type { Arrival, Target } from './types';
import { landIdAt } from './regions';
import raw from './data/assembly-supply-model.json';
import validation from './data/assembly-supply-validation.json';

export type HistoricalAssemblyMember = Readonly<{ evidenceUnitId: string; kind: UnitKind; hp: number; maxHp: number;
  attackDamage: number; attackCooldown: number; attackRange: number; speed: number; level: number; force: number }>;
type StockPoint = readonly [offsetTicks: number, force: number, memberProfileIndices: readonly number[]];
type SampleProducer = Readonly<{ kind: string; sourceBuildingId: string; startsAfterPaidTicks: number;
  paidJobIdsExcluded: readonly string[]; fromOffsetTicks: number; throughOffsetTicks: number; points: readonly StockPoint[] }>;
type Sample = Readonly<{ id: string; mapEvidence: string; fromTick: number; producers: readonly SampleProducer[] }>;
type Cell = Readonly<{ priority: number; features: Readonly<Record<string, string>>; mapCount: number; sampleIds: readonly string[] }>;
type Table = Readonly<{ calibrationId: string; payloadSha256: string; sampleIntervalTicks: number;
  phaseBoundaries: readonly number[]; featurePriority: readonly (readonly string[])[];
  cells: readonly Cell[]; samples: readonly Sample[]; memberProfiles: readonly HistoricalAssemblyMember[] }>;
// Generated lossless tuples are checked against every source point by the
// packer. JSON imports infer arrays rather than their declared tuple schema.
const table = raw as unknown as Table;
const samples = new Map(table.samples.map(sample => [sample.id, sample]));
export const ASSEMBLY_SUPPLY_CALIBRATION_ID = table.calibrationId;
export type AssemblyProducerRoute = Readonly<{ buildingId: string; unitKind: TrainableUnitKind; arrival: DecisionFacts<Arrival> | null }>;
export type AssemblySupplyAlignment = Readonly<{
  scenarioId: string; buildingId: string; postId: string; sourceBuildingId: string; sourceFromTick: number;
  sourcePaidTicks: number; currentPaidTicks: number; excludedSourcePaidJobIds: readonly string[];
  supportFromTick: number; supportThroughTick: number; routeTicks: number;
  points: readonly Readonly<{ tick: number; force: number; members: readonly HistoricalAssemblyMember[] }>[];
}>;
type Missing = Readonly<{ code: string; factIds: readonly string[] }>;
export type CalibratedAssemblySupply = Readonly<{
  status: 'known' | 'unknown'; model: ConditionalAssemblyProduction | null;
  calibrationId: string; featureCell: Readonly<Record<string, string>> | null;
  alignments: readonly AssemblySupplyAlignment[]; missing: readonly Missing[];
  limitations: readonly Readonly<{ code: string; values: Readonly<Record<string, number | string>> }>[];
}>;
/** Global empirical selection only. No map/owner feature, navigation, queue
 * mutation or independent producer probability. Resource exclusions belong to
 * the later forecast, after this full-context cell has been selected. */
export function calibratedAssemblySupply(input: Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; version: BootstrapAiVersion;
  posts: readonly Readonly<{ id: string; target: Target }>[]; producerRoutes: readonly AssemblyProducerRoute[];
}>): CalibratedAssemblySupply {
  const { snapshot, owner } = input, now = snapshot.tick;
  const limitations = [{ code: 'assembly-calibration-observed-pool-not-post', values: { sampleIntervalTicks: table.sampleIntervalTicks } },
    { code: 'assembly-calibration-real-anchor-timing-bias', values: { observedAnchors: 30, evaluableAnchors: 20,
      biasSeconds: -20.92, timeMaeSeconds: 29.55, scope: 'new-supply-only' } }];
  const base = { calibrationId: table.calibrationId, featureCell: null, alignments: [], missing: [], limitations };
  const unknown = (code: string, factIds: readonly string[]): CalibratedAssemblySupply => ({ ...base,
    status: 'unknown', model: null, missing: [{ code, factIds }] });
  const producers = snapshot.buildings.filter(building => building.owner === owner && building.hp > 0 && building.complete
    && BUILDING_DEFS[building.kind].trains.some(kind => kind !== 'worker' && unitMover(kind) === 'land' && UNIT_DEFS[kind].attackDamage > 0))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!producers.length) return { ...base, status: 'known', model: null };
  const counts = new Map<string, number>();
  for (const producer of producers) counts.set(producer.kind, (counts.get(producer.kind) ?? 0) + 1);
  if ([...counts.values()].some(count => count > 1)) return unknown('assembly-supply-producer-mapping-unknown', producers.map(producer => producer.id));
  const signature = [...counts].sort(([a], [b]) => a < b ? -1 : 1).map(([kind, count]) => `${kind}:${count}`).join(',');
  const phase = now < table.phaseBoundaries[1]! ? 'early' : now < table.phaseBoundaries[2]! ? 'middle' : 'late';
  const features: Record<string, string> = { version: input.version, race: snapshot.players[owner]?.race ?? '', phase, producerSignature: signature };
  const cell = [...table.cells].sort((a, b) => a.priority - b.priority).find(candidate => candidate.mapCount >= 2
    && Object.entries(candidate.features).every(([key, value]) => features[key] === value));
  if (!cell) return unknown('assembly-supply-calibration-cell-unknown', producers.map(producer => producer.id));
  const missing: Missing[] = [], alignments: AssemblySupplyAlignment[] = [];
  const scenarios = cell.sampleIds.map(id => {
    const sample = samples.get(id)!;
    const columns = producers.flatMap(producer => {
      const source = sample.producers.find(column => column.kind === producer.kind)!;
      const landId = landIdAt(snapshot.map, producer);
      const post = input.posts.find(post => post.target.landId === landId);
      if (!post) { missing.push({ code: 'assembly-producer-post-unknown', factIds: [producer.id] }); return []; }
      const kinds = [...new Set(source.points.flatMap(point => point[2].map(index => table.memberProfiles[index]!.kind)))].sort();
      let routeTicks = 0;
      for (const kind of kinds) {
        const route = input.producerRoutes.find(route => route.buildingId === producer.id && route.unitKind === kind)?.arrival;
        if (!route || route.status === 'unknown') {
          missing.push({ code: 'assembly-conditional-recruit-arrival-unknown', factIds: [producer.id, kind, post.id] }); return [];
        }
        if (route.status !== 'reachable' || route.crossings.length) {
          missing.push({ code: 'assembly-conditional-post-route-unreachable', factIds: [producer.id, kind, post.id] }); return [];
        }
        routeTicks = Math.max(routeTicks, route.ticks);
      }
      const currentPaidTicks = producer.queue.reduce((sum, job) => sum + Math.max(1, Math.ceil(job.remaining)), 0);
      // Compare residual supply after each world's already-paid pipeline. A
      // conservative slowest-kind post walk is added once; neither clock is
      // disguised as a measured post ETA or a new paid job.
      const startsAtTick = now + currentPaidTicks + routeTicks;
      const points = source.points.filter(point => point[0] >= source.startsAfterPaidTicks)
        .map(point => ({ tick: startsAtTick + point[0] - source.startsAfterPaidTicks, force: point[1],
          members: point[2].map(index => table.memberProfiles[index]!) }));
      const throughTick = startsAtTick + Math.max(0, source.throughOffsetTicks - source.startsAfterPaidTicks);
      alignments.push({ scenarioId: id, buildingId: producer.id, postId: post.id, sourceBuildingId: source.sourceBuildingId,
        sourceFromTick: sample.fromTick, sourcePaidTicks: source.startsAfterPaidTicks, currentPaidTicks,
        excludedSourcePaidJobIds: source.paidJobIdsExcluded, supportFromTick: startsAtTick, supportThroughTick: throughTick,
        routeTicks, points });
      return [{ kind: 'stock-curve' as const, buildingId: producer.id, postId: post.id, startsAtTick, throughTick,
        points: points.map(point => ({ tick: point.tick, force: point.force })) }];
    });
    return { id, probability: 1 / cell.sampleIds.length, producers: columns };
  });
  const uniqueMissing = [...new Map(missing.map(fact => [JSON.stringify(fact), fact])).values()];
  const error = validation.fixedLomo['2400']['1'].conditionalTimeIdentifiedOnly;
  return { status: uniqueMissing.length ? 'unknown' : 'known', calibrationId: table.calibrationId, featureCell: cell.features,
    alignments, missing: uniqueMissing, limitations, model: { source: 'conditional-incumbent-production', model: 'joint-hurdle',
      forceBasis: 'combatRating', calibrationId: table.calibrationId, phase, scenarios,
      timeMaeTicks: error.maeTicks, timeP90ErrorTicks: error.p90AbsoluteTicks, sampleCount: cell.sampleIds.length } };
}
