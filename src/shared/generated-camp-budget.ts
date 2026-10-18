import { CAMP_TEMPLATES, campMembers, campRoster, type CampTier } from './camps';
import { detCos, detSin } from './det-math';
import { coordinateRandom, seedHash } from './environment/noise';
import { ecologicalHabitat } from './environment/ecology';
import type { GeneratedMap } from './generated-map';
import { createUnit } from './map';
import { cellIndexAt, isWalkable, walkingDistance } from './terrain';

type Point = { x: number; y: number };
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const CAMPS_PER_PLAYER = 4;
const OPENING_CAMPS = 2;
// Thirty seconds for a 60-unit/second opening army. Checking the terrain's
// walking distance excludes camps across cliffs, rivers and other islands.
const OPENING_REACH = 1800;

/** All terrain generators share the same seat budget, including the dedicated
 * island and estuary generators. Keep their existing guards and prizes, then
 * place complete symmetric groups on reachable, already open ground. */
export function ensureCampBudget(map: GeneratedMap, seed: string): boolean {
  const homes = Object.values(map.starts).map(start => ({ x: start.baseX, y: start.baseY }));
  const middle = { x: map.size / 2, y: map.size / 2 };
  const hash = seedHash(`${seed}:camp-budget`);
  const used = new Set<string>();
  for (const camp of map.camps) {
    const kinds = map.units.filter(unit => unit.owner === 'neutral' && gap(unit, camp) < 100).map(unit => unit.kind).sort().join();
    const template = CAMP_TEMPLATES.find(template => template.tier === camp.tier && [...template.kinds].sort().join() === kinds);
    if (template) used.add(template.id);
  }
  // A ring's entire orbit is one draw; a sides layout has one mirrored pair
  // per lane. Infer the mirror from the physical seats, independent of teams.
  const span = (axis: 'x' | 'y') => Math.max(...homes.map(home => home[axis])) - Math.min(...homes.map(home => home[axis]));
  const mirrorX = span('x') > span('y');
  const mirror = (at: Point): Point => mirrorX ? { x: map.size - at.x, y: at.y } : { x: at.x, y: map.size - at.y };
  const disconnected = homes.some(home => walkingDistance(map, home, homes[0]!) === undefined);
  const firstAngle = Math.atan2(homes[0]!.y - middle.y, homes[0]!.x - middle.x);
  const turnOf = (home: Point) => (Math.atan2(home.y - middle.y, home.x - middle.x) - firstAngle + Math.PI * 2) % (Math.PI * 2);
  const ring = [...homes].sort((a, b) => turnOf(a) - turnOf(b));
  const groups = disconnected ? homes.map(home => [home]) : map.kind === 'ring' ? [ring] : homes.filter(home => (mirrorX ? home.x : home.y) < map.size / 2).map(home => [home, mirror(home)]);
  const rosters = new Map<string, ReturnType<typeof campRoster>['kinds']>();
  let serial = 0;

  for (const group of groups) {
    while (Math.min(...group.map(home => openingCount(home))) < OPENING_CAMPS) {
      if (!place(group, 'green', OPENING_REACH)) return false;
    }
  }
  // Round robin across home sectors instead of filling the first lane of a
  // large sides map. The floor is per seat, never per square kilometre.
  while (map.camps.length < CAMPS_PER_PLAYER * homes.length) {
    let added = false;
    for (const group of groups) {
      if (map.camps.length >= CAMPS_PER_PLAYER * homes.length) break;
      added = place(group, 'orange', OPENING_REACH * 2) || added;
    }
    if (!added) return false;
  }
  return true;

  function openingCount(home: Point) {
    return map.camps.filter(camp => camp.tier === 'green' && belongsNear(camp, home) && (walkingDistance(map, camp, home) ?? Infinity) <= OPENING_REACH).length;
  }

  // A nearby teammate's camp cannot satisfy both seats' opening allowance.
  // Small coordinate rounding in mirrored/rotated home copies is harmless.
  function belongsNear(camp: Point, home: Point) {
    return homes.every(other => gap(camp, home) <= gap(camp, other) + 2);
  }

  function copies(at: Point, group: Point[]) {
    if (group.length === 1) return [at];
    if (map.kind === 'sides') return [at, mirror(at)];
    const dx = at.x - middle.x, dy = at.y - middle.y;
    return group.map((_, index) => {
      const angle = index * Math.PI * 2 / homes.length;
      return { x: middle.x + dx * detCos(angle) - dy * detSin(angle), y: middle.y + dx * detSin(angle) + dy * detCos(angle) };
    });
  }

  function place(group: Point[], tier: CampTier, reach: number) {
    const home = group[0]!, inward = Math.atan2(middle.y - home.y, middle.x - home.x);
    // Scan a fixed polar lattice, nearest first. A seed rotates its spoke
    // order; all copies use that same draw and the same creep roster.
    const phase = coordinateRandom(hash, serial, 0, 0) * Math.PI * 2;
    const key = `${tier}:${tier === 'green' ? Math.min(...group.map(home => openingCount(home))) : serial}`;
    for (let radius = 560; radius <= reach; radius += 96) {
      for (let spoke = 0; spoke < 48; spoke++) {
        const angle = inward + phase + spoke * Math.PI * 2 / 48;
        const at = { x: home.x + detCos(angle) * radius, y: home.y + detSin(angle) * radius };
        const centers = copies(at, group);
        const habitat = ecologicalHabitat(map.terrain, at.x, at.y);
        const draw = campRoster(() => coordinateRandom(hash, serial, 0, 1), tier, habitat, new Set(used));
        const roster = rosters.get(key) ?? draw.kinds;
        const members = centers.map(center => campMembers(roster, center));
        if (!centers.every((center, i) => {
          if (center.x < 100 || center.y < 100 || center.x > map.size - 100 || center.y > map.size - 100) return false;
          if (homes.some(other => gap(center, other) < 520)) return false;
          if (tier === 'green' && !belongsNear(center, group[i]!)) return false;
          if (map.terrain.levels && map.terrain.levels[cellIndexAt(map.terrain, center.x, center.y)] !== '0') return false;
          if (map.resources.some(mine => gap(center, mine) < (mine.id.endsWith('-main') ? 580 : 520))) return false;
          if (map.camps.some(camp => gap(center, camp) < 480) || centers.some((other, j) => i !== j && gap(center, other) < 480)) return false;
          if ([...map.sites, ...map.mercenaryCamps, ...map.obstacles].some(site => gap(center, site) < 200)) return false;
          if (!isWalkable(map, center.x, center.y) || !members[i]!.every(member => isWalkable(map, member.x, member.y) && (walkingDistance(map, member, group[i]!) ?? Infinity) <= reach + 100)) return false;
          return (walkingDistance(map, center, group[i]!) ?? Infinity) <= reach;
        })) continue;
        centers.forEach((center, index) => {
          const campIndex = map.camps.length + 1;
          map.camps.push({ ...center, tier, habitat });
          map.units.push(...members[index]!.map((member, i) => createUnit(`creep-gen-${campIndex}-${i + 1}`, 'neutral', member.kind, member.x, member.y)));
          map.landmarks.push({ id: `budget-camp-${campIndex}`, kind: 'campMark', ...center, size: 200, rotation: 0.2 });
        });
        if (!rosters.has(key)) { rosters.set(key, roster); used.add(draw.templateId); }
        serial++;
        return true;
      }
    }
    return false;
  }
}
