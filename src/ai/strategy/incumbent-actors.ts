/** One identity per incumbent task, independent of how many old claims describe it. */
export const landExpansionActor = (task: { mineId: string; sinceTick: number }) =>
  ({ source: 'landExpansion', taskId: `expansion:${task.mineId}:${task.sinceTick}` });
export const expansionGarrisonActor = (hallId: string) => ({ source: 'expansionGarrison', taskId: hallId });
/** Rally, local defense and the general's actual defense serve the same post. */
export const miningDefenseActor = (hallId: string) => ({ source: 'miningDefense', taskId: hallId });
export const navalFerryActor = (shipId: string, sinceTick: number) =>
  ({ source: 'naval.ferries', taskId: `ferry:${shipId}:${sinceTick}` });
export const islandConquestActor = (task: { mineId: string; sinceTick: number }) =>
  ({ source: 'naval.conquests', taskId: `conquest:${task.mineId}:${task.sinceTick}` });
