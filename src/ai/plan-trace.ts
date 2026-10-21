import { BUILDING_DEFS } from '../shared/catalog';
import type { GameSnapshot, PlayerId } from '../shared/types';
import type { AiPolicyMemory, MiningMissionMemory } from './memory';
import type { StrategyPlanTrace } from './strategy/types';
import type { AiDeathLedgerFrame } from './death-ledger-types';
import { executorReasonsAt, type ExecutorReason } from './executor-reasons';

/** Output only. Never stored in policy memory, snapshots, saves or command frames. */
export type AiPlanStatus = 'active' | 'blocked' | 'done' | 'abandoned';
export type AiPlanKind = 'expansion' | 'island' | 'defense' | 'attack' | 'pressure' | 'transport' | 'delivery' | 'task';
export type AiPlanTarget = { entityId?: string; position?: { x: number; y: number } };
export type AiPlanReason = { code: string; detail: string; source: string; recordedTick?: number };
export type AiPlanUtility = {
  /** null is unknown, not zero. The current modules do not retain utility scores. */
  score: number | null;
  source: 'planner' | 'not-recorded';
  terms: { name: string; value: number; explanation: string }[];
};
export type AiPlanResources = {
  /** Parent and child allocations can overlap; never sum a whole subtree. */
  unitIds: string[];
  /** null means the module has no per-goal reservation ledger. */
  gold: { reserved: number | null; required: number | null };
};
export type AiPlanNode = {
  /** Stable within a task's lifetime. A new attempt has a different sinceTick/id. */
  id: string;
  kind: AiPlanKind;
  label: string;
  source: string;
  status: AiPlanStatus;
  selected: boolean;
  target: AiPlanTarget;
  utility: AiPlanUtility;
  reasons: AiPlanReason[];
  requirements: { code: string; detail: string; met: boolean | null }[];
  resources: AiPlanResources;
  children: string[];
  sinceTick?: number;
};
export type AiPlanChange = {
  nodeId: string;
  label: string;
  kind: 'added' | 'removed' | 'status' | 'target' | 'allocation' | 'reason' | 'utility';
  /** Missing from memory is not evidence of success or abandonment. */
  before?: AiPlanStatus;
  after?: AiPlanStatus;
  detail: string;
};
export type AiPlanTrace = {
  schemaVersion: 1;
  tick: number;
  owner: PlayerId;
  plannerVersion: string;
  /** This adapter projects committed module state; it does not invent an HTN search. */
  origin: 'module-state';
  bank: { gold: number; supplyUsed: number; supplyCap: number };
  roots: string[];
  nodes: AiPlanNode[];
  previousTick: number | null;
  changes: AiPlanChange[];
  limitations: string[];
  /** Optional formal planner output; proposals never assign resources or write commands.
   * Only publication/history metadata persists in memory.strategy.observation.
   * Existing module-state nodes remain valid when no strategy evaluator is attached. */
  readonly strategy?: StrategyPlanTrace;
  /** Optional read-only regression graph. Absence means no goal planner ran;
   * planned actions do not imply grants, issued commands or physical success. */
  readonly goalPlanner?: import('./strategy/goal-planner-types').GoalPlannerOutput;
  /** Opt-in external simulation observation; never retained in policy memory. */
  deathLedger?: AiDeathLedgerFrame;
  /** Exact blocked/abandoned branches from this think, held outside policy memory. */
  executorReasons?: ExecutorReason[];
};

const STAGES = ['fund', 'assemble', 'clear', 'escort', 'build', 'complete'] as const;
const STAGE_LABELS = ['筹措建城资金', '集结清营部队', '清除守军', '护送工程队', '修建分矿', '交接驻防'];
const CLAIM_KINDS: Record<string, { kind: AiPlanKind; label: string }> = {
  mineRally: { kind: 'defense', label: '矿区集结' }, mineLeash: { kind: 'defense', label: '矿区回防' },
  mineGuard: { kind: 'defense', label: '守卫矿区' }, expansionGarrison: { kind: 'defense', label: '分矿驻军' },
  harassSquad: { kind: 'pressure', label: '前出骚扰' }, workerSafety: { kind: 'defense', label: '保护工人' },
  attack: { kind: 'attack', label: '进攻目标' }, harass: { kind: 'pressure', label: '袭扰目标' },
  retreat: { kind: 'defense', label: '撤退整队' }, build: { kind: 'task', label: '施工任务' },
  mercenary: { kind: 'task', label: '招募佣兵' }, creep: { kind: 'attack', label: '清理营地' },
  expansion: { kind: 'expansion', label: '扩张行军' }, expansionMission: { kind: 'expansion', label: '扩张护卫' },
};

/** Read-only projection over entities, claims and retained tasks. No pathfinding, scoring, policy helpers or mutations. */
export function buildAiPlanTrace(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory,
  plannerVersion: string, previous?: AiPlanTrace): AiPlanTrace {
  const entities = new Map([...snapshot.units, ...snapshot.buildings, ...snapshot.resources].map(entity => [entity.id, entity]));
  const own = new Set(snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0).map(unit => unit.id));
  const nodes: AiPlanNode[] = [], roots: string[] = [];
  const target = (id?: string, point?: { x: number; y: number }): AiPlanTarget => {
    const entity = id ? entities.get(id) : undefined;
    const position = entity ?? point;
    return { ...(id ? { entityId: id } : {}), ...(position ? { position: { x: position.x, y: position.y } } : {}) };
  };
  const units = (ids: readonly string[]) => [...new Set(ids.filter(id => own.has(id)))].sort();
  const reason = (code: string, detail: string, source: string, recordedTick?: number): AiPlanReason =>
    ({ code, detail, source, ...(recordedTick !== undefined ? { recordedTick } : {}) });
  const add = (node: Pick<AiPlanNode, 'id' | 'kind' | 'label' | 'source' | 'status'> & Partial<AiPlanNode>, parent?: AiPlanNode) => {
    const value: AiPlanNode = { selected: node.status === 'active' || node.status === 'blocked', target: {}, utility: { score: null, source: 'not-recorded', terms: [] },
      reasons: [], requirements: [], resources: { unitIds: [], gold: { reserved: null, required: null } }, children: [], ...node };
    nodes.push(value);
    if (parent) parent.children.push(value.id); else roots.push(value.id);
    return value;
  };
  const claims = Object.entries(memory.unitClaims).filter(([id, claim]) => own.has(id)
    && (claim.kind === 'expansionMission' || claim.expiresTick >= snapshot.tick));
  const expansionUnits = (mineId: string) => units(claims.filter(([, claim]) => claim.expansionMineId === mineId
    || claim.kind === 'expansionMission' && claim.targetId === mineId).map(([id]) => id));
  const missions = new Map<string, AiPlanNode>();
  const mining = (task: MiningMissionMemory, kind: 'expansion' | 'island', source: string,
    extra?: { reason: string; abandonedTick?: number; landing: { x: number; y: number } }) => {
    const id = `${kind}:${task.mineId}:${task.sinceTick}`;
    const recordedReason = task.reason ?? extra?.reason;
    const waiting = recordedReason !== undefined && /^(await-|saving-|blocked:)/.test(recordedReason);
    const status: AiPlanStatus = extra?.abandonedTick !== undefined ? 'abandoned'
      : task.stage === 'complete' ? 'done' : task.paused || task.stage === 'fund' ? 'blocked'
      : waiting ? 'blocked' : 'active';
    const last = task.interruptions.at(-1);
    const root = add({ id, kind, label: kind === 'island' ? '夺岛建矿' : '建立分矿', source, status,
      target: target(task.mineId, extra?.landing), sinceTick: task.sinceTick,
      resources: { unitIds: units([...expansionUnits(task.mineId), ...(task.combat?.creep?.group ?? [])]),
        gold: { reserved: null, required: task.stage === 'complete' ? 0 : BUILDING_DEFS.townHall.cost } },
      reasons: [reason(task.paused ? last?.reason ?? 'paused' : recordedReason ?? `stage:${task.stage}`,
        task.paused ? `任务暂停：${last?.reason ?? '原因未记录'}` : recordedReason ?? `当前阶段：${task.stage}`,
        source, task.paused ? last?.tick : undefined)],
      requirements: task.paused ? [{ code: 'resume-after-threat', detail: '等待记录中的威胁解除', met: false }]
        : task.stage === 'fund' ? [{ code: 'town-hall-capital', detail: '等待建城资金', met: false }]
        : waiting ? [{ code: recordedReason, detail: recordedReason, met: false }] : [],
    });
    missions.set(task.mineId, root);
    const index = STAGES.indexOf(task.stage);
    const step = add({ id: `${id}/stage:${task.stage}`, kind: 'task', label: STAGE_LABELS[index]!, source,
      status, target: target(task.mineId),
      resources: { unitIds: [...root.resources.unitIds], gold: { reserved: null,
        required: task.stage === 'fund' || task.stage === 'build' ? BUILDING_DEFS.townHall.cost : null } },
      reasons: root.reasons.map(value => ({ ...value })),
      requirements: root.requirements.map(value => ({ ...value })),
    }, root);
    const camp = task.combat?.creep;
    if (camp) add({ id: `${step.id}/camp:${camp.stage}`, kind: 'task', label: camp.stage === 'gather' ? '营地外整队' : '交战清营',
      source: `${source}.combat.creep`, status, target: target(undefined, camp.center),
      resources: { unitIds: units(camp.group), gold: { reserved: null, required: null } },
      reasons: [reason(`stage:${camp.stage}`, `清营部队阶段：${camp.stage}`, `${source}.combat.creep`)],
    }, step);
    return root;
  };
  if (memory.landExpansion) mining(memory.landExpansion, 'expansion', 'landExpansion');
  for (const task of Object.values(memory.naval?.conquests ?? {})) mining(task, 'island', 'naval.conquests', task);

  if (memory.landAttack) {
    const task = memory.landAttack, status = task.paused ? 'blocked' : 'active';
    const root = add({ id: `attack:${task.targetId}:${task.sinceTick}`, kind: 'attack', label: '进攻敌方据点',
      source: 'landAttack', status, target: target(task.targetId), sinceTick: task.sinceTick,
      resources: { unitIds: units(task.general.group ?? []), gold: { reserved: null, required: null } },
      reasons: [reason(task.paused ? `paused:${task.paused}` : `stage:${task.general.stage ?? task.general.mode}`,
        task.paused ? `让位于 ${task.paused}` : `部队阶段：${task.general.stage ?? task.general.mode}`, 'landAttack')],
    });
    if (task.camp) add({ id: `${root.id}/camp`, kind: 'task', label: '清除行军道路', source: 'landAttack.camp', status,
      target: target(undefined, task.camp.center), resources: { unitIds: units(task.camp.group), gold: { reserved: null, required: null } },
      reasons: [reason(`stage:${task.camp.stage}`, task.camp.stage, 'landAttack.camp')] }, root);
  }
  if (memory.landAttackResult) {
    const result = memory.landAttackResult;
    add({ id: `attack-result:${result.targetId}:${result.tick}`, kind: 'attack', label: '上一次进攻结果', source: 'landAttackResult',
      status: result.result === 'destroyed' ? 'done' : 'abandoned', target: target(result.targetId),
      reasons: [reason(result.result, result.reason, 'landAttackResult', result.tick)] });
  }
  const defenses = new Map<string, AiPlanNode>();
  if (memory.miningDefense) {
    const task = memory.miningDefense;
    const ids = claims.filter(([, claim]) => claim.targetId === task.hallId && ['mineRally', 'mineGuard', 'mineLeash'].includes(claim.kind)).map(([id]) => id);
    const root = add({ id: `defense:${task.hallId}`, kind: 'defense', label: '回防受袭矿区', source: 'miningDefense', status: 'active',
      target: target(task.hallId, task.point), resources: { unitIds: units(ids), gold: { reserved: null, required: null } },
      reasons: [reason(`phase:${task.phase}`, `${task.phase}；记录中的袭击者 ${task.attackerIds.length} 人`, 'miningDefense')],
    });
    defenses.set(task.hallId, root);
  }
  const claimGroups = new Map<string, { ids: string[]; claim: (typeof claims)[number][1] }>();
  for (const [id, claim] of claims) {
    const key = `${claim.kind}:${claim.targetId}`;
    const group = claimGroups.get(key) ?? { ids: [], claim };
    group.ids.push(id); claimGroups.set(key, group);
  }
  for (const [key, { ids, claim }] of claimGroups) {
    const info = CLAIM_KINDS[claim.kind] ?? { kind: 'task' as const, label: claim.kind };
    const parent = (claim.expansionMineId ? missions.get(claim.expansionMineId) : undefined) ?? defenses.get(claim.targetId);
    const arrived = ids.filter(id => memory.unitClaims[id]?.arrived).length;
    const returning = ids.filter(id => memory.unitClaims[id]?.returning).length;
    add({ id: `claim:${key}`, kind: info.kind, label: info.label, source: `unitClaims.${claim.kind}`, status: 'active',
      target: target(claim.targetId, claim), sinceTick: claim.sinceTick,
      resources: { unitIds: units(ids), gold: { reserved: null, required: null } },
      reasons: [reason(returning === ids.length ? 'returning' : arrived === ids.length ? 'arrived' : arrived || returning ? 'group-progress' : 'en-route',
        `${arrived}/${ids.length} 名已到位；${returning} 名正在回位`, `unitClaims.${claim.kind}`)],
    }, parent);
  }

  const naval = memory.naval;
  const first = naval?.firstCombatDelivery;
  if (first) {
    const root = add({ id: `delivery:${first.firstShipTick}`, kind: 'delivery', label: '首次战斗部队登陆',
      source: 'naval.firstCombatDelivery', status: first.deliveredTick !== undefined ? 'done' : 'active',
      reasons: [reason(first.deliveredTick !== undefined ? 'delivered' : 'await-delivery',
        first.deliveredTick !== undefined ? `实际登陆 tick ${first.deliveredTick}` : `登陆期限 tick ${first.deadlineTick}`, 'naval.firstCombatDelivery', first.deliveredTick)],
    });
    for (const [shipId, attempt] of Object.entries(first.attempts)) {
      add({ id: `${root.id}/${shipId}:${attempt.firstSeenTick}`, kind: 'transport', label: '登陆航次', source: 'naval.firstCombatDelivery.attempts',
        status: attempt.lostTick !== undefined ? 'abandoned' : first.deliveredShipId === shipId ? 'done' : 'active',
        target: target(attempt.targetId), resources: { unitIds: units([shipId, ...attempt.passengerIds]), gold: { reserved: null, required: null } },
        reasons: [reason(attempt.reason, attempt.reason, 'naval.firstCombatDelivery.attempts', attempt.tick)],
      }, root);
    }
  }
  for (const [shipId, task] of Object.entries(naval?.ferries ?? {})) {
    const decision = naval?.ferryDecisions?.[shipId];
    const block = decision && decision.tick >= task.sinceTick && decision.lastBlock?.tick === decision.tick
      && decision.lastBlock.reason === decision.reason;
    const root = add({ id: `ferry:${shipId}:${task.sinceTick}`, kind: 'transport', label: `渡运 · ${task.purpose}`, source: 'naval.ferries',
      status: block ? 'blocked' : 'active', target: target(task.phase === 'return' ? undefined : task.targetId, task.phase === 'return' ? task.from : task.to), sinceTick: task.sinceTick,
      resources: { unitIds: units([shipId, ...task.crewIds, ...(task.payloadIds ?? [])]), gold: { reserved: null, required: null } },
      reasons: [reason(block ? decision.reason : `phase:${task.phase}`, block ? decision.reason : `航次阶段：${task.phase}`, 'naval.ferryDecisions', decision?.tick)],
      requirements: block ? [{ code: decision.reason, detail: decision.reason, met: false }] : [],
    }, missions.get(task.targetId));
    add({ id: `${root.id}/phase:${task.phase}`, kind: 'task',
      label: { loading: '装载部队', sailing: '航渡与登陆', return: '返航整补' }[task.phase],
      source: 'naval.ferries.phase', status: root.status, target: target(task.phase === 'return' ? undefined : task.targetId, task.phase === 'return' ? task.from : task.to),
      resources: { unitIds: [...root.resources.unitIds], gold: { reserved: null, required: null } },
      reasons: root.reasons.map(value => ({ ...value })), requirements: root.requirements.map(value => ({ ...value })),
    }, root);
  }
  if (memory.territory?.objective) {
    const task = memory.territory.objective;
    add({ id: `pressure:${task.targetId}:${task.sinceTick}`, kind: 'pressure', label: '前压控制据点', source: 'territory.objective',
      status: task.reachedTick !== undefined ? 'done' : 'active', target: target(task.targetId, task.point), sinceTick: task.sinceTick,
      reasons: [reason(task.reachedTick !== undefined ? 'reached' : 'advancing', task.reachedTick !== undefined ? '已抵达前压点' : '向已选定据点推进', 'territory.objective')] });
  }
  // Everything returned is newly allocated, including nested points and ID lists.
  const state = snapshot.players[owner];
  const trace: AiPlanTrace = { schemaVersion: 1, tick: snapshot.tick, owner, plannerVersion, origin: 'module-state',
    bank: { gold: state?.gold ?? 0, supplyUsed: state?.supplyUsed ?? 0, supplyCap: state?.supplyCap ?? 0 },
    roots, nodes, previousTick: previous?.owner === owner && previous.tick < snapshot.tick ? previous.tick : null, changes: [],
    limitations: ['utility-not-recorded', 'per-goal-gold-reservations-not-recorded', 'module-state-not-an-htn-search'],
  };
  const executorReasons = executorReasonsAt(memory, snapshot.tick);
  if (executorReasons) trace.executorReasons = executorReasons;
  trace.changes = compareAiPlanTraces(trace.previousTick !== null ? previous : undefined, trace);
  return trace;
}

export function compareAiPlanTraces(previous: AiPlanTrace | undefined, current: AiPlanTrace): AiPlanChange[] {
  const before = new Map(previous?.nodes.map(node => [node.id, node]));
  const after = new Map(current.nodes.map(node => [node.id, node]));
  const changes: AiPlanChange[] = [];
  for (const node of current.nodes) {
    const old = before.get(node.id);
    if (!old) changes.push({ nodeId: node.id, label: node.label, kind: 'added', after: node.status, detail: '首次观察到此计划元素' });
    else {
      if (old.status !== node.status) changes.push({ nodeId: node.id, label: node.label, kind: 'status', before: old.status, after: node.status, detail: `${old.status} → ${node.status}` });
      for (const [kind, left, right] of [
        ['target', old.target.entityId ? { entityId: old.target.entityId } : old.target, node.target.entityId ? { entityId: node.target.entityId } : node.target], ['allocation', old.resources, node.resources],
        ['reason', [old.reasons.map(({ recordedTick: _, ...reason }) => reason), old.requirements], [node.reasons.map(({ recordedTick: _, ...reason }) => reason), node.requirements]],
        ['utility', old.utility, node.utility],
      ] as const) if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ nodeId: node.id, label: node.label, kind,
        detail: kind === 'target' ? `${JSON.stringify(old.target)} → ${JSON.stringify(node.target)}`
          : kind === 'allocation' ? `兵力 ${old.resources.unitIds.length} → ${node.resources.unitIds.length}；资源 ${JSON.stringify(old.resources.gold)} → ${JSON.stringify(node.resources.gold)}`
          : kind === 'reason' ? `${old.reasons.map(reason => reason.code).join('、')} → ${node.reasons.map(reason => reason.code).join('、')}`
          : `效用 ${old.utility.score ?? '未记录'} → ${node.utility.score ?? '未记录'}` });
    }
  }
  for (const node of previous?.nodes ?? []) if (!after.has(node.id)) changes.push({ nodeId: node.id, label: node.label, kind: 'removed', before: node.status,
    detail: '模块不再保留此元素；未推断为完成或放弃' });
  return changes;
}
