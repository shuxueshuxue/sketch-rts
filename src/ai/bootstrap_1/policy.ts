import { canResearchAt, UNIT_DEFS, UPGRADE_DEFS, requiredSupplyCap, trainingBuildingFor, unitMover } from '../../shared/catalog';
import { shopping } from './shopping';
import type { BootstrapAiVersion, GameSnapshot, PlayerId, PlayerState, Unit } from '../../shared/types';
import { isBacklineKind } from '../policy/v6/backline';
import { availableV6Army, V7_WOUNDED_SHARE } from '../policy/v6/general';
import { combatRating } from '../policy/v6/strength';
import { activeCamp, campContested, creepForce, EXPANSION_GUARD_RANGE, forceFor, neutralCamps } from '../policy/v7/creep';
import { averagePoint, distance } from '../policy/spatial';
import { bootstrapExpansionMine } from './expansion-target';
import { activeMiningBaseCount } from '../policy/expansion-model';
import { AI_SCRIPT_LIBRARY, V9_AI_STACK, V7_AI_STACK, V8_AI_STACK, planAiCommandEntriesFromScripts } from '../policy/core';
import { isOpponentOwner } from '../policy/ownership';
import type { AiPolicyContext } from '../policy/types';
import { V6_STRATEGIES, v7Phases, type V6Strategy, type V6Want } from '../policy/v6/doctrine';
import { V8_STRATEGIES } from '../policy/v8/doctrine';
import { ARCHER_DOCTRINES } from './archer-doctrine';
import { archerMicro } from './archer-micro';
import { battleRepair } from './repair';
import { miningWorkforce } from './workforce';
import { miningAssignments } from './mining-assignments';
import { mainArmyIntel, mineDefense, miningRally, miningLeash, recordMiningGeneralCommands, planBootstrapCloseout, planBootstrapGeneral } from './mine-defense';
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
import { expansionMissionUnitIds, migrateExpansionClaims, prepareExpansionMission } from './expansion-mission';
import { expansionGarrison, garrisonRecoveryCommands, maintainExpansionGarrisons } from './expansion-garrison';

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

// @@@expansion-guard-force - The next base waits on its mine's camp, the camp on a group that can take it, and a phase that
// waits on that base never asks for more soldiers: six ravagers stood at 4.97 of the 5.01 an ogre camp needs and the knight
// AI banked 1600 gold on one base until 8:00 (ladder-12 v9_knight ember, v5-final-1). While the mine it takes next is
// guarded beyond its front and the phase it waits in has every soldier it lists, the AI trains its line's soldier until the
// front can take the camp. A requested expansion now asks for that force immediately, without waiting for unrelated
// phase quotas, and includes the same dynamic third-base request as the economy.
function expansionGuardWant(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext): V6Want[] {
  if (options.memory.landExpansion?.paused) return [];
  const race = snapshot.players[owner]!.race, chosen = options.memory.v6?.doctrine?.strategyId;
  const strategies = BOOTSTRAP_DOCTRINES[version].filter(strategy => strategy.race === race);
  const strategy = strategies.find(candidate => candidate.id === chosen) ?? strategies[0]!;
  const phase = strategy.phases[Math.min(options.memory.v6?.phase ?? 0, strategy.phases.length - 1)]!;
  const count = (kind: string) => snapshot.units.filter(unit => unit.owner === owner && unit.kind === kind).length;
  const army = snapshot.units.filter(unit => unit.owner === owner && unit.kind !== 'worker' && unit.expiresTick === undefined);
  const wantedBases = Math.max(phase.advanceBases ?? 0, roomExpansionTarget(snapshot, owner, army),
    ...phase.wants.map(want => 'bases' in want ? want.bases : 0));
  if (activeMiningBaseCount(snapshot, owner) >= wantedBases) return [];
  // The army the general clears the guard with, as planBootstrapGeneral sees it: without the mine's detachment, the hired
  // and shopping and caring crews (see mainArmyIntel), and only those free to march (see availableV6Army). Counted from
  // the whole army it found six lancers enough for an ogre guard the general's five could not take, wanted none more, and
  // the main sat on one mine from 2:30 to 9:00 banking 1675 gold (ladder-43, V9 knight against V9).
  const intel = mainArmyIntel(snapshot, owner, options);
  const mine = bootstrapExpansionMine(snapshot, owner, intel, options);
  const camps = neutralCamps(snapshot);
  const guard = activeCamp(options.memory.landExpansion?.combat?.creep, camps)
    ?? (mine && camps.find(camp => distance(camp.center, mine) <= EXPANSION_GUARD_RANGE));
  if (!guard) return [];
  const front = availableV6Army(snapshot, options, intel).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  const assault = new Set(options.memory.landAttack?.general.group), members = new Set(expansionMissionUnitIds(options.memory));
  const available = front.filter(unit => unit.hp >= unit.maxHp * V7_WOUNDED_SHARE
    && (!assault.has(unit.id) || members.has(unit.id) || activeMiningBaseCount(snapshot, owner) === 0));
  const missing = forceFor(guard) - creepForce(available, guard);
  const contested = options.memory.landExpansion && available.length > 0
    && (campContested(intel, guard.center, available) || campContested(intel, averagePoint(available), available));
  if (missing <= 0 && !contested) return [];
  const unit = strategy.standIn, def = UNIT_DEFS[unit];
  const rating = combatRating({ kind: unit, hp: def.hp, maxHp: def.hp, attackDamage: def.attackDamage, attackCooldown: def.attackCooldown } as Unit);
  return [{ unit, count: count(unit) + Math.max(contested ? 1 : 0, Math.ceil(missing / rating)), priority: 80 }];
}

function roomExpansionTarget(snapshot: GameSnapshot, owner: PlayerId, army: Unit[]) {
  // Two working mines can fund a third with four healthy escorts; the selected camp still has to pass its force test.
  const escort = army.filter(unit => !unit.deck && unitMover(unit.kind) === 'land' && !isBacklineKind(unit)
    && unit.attackDamage > 0 && unit.hp >= unit.maxHp * .6);
  return Math.max(army.length >= 10 ? 1 + Math.floor(army.length / 5) : 0,
    activeMiningBaseCount(snapshot, owner) >= 2 && escort.length >= 4 ? 3 : 0);
}

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
  const guard = expansionGuardWant(snapshot, owner, version, options);
  const expansion = roomExpansionTarget(snapshot, owner, army);
  if (army.length < 10) return [...(expansion ? [{ bases: expansion, priority: 76 }] : []), ...guard, ...counters, ...medical, ...mounted];
  const main = version === 'v9_knight' ? (grove ? 'knight' : 'ashChieftain')
    : version === 'v9_summoner' ? 'summoner' : (grove ? 'horseArcher' : 'sparkArcher');
  const producer = trainingBuildingFor(snapshot.players[owner]!.race, main)!;
  const wants: V6Want[] = [
    { bases: expansion, priority: 76 },
    { building: producer, count: 2, priority: 57 },
  ];
  if (version === 'v9_knight' && army.filter(unit => unit.kind === main).length >= 4) {
    wants.push({ unit: grove ? 'ballista' : 'catapult', count: 2, priority: 64 });
  }
  // Weapons and plating scale every land combat unit the player trains (see @@@share-of-own-stats): for the spirit host
  // that is its whole paid army (the summoners themselves, priests, catapults, wardens), though not the spirits it
  // summons. Left at 0/0 it lost the 10-20 minute fights against V9's 2/2 with more gold in the field (15 of 21 losses).
  wants.push(
    { upgrade: 'weaponTraining', level: 3, priority: 59 },
    { upgrade: 'reinforcedPlating', level: 3, priority: 58 },
  );
  // Dispel and healing share a production queue in Grove; counter the incoming wave before queuing recovery.
  wants.push(...guard, ...counters, ...medical, ...mounted);
  return wants;
}

export function bootstrapScripts(version: BootstrapAiVersion) {
  const family = version === 'v9_archer' ? V9_AI_STACK : version === 'v9_knight' ? V8_AI_STACK : V7_AI_STACK;
  return family.filter(script => script !== AI_SCRIPT_LIBRARY.v6Closeout).flatMap(script => {
    if (script === AI_SCRIPT_LIBRARY.items) return [{ ...script, run: planLootItemCommands }];
    if (script === AI_SCRIPT_LIBRARY.shopping) return [shopping];
    if (script === AI_SCRIPT_LIBRARY.battlefield) return [campRecovery, frontRecovery, miningRally, miningLeash, expansionGarrison, mountedField, script];
    if (script === AI_SCRIPT_LIBRARY.v6General) return [
      summonedRaids,
      { ...AI_SCRIPT_LIBRARY.v6Closeout, run: planBootstrapCloseout },
      { ...script, run: planBootstrapGeneral, onCommands: recordMiningGeneralCommands,
        claimsUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
          return new Set([...script.claimsUnits!(snapshot, owner, options),
            ...(options.memory.landExpansion?.paused ? [] : expansionMissionUnitIds(options.memory))]);
        } },
    ];
    if (script === AI_SCRIPT_LIBRARY.v6Backline) return [
      version === 'v9_summoner' ? { ...script, run: planSummonerScreen } : { ...script, run: planBootstrapCasterScreen }];
    if (script === AI_SCRIPT_LIBRARY.v6Economy) return [miningWorkforce, bootstrapEconomy];
    if (script === AI_SCRIPT_LIBRARY.v7Skirmish) {
      const micro = version === 'v9_archer' ? archerMicro : script;
      return [{ ...micro, run(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
        const commands = micro.run(snapshot, owner, options);
        return garrisonRecoveryCommands(snapshot, owner, options, commands === undefined ? [] : Array.isArray(commands) ? commands : [commands]);
      } }];
    }
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
  return planAiCommandEntriesFromScripts(snapshot, owner, bootstrapScripts(version), bootstrapPolicyContext(snapshot, owner, version, options));
}

export function researchPrerequisites(wants: readonly V6Want[], player: PlayerState): V6Want[] {
  return wants.flatMap(want => {
    if (!('upgrade' in want) || !(player.upgrades[want.upgrade] < want.level)) return [];
    const building = UPGRADE_DEFS[want.upgrade].researchBuildingKinds.find(kind => canResearchAt(player.race, kind, want.upgrade));
    return building ? [{ building, count: 1, priority: want.priority }] : [];
  });
}

export function bootstrapPolicyContext(snapshot: GameSnapshot, owner: PlayerId, version: BootstrapAiVersion, options: AiPolicyContext): AiPolicyContext {
  migrateExpansionClaims(snapshot, options.memory);
  maintainExpansionGarrisons(snapshot, owner, options);
  const wants = supportWants(snapshot, owner, version, options);
  const expansion = wants.filter(want => 'bases' in want);
  const player = snapshot.players[owner]!;
  const context: AiPolicyContext = {
    ...options, version: 'v2', requestedVersion: version === 'v9_summoner' ? 'v7' : 'v9',
    // Economy and the general must pursue the same mine, including its camp and escort.
    doctrines: BOOTSTRAP_DOCTRINES[version].map(strategy => ({
      ...strategy, phases: strategy.phases.map(phase => ({ ...phase,
        wants: [...phase.wants, ...expansion, ...researchPrerequisites([...phase.wants, ...wants], player)],
      })),
    })),
    armyWants: wants.filter(want => !('bases' in want)),
  };
  prepareExpansionMission(snapshot, owner, context, mainArmyIntel(snapshot, owner, context));
  return context;
}
