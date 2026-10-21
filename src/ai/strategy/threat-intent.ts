import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { strategyIsOpponent } from './ownership';
import { distance } from '../policy/spatial';
import { landIdAt } from './regions';
import type { Asset, SiteThreat } from './types';

type Site = Pick<Asset, 'id' | 'target'>;
type Intent = NonNullable<SiteThreat['attackers'][number]['intent']>;
const SITE_RANGE = 650;

/** Current orders assign an intrusion to one site. Geometric arrival facts are
 * unchanged: cancelling this order may still threaten any other reachable site. */
export function createThreatIntentQuery(snapshot: GameSnapshot, owner: PlayerId, sites: readonly Site[], teams = snapshot.teams) {
  const entities = new Map([...snapshot.buildings, ...snapshot.units].map(entity => [entity.id, entity]));
  const actual = new Map<string, Omit<Intent, 'kind'>>();
  const nearest = (point: { x: number; y: number }, reach = SITE_RANGE) => {
    const land = landIdAt(snapshot.map, point);
    return sites.filter(site => site.target.landId === land && distance(site.target.point, point) <= reach)
      .sort((a, b) => distance(a.target.point, point) - distance(b.target.point, point)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  };
  for (const unit of snapshot.units) {
    if (unit.hp <= 0 || !strategyIsOpponent(snapshot, owner, unit.owner, teams)) continue;
    const carrierId = unit.deck?.shipId ?? unit.cabin?.shipId, carrier = carrierId ? entities.get(carrierId) : undefined;
    const order = carrier && 'order' in carrier && carrier.order.type === 'unload' ? carrier.order : unit.order;
    let site: Site | undefined, basis: Intent['basis'] = 'potential-route';
    if ((order.type === 'attack' || order.type === 'attackMove') && order.targetId) {
      const entity = entities.get(order.targetId);
      if (entity?.owner === owner) {
        site = sites.find(site => site.id === entity.id) ?? nearest(entity);
        if (site) basis = 'native-target';
      }
    }
    if (!site && (order.type === 'attackMove' || order.type === 'move' && !order.avoidCombat)) {
      site = nearest(order, 240);
      if (site) basis = 'native-destination';
    }
    if (!site && order.type === 'unload') {
      site = nearest(order, Infinity);
      if (site) basis = 'native-unload';
    }
    // A stationary armed intruder has no competing declared journey. A unit
    // currently fighting a neutral camp or fleeing is not silently reassigned.
    if (!site && (order.type === 'idle' || order.type === 'hold') && unit.attackDamage > 0 && !unit.deck && !unit.cabin) {
      site = nearest(unit);
      if (site) basis = 'hostile-presence';
    }
    actual.set(unit.id, { actualSiteId: site?.id ?? null,
      redirectGroupId: site ? `site:${site.id}` : `uncommitted-owner:${unit.owner}`, basis });
  }
  return (unit: Pick<Unit, 'id'>, siteId: string): Intent => {
    const activity = actual.get(unit.id) ?? { actualSiteId: null, redirectGroupId: `unobserved:${unit.id}`, basis: 'potential-route' as const };
    return { kind: activity.actualSiteId === siteId ? 'actual-intrusion' : 'potential-redirect', ...activity };
  };
}
