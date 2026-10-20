import type { CommandRefusal } from '../shared/command-refusal';
import { SIM_TICKS_PER_SECOND } from '../shared/time';

export function commandRefusalText(refusal: CommandRefusal, locale: 'zh' | 'en' = 'zh'): string {
  const zh = locale === 'zh';
  const time = (ticks: number) => Math.ceil(Math.max(0, ticks) / SIM_TICKS_PER_SECOND);
  switch (refusal.reason) {
    case 'garrison-not-infantry': return zh ? '只有徒步单位能登上防御塔' : 'Only infantry can enter defense towers';
    case 'garrison-mechanical': return zh ? '机械单位不能登上防御塔' : 'Mechanical units cannot enter defense towers';
    case 'tower-full': return zh ? `塔顶满员（已占 ${refusal.detail.used}/${refusal.detail.capacity}，需要 ${refusal.detail.required}）` : `Tower full (${refusal.detail.used}/${refusal.detail.capacity}, needs ${refusal.detail.required})`;
    case 'garrison-body-size': return zh ? '体型过大，无法登上这座防御塔' : 'This unit is too large for the tower';
    case 'garrison-ownership': return zh ? '只能登上自己的防御塔' : 'You can only enter your own tower';
    case 'garrison-ineligible': return zh ? '该单位不能登上防御塔' : 'This unit cannot enter a tower';
    case 'gold': return zh ? `金币不足，还差 ${Math.ceil(Math.max(0, refusal.detail.required - refusal.detail.available))}` : `Not enough gold: ${Math.ceil(Math.max(0, refusal.detail.required - refusal.detail.available))} more needed`;
    case 'supply': return zh ? `人口不足（${refusal.detail.used}/${refusal.detail.capacity}，需要 ${refusal.detail.required}）` : `Not enough supply (${refusal.detail.used}/${refusal.detail.capacity}, needs ${refusal.detail.required})`;
    case 'supply-tier': return zh ? `需要人口上限 ${refusal.detail.requiredCap}（当前 ${refusal.detail.currentCap}）` : `Requires supply cap ${refusal.detail.requiredCap} (current ${refusal.detail.currentCap})`;
    case 'cooldown': return zh ? `冷却中，还剩 ${time(refusal.detail.remainingTicks)} 秒` : `Cooling down: ${time(refusal.detail.remainingTicks)}s remaining`;
    case 'stock-empty': return zh ? `库存已空${refusal.detail.remainingTicks ? `，${time(refusal.detail.remainingTicks)} 秒后补货` : ''}` : `Out of stock${refusal.detail.remainingTicks ? `; restocks in ${time(refusal.detail.remainingTicks)}s` : ''}`;
    case 'inventory-full': return zh ? '背包已满' : 'Inventory full';
    case 'inventory-incompatible': return zh ? '没有适合这件物品的空位' : 'No compatible free equipment position';
    case 'target-type': {
      const required = refusal.detail.required;
      const labels = { mechanical: ['只能修理机械单位', 'Only mechanical units can be repaired'], 'non-mechanical': ['目标必须是非机械单位', 'Requires a non-mechanical target'], 'friendly-unit': ['请选择友方单位', 'Choose a friendly unit'], 'enemy-unit': ['请选择敌方单位', 'Choose an enemy unit'], 'enemy-building': ['请选择敌方建筑', 'Choose an enemy building'], 'unit-or-point': ['请选择有效单位或位置', 'Choose a valid unit or point'] };
      return labels[required][zh ? 0 : 1]!;
    }
    case 'ownership': return zh ? (refusal.detail.requiredRelation === 'own' ? '只能对自己的单位或建筑执行此操作' : refusal.detail.requiredRelation === 'friendly' ? '请选择友方目标' : '请选择敌方目标') : 'This target has the wrong owner';
    case 'inside-min-range': return zh ? `目标在最小射程内（至少 ${refusal.detail.minimum}，当前 ${Math.round(refusal.detail.distance)}）` : `Inside minimum range (needs ${refusal.detail.minimum}, currently ${Math.round(refusal.detail.distance)})`;
    case 'unreachable': return zh ? '无法到达目标' : 'Target is unreachable';
    case 'site-occupied': return zh ? '建造位置已被占用' : 'Building site occupied';
    case 'site-terrain': return zh ? '此处地形不能建造' : 'Cannot build on this terrain';
    case 'building-incomplete': return zh ? '建筑尚未完工' : 'Building incomplete';
    case 'target-gone': return zh ? '目标已不存在' : 'Target is no longer available';
    case 'issuer-gone': return zh ? '发令单位已不存在' : 'The issuing unit is no longer available';
    case 'unit-ineligible': {
      const labels = { worker: ['需要工人执行', 'Requires a worker'], armed: ['该单位没有可用武器', 'This unit has no usable weapon'], ranged: ['需要远程单位', 'Requires a ranged unit'], 'hold-capable': ['工人不能驻守攻击', 'Workers cannot hold position'], transport: ['需要运输单位', 'Requires a transport'], melee: ['需要近战单位', 'Requires a melee unit'] };
      return labels[refusal.detail.required][zh ? 0 : 1]!;
    }
    case 'item-not-carried': return zh ? '该单位没有携带这件物品' : 'This unit is not carrying that item';
    case 'item-passive': return zh ? '被动物品无需主动使用' : 'Passive items cannot be activated';
    case 'condition-unmet': {
      const labels = { gold: ['金币不足', 'Not enough gold'], supply: ['人口不足', 'Not enough supply'], tier: ['人口上限未达要求', 'Supply cap requirement not met'], stock: ['库存已空', 'Out of stock'], cooldown: ['仍在冷却中', 'Still cooling down'], position: ['位置不满足要求，请靠近目标', 'Move closer to the target'], gone: ['单位或目标已不存在', 'Unit or target no longer available'], target: ['目标不符合要求', 'Invalid target'], range: ['距离不满足要求', 'Invalid range'], unreachable: ['无法到达目标', 'Target unreachable'], occupied: ['没有足够空间', 'Not enough space'], state: ['当前状态无法执行此操作', 'Cannot perform this action in the current state'], rules: ['该单位或建筑不能执行此操作', 'This unit or building cannot perform this action'] };
      return labels[refusal.detail.category][zh ? 0 : 1]!;
    }
    default: return refusal satisfies never;
  }
}
