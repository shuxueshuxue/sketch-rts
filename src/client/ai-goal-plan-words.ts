import type { GoalActionDeclaration, GoalFactObservation, GoalFactPredicate } from '../ai/strategy/goal-planner-types';
import type { AllocationReason } from '../ai/strategy/allocation-types';
import { BUILDING_CARDS } from './content/buildings';
import { UNIT_CARDS } from './content/units';

export const goalNumber = (value: number | null | undefined) => value == null ? '—' : String(Number(value.toFixed(2)));
export const goalStates: Record<string, string> = {
  met: '已成立', unmet: '未成立', pending: '计算中', ready: '已就绪', 'waiting-facts': '等条件',
  'waiting-actions': '等前一步', 'waiting-time': '等时机', blocked: '受阻',
  'world-effects-met': '已完成', complete: '已完成', 'search-pending': '继续规划',
};
const factNames: Record<GoalFactPredicate['kind'], string> = {
  'force-at': '兵力到岗', 'force-available': '可调用兵力', 'transport-in': '运输船可用', 'transport-at': '运输船到位',
  'shipyard-for': '船厂完工', production: '生产条件', gold: '金币充足', 'worker-at': '工人到岗', 'cargo-aboard': '乘员登船',
  'shore-safe': '滩头安全', 'camp-cleared': '营地清空', 'hall-complete': '大厅完工', 'site-safe': '据点安全',
  'supply-cap': '人口档位', 'population-room': '空余人口', 'build-site': '位置可建', 'spawn-exit': '出口畅通',
  route: '路线可通行', 'unit-available': '单位可调用', 'building-complete': '建筑完工',
  'enemy-site-destroyed': '敌方据点摧毁', 'route-controlled': '通路控制', 'harassment-ended': '骚扰结束',
  'interception-capability': '拦截能力', 'assets-safe': '部队安全',
};
export function goalFactLabel(predicate: GoalFactPredicate): string {
  switch (predicate.kind) {
    case 'gold': return `备齐 ${predicate.minimum} 金`;
    case 'building-complete': return `${BUILDING_CARDS[predicate.buildingKind].name.zh}完工`;
    case 'build-site': return `${BUILDING_CARDS[predicate.buildingKind].name.zh}可建`;
    case 'production': return `${UNIT_CARDS[predicate.unitKind].name.zh}可生产`;
    case 'unit-available': return `${predicate.count} 名${UNIT_CARDS[predicate.unitKind].name.zh}可调用`;
    case 'worker-at': return `${predicate.count} 名工人到岗`;
    default: return factNames[predicate.kind];
  }
}
export function goalFactSummary(observation: GoalFactObservation): string {
  const p = observation.fact.predicate;
  if (observation.state === 'pending') return p.kind === 'route' ? '等路线算完' : '等条件核实';
  if (p.kind === 'gold') return observation.quantity == null ? `需要 ${p.minimum} 金`
    : observation.quantity < p.minimum ? `还差 ${goalNumber(p.minimum - observation.quantity)} 金` : `已备齐 ${p.minimum} 金`;
  if (p.kind === 'site-safe' && observation.state === 'unmet' && observation.reason.code === 'fixture-await-route'
    && typeof observation.reason.values.required === 'number')
    return `还差 ${goalNumber(observation.reason.values.required)} 战力`;
  if (p.kind === 'force-at' || p.kind === 'force-available') return observation.quantity == null ? `需要 ${p.minimum} 战力`
    : `当前 ${goalNumber(observation.quantity)} / ${p.minimum} 战力`;
  if (p.kind === 'transport-in') return `载重需要 ${p.capacity}`;
  return goalStates[observation.state] ?? '—';
}
export function goalDeclarationLabel(action: GoalActionDeclaration): string {
  if (action.kind === 'build') {
    const p = action.effects.find(row => row.fact.predicate.kind === 'building-complete' || row.fact.predicate.kind === 'shipyard-for'
      || row.fact.predicate.kind === 'hall-complete')?.fact.predicate;
    if (p?.kind === 'shipyard-for') return '建船厂';
    if (p?.kind === 'hall-complete') return '建大厅';
    if (p?.kind === 'building-complete') return `建${BUILDING_CARDS[p.buildingKind].name.zh}`;
  }
  if (action.kind === 'train') {
    if (action.effects.some(row => row.fact.predicate.kind === 'transport-in')) return '造运输船';
    const kind = action.executor.parameters.unitKind;
    if (typeof kind === 'string' && kind in UNIT_CARDS) return `训练${UNIT_CARDS[kind as keyof typeof UNIT_CARDS].name.zh}`;
  }
  return ({ assemble: '集结', 'transport-force': '运兵', 'transport-worker': '运工人', 'position-transport': '调船',
    'clear-camp': '清营', 'clear-shore': '清滩头', defend: '回防', evacuate: '撤离', train: '训练', build: '建造',
    'wait-income': '等待收入', 'destroy-target': '摧毁目标', 'hold-position': '驻守', 'engage-units': '交战' })[action.kind];
}
/** Presentation translations only. Unknown codes remain available in the raw record. */
export function goalReasonText(reason: AllocationReason): string {
  switch (reason.code) {
    case 'fixture-await-route': return '等路线算完';
    case 'navy-build-from-zero': return '没有船厂和船，先补齐运力，再上岛建大厅';
    case 'hall-money-protected': return '大厅的建造费已留出，造船不能动用';
    case 'sea-lift-required': return '目标隔海，需要运输船';
    case 'camp-blocks-worker': return '先清营，再让工人上岛';
    case 'safe-landing-selected': return '走安全滩头，不另派兵清滩';
    case 'landing-needs-extra-fight': return '近滩头有敌人，多打一仗会更晚到达';
    case 'income-from-mines': return '等待矿工收入';
    case 'camp-bounty': return '清营获得赏金';
    default: return '—';
  }
}
export const goalPhaseText = (phase: string) => ({ gather: '集结', assemble: '集结', clear: '清营', fight: '交战',
  build: '建造', train: '生产', escort: '护送', sail: '航行', board: '登船', unload: '卸载', prepare: '准备' } as Record<string,string>)[phase] ?? '执行中';
