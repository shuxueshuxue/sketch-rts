import { UNIT_DEFS } from '../../shared/catalog';
import type { BootstrapAiVersion, GameSnapshot, PlayerId } from '../../shared/types';
import { V5_HYBRID_AI_STACK, V7_AI_STACK, V8_AI_STACK, planAiCommandEntriesFromScripts } from '../policy/core';
import { isOpponentOwner } from '../policy/ownership';
import type { AiPolicyContext } from '../policy/types';
import { V6_STRATEGIES, v7Phases, type V6Strategy, type V6Want } from '../policy/v6/doctrine';
import { V8_STRATEGIES } from '../policy/v8/doctrine';

export const BOOTSTRAP_VERSIONS = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
export function isBootstrapVersion(version: string): version is BootstrapAiVersion {
  return version === 'v9_archer' || version === 'v9_summoner' || version === 'v9_knight';
}

export const BOOTSTRAP_DOCTRINES: Record<BootstrapAiVersion, V6Strategy[]> = {
  v9_archer: [],
  v9_summoner: V6_STRATEGIES.map(strategy=>({...strategy,phases:v7Phases(strategy)})),
  v9_knight: V8_STRATEGIES.map(strategy=>({...strategy,phases:v7Phases(strategy)})),
};

function supportWants(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): V6Want[] {
  const army = snapshot.units.filter(unit=>unit.owner===owner && unit.kind!=='worker' && unit.expiresTick===undefined);
  if (army.length<10) return [];
  const foes=snapshot.units.filter(unit=>isOpponentOwner(snapshot,owner,unit.owner,options));
  const grove=snapshot.players[owner]!.race==='grove';
  const wants:V6Want[]=[
    {building:grove ? 'barracks' : 'emberForge',count:2,priority:57},
    {upgrade:'weaponTraining',level:3,priority:59},
    {upgrade:'reinforcedPlating',level:3,priority:58},
  ];
  if(foes.filter(unit=>unit.expiresTick!==undefined).length>=4)wants.push({unit:grove?'witch':'ashHexer',count:3,priority:65});
  if(foes.filter(unit=>UNIT_DEFS[unit.kind].abilities.includes('charge')).length>=4)wants.push({unit:grove?'lancer':'ashWarden',count:4,priority:64});
  return wants;
}
export function planBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext) {
  if(version==='v9_archer')return planAiCommandEntriesFromScripts(snapshot,owner,V5_HYBRID_AI_STACK,{...options,version:'v2',requestedVersion:'v5'});
  const family=version==='v9_knight' ? V8_AI_STACK : V7_AI_STACK;
  const stack=family;
  return planAiCommandEntriesFromScripts(snapshot, owner, stack, {
    ...options, version:'v2', requestedVersion:version==='v9_knight' ? 'v8' : 'v7', doctrines:BOOTSTRAP_DOCTRINES[version], armyWants:supportWants(snapshot,owner,options),
  });
}
