import { readFileSync } from 'node:fs';
import { setBuildingBodies, moverDistanceField } from '../../../shared/terrain';
import { standingBodies } from '../../../shared/structure-bodies';
import type { GameSnapshot } from '../../../shared/types';
import type { AiPolicyMemory } from '../../memory';
import { buildStrategyPlanTrace } from '../plan';
import { evaluateSituation } from '../situation';
import { createArrivalQuery, crossingCandidateId } from '../arrivals';
import { createPlanningDistanceQuery } from '../distance-fields';
import { regionIndex, landIdAt } from '../regions';
import { observationMemory } from '../observation-memory';

type Input = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory;
  warm?: 'other-owner' | 'reverse'; start?: number; steps: number; dropHallId?: string; tiny?: boolean };
const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
const { snapshot, owner, memory } = input, initialTick = snapshot.tick;
if (input.tiny) {
  const fighter = structuredClone(snapshot.units.find(unit => unit.owner === owner && unit.kind === 'emberRavager')!);
  const boat = structuredClone(snapshot.units.find(unit => unit.owner === owner && unit.kind === 'transport')!);
  Object.assign(fighter, { id: 'crew', x: 75, y: 125, order: { type: 'idle' } }); delete fighter.deck; delete fighter.cabin;
  Object.assign(boat, { id: 'boat', x: 275, y: 125, order: { type: 'idle' } });
  snapshot.units = [fighter, boat]; snapshot.buildings = []; snapshot.resources = []; snapshot.obstacles = [];
  snapshot.shops = []; snapshot.mercenaryCamps = [];
  snapshot.map = { id: 'bareDuel', name: 'Crossing publication', width: 600, height: 300, landmarks: [],
    terrain: { cols: 12, rows: 6, cell: 50, cells: ('....~~~~....').repeat(6) } };
  memory.naval = { ferries: {} };
}
function tinyArrival(stateMemory: AiPolicyMemory, budget: number) {
  const state = observationMemory(snapshot, owner, stateMemory), fighter = snapshot.units[0]!;
  const target = { entityId: 'island', point: { x: 525, y: 125 }, landId: landIdAt(snapshot.map, { x: 525, y: 125 })! };
  const query = createArrivalQuery(snapshot, owner, stateMemory, createPlanningDistanceQuery(snapshot, budget, 'land', state), budget, regionIndex(snapshot.map), state);
  query.setCrossingShortlist([crossingCandidateId(snapshot, fighter, target)!]);
  return query.arrival(fighter, target);
}
setBuildingBodies(snapshot.map, standingBodies(snapshot));
if (input.warm) {
  if (input.tiny) tinyArrival(structuredClone(memory), Infinity);
  for (const other of Object.keys(snapshot.players).filter(other => other !== owner))
    evaluateSituation(snapshot, other, { jobs: [], unitClaims: {} });
  const seeded = structuredClone(memory);
  buildStrategyPlanTrace(snapshot, owner, { memory: seeded }, undefined, undefined, { healing: [] }, Infinity);
  if (input.warm === 'reverse') for (const mover of ['sea', 'land'] as const)
    for (const entry of [...seeded.strategy!.observation.fields[mover]].reverse()) moverDistanceField(snapshot.map, entry.goal, mover);
}
const rows = [], saved = [];
for (let index = input.start ?? 0; index < (input.start ?? 0) + input.steps; index++) {
  snapshot.tick = initialTick + index * 15;
  if (input.dropHallId && index >= 4) snapshot.buildings = snapshot.buildings.filter(building => building.id !== input.dropHallId);
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const trace = input.tiny ? tinyArrival(memory, 1) : buildStrategyPlanTrace(snapshot, owner, { memory }, undefined, undefined, { healing: [] });
  rows.push(JSON.stringify(trace)); saved.push(JSON.stringify(memory));
}
process.stdout.write(JSON.stringify({ rows, saved }));
