import { UNIT_DEFS } from '../../shared/catalog';
import type { BootstrapAiVersion, GameSnapshot, PlayerId } from '../../shared/types';
import { AI_SCRIPT_LIBRARY, V9_AI_STACK, V7_AI_STACK, V8_AI_STACK, planAiCommandEntriesFromScripts } from '../policy/core';
import { isOpponentOwner } from '../policy/ownership';
import type { AiPolicyContext } from '../policy/types';
import { V6_STRATEGIES, v7Phases, type V6Strategy, type V6Want } from '../policy/v6/doctrine';
import { V8_STRATEGIES } from '../policy/v8/doctrine';
import { ARCHER_DOCTRINES } from './archer-doctrine';
import { archerMicro } from './archer-micro';
import { battleRepair } from './repair';
import { miningWorkforce } from './workforce';
import { bootstrapEconomy } from './economy';
import { shellEvasion } from './shell-evasion';
import { summonerTowerRush, towerRushAbilities } from './tower-rush';

export const BOOTSTRAP_VERSIONS = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
export const BOOTSTRAP_PARENTS = { v9_archer: 'v5', v9_summoner: 'v7', v9_knight: 'v8' } as const;

export function isBootstrapVersion(version: string): version is BootstrapAiVersion {
  return version === 'v9_archer' || version === 'v9_summoner' || version === 'v9_knight';
}

export const BOOTSTRAP_DOCTRINES: Record<BootstrapAiVersion, V6Strategy[]> = {
  v9_archer: ARCHER_DOCTRINES,
  v9_summoner: V6_STRATEGIES.map(strategy => ({ ...strategy, phases: v7Phases(strategy) })),
  v9_knight: V8_STRATEGIES.map(strategy => ({
    ...strategy,
    phases: v7Phases(strategy).map(phase => ({
      ...phase,
      wants: phase.wants.map(want => 'building' in want && want.building === 'emberForge'
        ? { ...want, building: UNIT_DEFS.ashChieftain.trainedAt! } : want),
    })),
  })),
};

function supportWants(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext): V6Want[] {
  const army = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unit.expiresTick === undefined);
  if (army.length < 10) return [];
  const foes = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options));
  const grove = snapshot.players[owner]!.race === 'grove';
  const main = version === 'v9_knight' ? (grove ? 'knight' : 'ashChieftain')
    : version === 'v9_summoner' ? (grove ? 'summoner' : 'pyreCaller') : (grove ? 'horseArcher' : 'sparkArcher');
  const producer = UNIT_DEFS[main].trainedAt!;
  const wants: V6Want[] = [
    { bases: Math.min(5, 1 + Math.floor(army.length / 5)), priority: 76 },
    { building: producer, count: 2, priority: 57 },
  ];
  // The spirit host fights through summons, which these upgrades do not affect.
  if (version !== 'v9_summoner') wants.push(
    { upgrade: 'weaponTraining', level: 3, priority: 59 },
    { upgrade: 'reinforcedPlating', level: 3, priority: 58 },
  );
  if (foes.filter(unit => unit.expiresTick !== undefined).length >= 4) wants.push({ unit: grove ? 'witch' : 'ashHexer', count: 3, priority: 65 });
  if (foes.filter(unit => UNIT_DEFS[unit.kind].abilities.includes('charge')).length >= 4) wants.push({ unit: grove ? 'lancer' : 'ashWarden', count: 4, priority: 64 });
  return wants;
}

export function bootstrapScripts(version: BootstrapAiVersion) {
  const family = version === 'v9_archer' ? V9_AI_STACK : version === 'v9_knight' ? V8_AI_STACK : V7_AI_STACK;
  return family.flatMap(script => {
    if (script === AI_SCRIPT_LIBRARY.v6Economy) return [miningWorkforce, bootstrapEconomy];
    if (version === 'v9_archer' && script === AI_SCRIPT_LIBRARY.v7Skirmish) return [archerMicro];
    if (version === 'v9_summoner' && script === AI_SCRIPT_LIBRARY.abilities) return [towerRushAbilities, summonerTowerRush];
    // Ferry and rescue assignments keep priority over local repair work.
    return script === AI_SCRIPT_LIBRARY.naval ? [script, battleRepair, shellEvasion] : [script];
  });
}

export function planBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext) {
  return planAiCommandEntriesFromScripts(snapshot, owner, bootstrapScripts(version), bootstrapPolicyContext(snapshot, owner, version, options));
}

export function bootstrapPolicyContext(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext): AiPolicyContext {
  const wants = supportWants(snapshot, owner, version, options);
  const expansion = wants.filter(want => 'bases' in want);
  return {
    ...options, version: 'v2', requestedVersion: version === 'v9_summoner' ? 'v7' : 'v9',
    // Economy and the general must pursue the same mine, including its camp and escort.
    doctrines: expansion.length === 0 ? BOOTSTRAP_DOCTRINES[version] : BOOTSTRAP_DOCTRINES[version].map(strategy => ({
      ...strategy, phases: strategy.phases.map(phase => ({ ...phase, wants: [...phase.wants, ...expansion] })),
    })),
    armyWants: wants.filter(want => !('bases' in want)),
  };
}
