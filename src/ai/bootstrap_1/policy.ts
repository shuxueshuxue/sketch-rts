import { homeRelief } from './home-relief';
import { idleWorkerEvasion } from './idle-worker-evasion';
import { loadingApproach } from './loading-approach';
import { ABILITY_DEFS, canResearchAt, UNIT_DEFS, UPGRADE_DEFS, requiredSupplyCap, trainingBuildingFor } from '../../shared/catalog';
import { shopping } from './shopping';
import type { AbilityKind, BootstrapAiVersion, GameCommand, GameSnapshot, PlayerId, PlayerState } from '../../shared/types';
import { AI_SCRIPT_LIBRARY, V9_AI_STACK, V7_AI_STACK, V8_AI_STACK, planAiCommandEntriesFromScripts, planEconomy } from '../policy/core';
import { isOpponentOwner } from '../policy/ownership';
import type { AiCommandEntry, AiPolicyContext, AiScript } from '../policy/types';
import { combatDeckRecovery, preserveLateCrewCharge } from './deck-recovery';
import { V6_STRATEGIES, v7Phases, type V6Strategy, type V6Want } from '../policy/v6/doctrine';
import { V8_STRATEGIES } from '../policy/v8/doctrine';
import { ARCHER_DOCTRINES } from './archer-doctrine';
import { archerMicro } from './archer-micro';
import { battleRepair } from './repair';
import { miningWorkforce } from './workforce';
import { miningAssignments } from './mining-assignments';
import { miningApproachOutsideFire } from './mining-fire';
import { mineDefense, planBootstrapCloseout, planBootstrapGeneral } from './mine-defense';
import { miningJobSafety } from './mining-job-defense';
import { bootstrapEconomy } from './economy';
import { shellEvasion } from './shell-evasion';
import { summonerTowerRush, towerRushAbilities } from './tower-rush';
import { planBootstrapCasterScreen } from './caster-screen';
import { planSummonerScreen } from './summoner-screen';
import { mountedRecruitment } from './mounted-recruitment';
import { mountedTasks } from './mounted-tasks';
import { bootstrapAbilities } from './weapon-targets';
import { medicalRecovery, recoveryPatients } from './medical-recovery';
import { mobileCare } from './mobile-care';
import { expeditionRecoveryUnitIds, planBootstrapNaval } from './expedition-recovery';
import { navalUnitIds } from '../policy/naval';
import { mercenaryControl } from './mercenary-control';
import { campRecovery } from './camp-recovery';
import { frontRecovery } from './front-recovery';
import { lootRecovery, planLootItemCommands } from './loot-recovery';
import { summonedRaids } from './summoned-raids';
import { mountedField } from './mounted-field';

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
    phases: v7Phases(strategy).map((phase, index) => ({
      ...phase,
      wants: [
        // Once the natural and opening screen stand, unlock the heavy line before filling the light cavalry quota.
        ...(index === 1 ? [{ unit: strategy.race === 'grove' ? 'knight' as const : 'ashChieftain' as const, count: 4, priority: 62 }] : []),
        ...phase.wants.map(want => 'building' in want && want.building === 'emberForge'
          ? { ...want, building: trainingBuildingFor('ember', 'ashChieftain')! } : want),
      ],
    })),
  })),
};

function supportWants(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext): V6Want[] {
  const army = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unit.expiresTick === undefined);
  const grove = snapshot.players[owner]!.race === 'grove';
  const healer = 'priest';
  const recovering = recoveryPatients(snapshot, owner).length > 0;
  const medical: V6Want[] = (version === 'v9_archer' || recovering) && (army.length >= 10
    || snapshot.players[owner]!.supplyCap >= requiredSupplyCap(healer)
      && (recovering || snapshot.buildings.some(building => building.owner === owner && building.complete && building.kind === trainingBuildingFor(snapshot.players[owner]!.race, healer))))
    ? [{ unit: healer, count: Math.min(2, Math.max(1, Math.floor(army.length / 5))), priority: 65 }] : [];
  const mounted = mountedRecruitment(snapshot, owner, options);
  const foes = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options));
  const counters: V6Want[] = [];
  if (foes.filter(unit => unit.expiresTick !== undefined).length >= 4) counters.push({ unit: grove ? 'witch' : 'ashHexer', count: 3, priority: 67 });
  if (foes.filter(unit => UNIT_DEFS[unit.kind].abilities.includes('charge')).length >= 4
    || version === 'v9_summoner' && foes.some(unit => UNIT_DEFS[unit.kind].weapon?.delivery === 'shell'
      || UNIT_DEFS[unit.kind].weapon?.maxHits! > 1)) counters.push({ unit: grove ? 'lancer' : 'ashWarden', count: 4, priority: 64 });
  if (army.length < 10) return [...counters, ...medical, ...mounted];
  const main = version === 'v9_knight' ? (grove ? 'knight' : 'ashChieftain')
    : version === 'v9_summoner' ? 'summoner' : (grove ? 'horseArcher' : 'sparkArcher');
  const producer = trainingBuildingFor(snapshot.players[owner]!.race, main)!;
  const wants: V6Want[] = [
    { bases: 1 + Math.floor(army.length / 5), priority: 76 },
    { building: producer, count: 2, priority: 57 },
  ];
  if (version === 'v9_knight' && army.filter(unit => unit.kind === main).length >= 4) {
    wants.push({ unit: grove ? 'ballista' : 'catapult', count: 2, priority: 64 });
  }
  // The spirit host fights through summons, which these upgrades do not affect.
  if (version !== 'v9_summoner') wants.push(
    { upgrade: 'weaponTraining', level: 3, priority: 59 },
    { upgrade: 'reinforcedPlating', level: 3, priority: 58 },
  );
  // Dispel and healing share a production queue in Grove; counter the incoming wave before queuing recovery.
  wants.push(...counters, ...medical, ...mounted);
  return wants;
}

export function bootstrapScripts(version: BootstrapAiVersion) {
  const family = version === 'v9_archer' ? V9_AI_STACK : version === 'v9_knight' ? V8_AI_STACK : V7_AI_STACK;
  return family.filter(script => script !== AI_SCRIPT_LIBRARY.v6Closeout).flatMap(script => {
    if (script === AI_SCRIPT_LIBRARY.economy) return [{ ...script,
      run: (snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) => planEconomy(snapshot, owner, options,
        (worker, mine) => miningApproachOutsideFire(snapshot, owner, worker, mine, options)) }];
    if (script === AI_SCRIPT_LIBRARY.items) return [{ ...script, run: planLootItemCommands }];
    if (script === AI_SCRIPT_LIBRARY.shopping) return [shopping];
    if (script === AI_SCRIPT_LIBRARY.battlefield) return [campRecovery, frontRecovery, mountedField, script];
    if (script === AI_SCRIPT_LIBRARY.v6General) return [
      summonedRaids,
      { ...AI_SCRIPT_LIBRARY.v6Closeout, run: planBootstrapCloseout },
      { ...script, run: planBootstrapGeneral },
    ];
    if (script === AI_SCRIPT_LIBRARY.v6Backline) return [
      version === 'v9_summoner' ? { ...script, run: planSummonerScreen } : { ...script, run: planBootstrapCasterScreen }];
    if (script === AI_SCRIPT_LIBRARY.v6Economy) return [miningWorkforce, bootstrapEconomy];
    if (version === 'v9_archer' && script === AI_SCRIPT_LIBRARY.v7Skirmish) return [archerMicro];
    if (script === AI_SCRIPT_LIBRARY.allySupport) return [mobileCare, mountedTasks, lootRecovery, mercenaryControl, script];
    if (script === AI_SCRIPT_LIBRARY.abilities) return version === 'v9_summoner'
      ? [medicalRecovery, towerRushAbilities, summonerTowerRush] : [medicalRecovery, bootstrapAbilities];
    // Ferry and rescue assignments keep priority over local repair work.
    return script === AI_SCRIPT_LIBRARY.naval ? [{ ...script, run: planBootstrapNaval,
      claimsUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
        const riders = mountedTasks.claimsUnits!(snapshot, owner, options);
        const recovering = expeditionRecoveryUnitIds(snapshot, owner, options);
        return navalUnitIds(snapshot, owner, options, unit => !riders.has(unit.id) || recovering.has(unit.id));
      },
    }, miningJobSafety, miningAssignments, battleRepair, shellEvasion, mineDefense] : [script];
  });
}

export function planBootstrapCommands(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext) {
  return planBootstrapScriptEntries(snapshot, owner, bootstrapScripts(version), bootstrapPolicyContext(snapshot, owner, version, options));
}

/** Local deck micro sees every accepted task, including later items and abilities. */
export function planBootstrapScriptEntries(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: AiPolicyContext): AiCommandEntry[] {
  const healed = new Map<string, Set<AbilityKind>>();
  const entries = preserveLateCrewCharge(snapshot, owner, planAiCommandEntriesFromScripts(snapshot, owner, scripts, options).filter(({ command }) => {
    if (command.type !== 'cast' || command.queued || ABILITY_DEFS[command.ability].behavior !== 'heal') return true;
    const caster = snapshot.units.find(unit => unit.id === command.unitId);
    const target = snapshot.units.find(unit => unit.id === command.targetId);
    if (!caster || !target || Math.hypot(caster.x - target.x, caster.y - target.y) > ABILITY_DEFS[command.ability].range) return true;
    // Naval and medical work share one immediate spell publication. Keep the
    // earlier accepted assignment; queued and walk-to-cast orders stay intact.
    const spells = healed.get(caster.id);
    if (spells?.has(command.ability)) return false;
    if (spells) spells.add(command.ability); else healed.set(caster.id, new Set([command.ability]));
    return true;
  }));
  if (!scripts.some(script => script.id === AI_SCRIPT_LIBRARY.naval.id)) return entries;
  const planned = entries.map(entry => entry.command);
  const final = combatDeckRecovery(snapshot, owner, options, planned);
  let recovered = entries;
  if (final !== planned) {
    const byCommand = new Map<GameCommand, AiCommandEntry[]>();
    for (const entry of entries) byCommand.set(entry.command, [...(byCommand.get(entry.command) ?? []), entry]);
    recovered = final.map(command => byCommand.get(command)?.shift() ?? { scriptId: AI_SCRIPT_LIBRARY.naval.id, command });
  }
  const approaches = loadingApproach(snapshot, owner, options, recovered.map(entry => entry.command));
  const navalEntries = approaches.length ? [...recovered, ...approaches.map(command => ({ scriptId: AI_SCRIPT_LIBRARY.naval.id, command }))] : recovered;
  const relief = homeRelief(snapshot, owner, options, navalEntries.map(entry => entry.command));
  const controlled = new Set(['move', 'attack', 'attackMove', 'board', 'unload', 'stop', 'holdPosition', 'follow']);
  const reliefEntries = navalEntries.flatMap(entry => {
    const command = entry.command;
    if (controlled.has(command.type) && 'unitIds' in command) {
      const unitIds = command.unitIds.filter(id => !relief.claimed.has(id));
      return unitIds.length ? [{ ...entry, command: { ...command, unitIds } }] : [];
    }
    return [entry];
  });
  reliefEntries.push(...relief.commands.map(command => ({ scriptId: 'homeRelief', command })));
  const evasion = idleWorkerEvasion(snapshot, owner, options, reliefEntries.map(entry => entry.command));
  return evasion.length ? [...reliefEntries, ...evasion.map(command => ({ scriptId: 'idleWorkerEvasion', command }))] : reliefEntries;
}

export function researchPrerequisites(wants: readonly V6Want[], player: PlayerState): V6Want[] {
  return wants.flatMap(want => {
    if (!('upgrade' in want) || !(player.upgrades[want.upgrade] < want.level)) return [];
    const building = UPGRADE_DEFS[want.upgrade].researchBuildingKinds.find(kind => canResearchAt(player.race, kind, want.upgrade));
    return building ? [{ building, count: 1, priority: want.priority }] : [];
  });
}

export function bootstrapPolicyContext(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext): AiPolicyContext {
  const wants = supportWants(snapshot, owner, version, options);
  const expansion = wants.filter(want => 'bases' in want);
  const player = snapshot.players[owner]!;
  return {
    ...options, version: 'v2', requestedVersion: version === 'v9_summoner' ? 'v7' : 'v9',
    // Economy and the general must pursue the same mine, including its camp and escort.
    doctrines: BOOTSTRAP_DOCTRINES[version].map(strategy => ({
      ...strategy, phases: strategy.phases.map(phase => ({ ...phase,
        wants: [...phase.wants, ...expansion, ...researchPrerequisites([...phase.wants, ...wants], player)],
      })),
    })),
    armyWants: wants.filter(want => !('bases' in want)),
  };
}
