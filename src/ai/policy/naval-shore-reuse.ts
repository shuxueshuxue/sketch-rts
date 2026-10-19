import { sameGround, walkingDistance } from '../../shared/terrain';
import type { Building, GameMap, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext } from './types';
import type { Point } from './spatial';

type Answer = { snapshot: GameSnapshot; owner: PlayerId; teams: AiPolicyContext['teams'];
  water: Point; despiteGuns: boolean; result: Point | undefined };
let scope: { answers: Answer[]; roads: WeakMap<GameMap, WeakMap<Point, WeakMap<Building, number | undefined>>> } | undefined;

/** Immutable shore geometry lives for one synchronous owner think, including its budget views. */
export function withNavalShoreReuse<T>(run: () => T): T {
  const previous = scope;
  scope = { answers: [], roads: new WeakMap() };
  try { return run(); }
  finally { scope = previous; }
}

export function shoreTravelDistance(map: GameMap, shore: Point, hall: Building) {
  if (!scope) return walkingDistance(map, shore, hall);
  let shores = scope.roads.get(map);
  if (!shores) scope.roads.set(map, shores = new WeakMap());
  let halls = shores.get(shore);
  if (!halls) shores.set(shore, halls = new WeakMap());
  if (!halls.has(hall)) halls.set(hall, walkingDistance(map, shore, hall));
  return halls.get(hall);
}

export function reuseNavalShore(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  water: Point, despiteGuns: boolean, find: () => Point | undefined) {
  if (!scope) return find();
  const answer = scope.answers.find(answer => answer.owner === owner && answer.teams === options.teams
    && answer.snapshot.map === snapshot.map && answer.snapshot.units === snapshot.units
    && answer.snapshot.buildings === snapshot.buildings && answer.snapshot.obstacles === snapshot.obstacles
    && answer.despiteGuns === despiteGuns && sameGround(snapshot.map, answer.water, water, 'sea'));
  if (answer) return answer.result;
  const result = find();
  scope.answers.push({ snapshot, owner, teams: options.teams, water, despiteGuns, result });
  return result;
}
