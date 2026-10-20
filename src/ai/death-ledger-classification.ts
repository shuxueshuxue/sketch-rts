import type { AiDeathCategory, AiUnitDeathRecord } from './death-ledger-types';

/** Versioned diagnostics over observations. These thresholds never feed the policy. */
export const DEATH_DIAGNOSTIC_VERSION = 1;
export const DEATH_DIAGNOSTIC_MIN_RATIO = .6;
export const DEATH_SWITCH_WINDOW = 200;

export function classifyAiDeath(record: Omit<AiUnitDeathRecord, 'classification'>): AiUnitDeathRecord['classification'] {
  const tags: AiDeathCategory[] = [], explanations: string[] = [];
  const add = (category: AiDeathCategory, why: string) => { tags.push(category); explanations.push(why); };
  const result = (disposition: 'normal' | 'abnormal' | 'lifecycle', attribution: 'inferred' | 'lifecycle-event'): AiUnitDeathRecord['classification'] => ({
    disposition, primary: tags[0]!, tags, explanations, attribution,
    diagnosticVersion: DEATH_DIAGNOSTIC_VERSION, minimumInferredCombatRatio: DEATH_DIAGNOSTIC_MIN_RATIO,
  });
  if (!record.actualDeath) {
    add(record.removal === 'expired' ? 'summon-expired' : 'script-exit', '原生生命周期移除；单位仍存活，不计战斗阵亡或异常战损');
    return result('lifecycle', 'lifecycle-event');
  }
  if (record.cause === 'forfeit') {
    add('forfeit', '玩家已实际投降，模拟统一清除单位；行政损失单列');
    return result('lifecycle', 'lifecycle-event');
  }
  const { assignment, context, unit, currentOrder } = record, task = assignment.task;
  if (context.killerIsAlly) add('friendly-source', '己方或盟友来源致死（包括碰撞/沉船），不冒充正常敌我交战损耗');
  if (context.outsidePerimeter) add('out-of-bounds', '实际位置超过当前防守任务的基地中心 650 范围');
  if (context.wornRetreatTick !== null && record.tick - context.wornRetreatTick <= 900 && unit.expiresTick === undefined && context.balance.hostile > 0)
    add('post-worn-abandonment', '所属进攻波次近期已以 worn 撤销，永久单位仍在敌方火力附近阵亡');
  if (context.switches.some(change => record.tick - change.tick <= DEATH_SWITCH_WINDOW))
    add('recent-reassignment', '阵亡前 10 秒内推断目标发生切换；时间关联，不证明切换导致死亡');
  if (context.retreating || context.treatment) add('retreat-or-treatment', '正在局部撤退、回收或治疗移动/等待中阵亡');
  if (task?.kind === 'transport' || task?.kind === 'errand' || currentOrder.type === 'board'
    || assignment.state === 'en-route' && currentOrder.type === 'move')
    add('logistics-transit', '执行行军、装载、运输或跑腿动作时阵亡');
  if (record.killer?.owner === 'neutral' && !task?.clearing)
    add('neutral-outside-clearing', '记录到野怪击杀，当前推断任务未确认本单位在执行清营');
  if (context.onHomeGround === false && !context.safeOwnSitesOnGround.length && !context.evacuationAssigned)
    add('isolated-without-evacuation-plan', '独立陆块无健康完工己方据点、无已记录撤离任务；未据此宣称所有路线不可行');
  if (unit.kind === 'worker') add('exposed-worker', '工人在经济/建造/撤离等任务中被杀，不能作为普通战斗单位的正常交战损耗');
  if ((!task || task.kind === 'hold') && (currentOrder.type === 'idle' || currentOrder.type === 'hold')) add('idle', '没有可归因目标且致死命中时实际处于 idle/hold');
  if (context.balance.ratio !== null && context.balance.ratio < DEATH_DIAGNOSTIC_MIN_RATIO)
    add('outmatched', '死亡附近有效战力比低于 0.6 的诊断线；旧任务未记录正式可接受兵力区间');
  if (!record.killer || !task?.combat) {
    if (!tags.length) add('unattributed', !record.killer ? '没有观察到致死来源；保留为待查异常，未把上一击冒充击杀者' : '没有足够任务证据把这场交战视为已接受的目标交战');
  }
  if (tags.length) return result('abnormal', 'inferred');
  add('accepted-engagement', '推断属于已记录的战斗目标，未触发异常处境，局部战力满足诊断线；并非正式规划器的战损许可');
  return result('normal', 'inferred');
}
