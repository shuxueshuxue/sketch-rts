import type { BootstrapAiVersion, GameSnapshot, PlayerId } from '../../shared/types';
import { V5_HYBRID_AI_STACK, V7_AI_STACK, V8_AI_STACK, planAiCommandEntriesFromScripts } from '../policy/core';
import type { AiPolicyContext } from '../policy/types';
import { V6_STRATEGIES, v7Phases, type V6Strategy } from '../policy/v6/doctrine';
import { V8_STRATEGIES } from '../policy/v8/doctrine';

export const BOOTSTRAP_VERSIONS = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
export function isBootstrapVersion(version: string): version is BootstrapAiVersion {
  return version === 'v9_archer' || version === 'v9_summoner' || version === 'v9_knight';
}

// Start from each frozen family's functioning build sequence. New policy changes live here;
// their opponents continue using the unchanged historical strategy tables.
export const BOOTSTRAP_DOCTRINES: Record<BootstrapAiVersion, V6Strategy[]> = {
  v9_archer: [],
  v9_summoner: V6_STRATEGIES.map(strategy => ({ ...strategy, phases: v7Phases(strategy) })),
  v9_knight: V8_STRATEGIES.map(strategy => ({ ...strategy, phases: v7Phases(strategy) })),
};

export function planBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext) {
  const stack = version === 'v9_archer' ? V5_HYBRID_AI_STACK : version === 'v9_summoner' ? V7_AI_STACK : V8_AI_STACK;
  const requestedVersion = version === 'v9_archer' ? 'v5' : version === 'v9_summoner' ? 'v7' : 'v8';
  return planAiCommandEntriesFromScripts(snapshot, owner, stack, {
    ...options,
    version: 'v2',
    requestedVersion,
    ...(version === 'v9_archer' ? {} : { doctrines: BOOTSTRAP_DOCTRINES[version] }),
  });
}
