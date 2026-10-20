import type { PlayerId } from '../shared/types';
import type { AiDeathSummary, AiUnitDeathRecord } from './death-ledger-types';

/** Shared by live traces and offline v1→v2 reclassification. */
export function summarizeAiDeaths(rows: readonly AiUnitDeathRecord[], owner?: PlayerId, throughTick = Infinity): AiDeathSummary {
  const result: AiDeathSummary = { events: 0, deaths: 0, nativeLosses: 0, aliveExpirations: 0, scriptedExits: 0,
    normal: { count: 0, catalogGold: 0 }, suspicious: { count: 0, catalogGold: 0 }, abnormal: { count: 0, catalogGold: 0 },
    unattributed: { count: 0, catalogGold: 0 }, lifecycle: { count: 0, catalogGold: 0 }, byCategory: {}, byTag: {} };
  for (const row of rows) {
    if (row.removedTick > throughTick || owner !== undefined && row.owner !== owner) continue;
    result.events++; result.deaths += Number(row.actualDeath); result.nativeLosses += Number(row.countedAsNativeLoss);
    result.aliveExpirations += Number(row.removal === 'expired' && !row.actualDeath);
    result.scriptedExits += Number(row.removal === 'script-exit');
    const { disposition, primary, tags } = row.classification, part = result[disposition];
    part.count++; part.catalogGold += row.actualDeath ? row.catalogGold : 0;
    const category = result.byCategory[primary] ??= { count: 0, catalogGold: 0 };
    category.count++; category.catalogGold += row.actualDeath ? row.catalogGold : 0;
    for (const tag of tags) result.byTag[tag] = (result.byTag[tag] ?? 0) + 1;
  }
  return result;
}
