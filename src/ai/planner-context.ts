import { AI_SCRIPT_LIBRARY, AI_SCRIPT_VERSIONS, SKETCH_RTS_PRESET_AI_STACK, createAiPolicyMemory, planAiCommandEntriesFromScripts, type AiPolicyMemory, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import { planV2ProdAiCommandEntries } from "./policy-v2prod/core";
import type { CommandFrameEntry } from "../sdk/commands/frame";
import type { GameSnapshot, PlayerId } from "../shared/types";
import { bootstrapPolicyContext, bootstrapScripts, isBootstrapVersion } from "./bootstrap_1/policy";
import { planVeteranSkillCommands } from "./veteran-skills";
import { standingBodies } from "../shared/structure-bodies";
import { setBuildingBodies } from "../shared/terrain";
import { withLandRoadReuse } from "./bootstrap_1/safe-land-route";
import { beginExecutorReasons } from './executor-reasons';
import type { AiPolicyContext } from './policy/types';
import { planControlledBootstrapCommands, type BootstrapStrategyOutput } from './strategy/bootstrap-control';

export const DEFAULT_AI_PLANNER_VERSION: AiScriptVersion = "v2";

export type AiMemoryProvider = {
  get(owner: PlayerId): AiPolicyMemory | undefined;
  set?(owner: PlayerId, memory: AiPolicyMemory): void;
};

export type AiOwnerPlannerRequest<Source extends string = string> = {
  playerId: PlayerId;
  source?: Source;
  version?: AiScriptVersion;
  scripts?: AiScript[];
  scriptIds?: string[];
  memory?: AiPolicyMemory;
  disabledBehaviors?: PresetAiPolicyOptions["disabledBehaviors"];
  policyMode?: PresetAiPolicyOptions["policyMode"];
};

export type AiOwnerPlannerOptions = PresetAiPolicyOptions & {
  memoryProvider?: AiMemoryProvider;
  /** Temporary explicit gate while the first behavioral slice is validated. */
  strategyControl?: boolean;
  strategyObservation?: 'facts' | 'trace';
  /** Read-only output hook inside the existing owner-think geometry reuse scope. */
  observeBootstrapPlan?: (context: AiPolicyContext, entries: readonly CommandFrameEntry[], strategy?: BootstrapStrategyOutput) => void;
};

export function createAiMemoryProvider(memories: Record<PlayerId, AiPolicyMemory> = {}): AiMemoryProvider {
  return {
    get: (owner) => memories[owner],
    set: (owner, memory) => {
      memories[owner] = memory;
    },
  };
}

export function planAiOwnerCommandEntries<Source extends string = string>(snapshot: GameSnapshot, request: AiOwnerPlannerRequest<Source>, options: AiOwnerPlannerOptions = {}): CommandFrameEntry<Source>[] {
  const owner = request.playerId;
  if (!snapshot.players[owner]) return [];
  // The same bodies the sim stands on its map (see @@@structure-body): any other list restamps the shared overlay, and
  // every think redid the pathing it was handed.
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const { memoryProvider, observeBootstrapPlan, strategyControl, strategyObservation, ...policyOptions } = options;
  const version = request.version ?? options.version ?? DEFAULT_AI_PLANNER_VERSION;
  const memory = request.memory ?? options.memory ?? memoryForOwner(owner, memoryProvider);
  const policyMode = request.policyMode ?? options.policyMode;
  const disabledBehaviors = request.disabledBehaviors ?? options.disabledBehaviors;
  const withVeteranSkills = (entries: CommandFrameEntry<Source>[]): CommandFrameEntry<Source>[] => {
    const alreadyChosen = new Set(entries.flatMap(entry => entry.command.type === "learnVeteranSkill" ? [entry.command.unitId] : []));
    return [
      ...planVeteranSkillCommands(snapshot, owner).filter(command => !alreadyChosen.has(command.unitId)).map(command => ({
        playerId: owner,
        ...(request.source !== undefined ? { source: request.source } : {}),
        scriptId: "veteranSkills",
        command,
      })),
      ...entries,
    ];
  };
  if (isBootstrapVersion(version)) {
    return withLandRoadReuse(() => {
      const scripts = request.scripts || request.scriptIds ? scriptsForRequest(request, version) : bootstrapScripts(version);
      if (strategyControl) {
        const result = planControlledBootstrapCommands(snapshot, owner, version, [
          { id: 'veteranSkills', phase: 'tactics', run: () => planVeteranSkillCommands(snapshot, owner) }, ...scripts,
        ], { ...policyOptions, ...(policyMode ? { policyMode } : {}), ...(disabledBehaviors ? { disabledBehaviors } : {}),
          memory, executorReason: beginExecutorReasons(memory, snapshot.tick) },
        observeBootstrapPlan ? strategyObservation ?? 'trace' : 'none');
        const entries = result.entries.map(entry => ({ playerId: owner,
          ...(request.source !== undefined ? { source: request.source } : {}), ...entry }));
        observeBootstrapPlan?.(result.context, entries, result.strategy);
        return entries;
      }
      const context = bootstrapPolicyContext(snapshot, owner, version, {
        ...policyOptions,
        ...(policyMode ? { policyMode } : {}),
        ...(disabledBehaviors ? { disabledBehaviors } : {}),
        memory,
      });
      context.executorReason = beginExecutorReasons(memory, snapshot.tick);
      const entries = withVeteranSkills(planAiCommandEntriesFromScripts(snapshot, owner, scripts, context).map(entry => ({
        playerId: owner,
        ...(request.source !== undefined ? { source: request.source } : {}),
        scriptId: entry.scriptId,
        command: entry.command,
      })));
      observeBootstrapPlan?.(context, entries);
      return entries;
    });
  }
  // @@@frozen-v2-prod-brain - Production V2 is a frozen policy artifact that still plays through the live simulation core.
  if (version === "v2-prod") {
    if (request.scripts || request.scriptIds) throw new Error("v2-prod frozen planner does not accept live script overrides");
    return withVeteranSkills(planV2ProdAiCommandEntries(snapshot, owner, { ...policyOptions, ...(policyMode ? { policyMode } : {}), ...(disabledBehaviors ? { disabledBehaviors } : {}), memory }).map((entry) => ({
      playerId: owner,
      ...(request.source !== undefined ? { source: request.source } : {}),
      scriptId: entry.scriptId,
      command: entry.command,
    })));
  }

  const effectiveVersion = effectivePolicyVersion(version);
  const scripts = scriptsForRequest(request, version);

  return withVeteranSkills(planAiCommandEntriesFromScripts(snapshot, owner, scripts, {
    ...policyOptions,
    version: effectiveVersion,
    requestedVersion: version,
    ...(policyMode ? { policyMode } : {}),
    ...(disabledBehaviors ? { disabledBehaviors } : {}),
    memory,
  }).map((entry) => ({
    playerId: owner,
    ...(request.source !== undefined ? { source: request.source } : {}),
    scriptId: entry.scriptId,
    command: entry.command,
  })));
}

function memoryForOwner(owner: PlayerId, memoryProvider: AiMemoryProvider | undefined) {
  const memory = memoryProvider?.get(owner) ?? createAiPolicyMemory();
  memoryProvider?.set?.(owner, memory);
  return memory;
}

function effectivePolicyVersion(version: AiScriptVersion): AiScriptVersion {
  if (version === "v3" || version === "v3-grove" || version === "v3-ember" || version === "v5" || version === "v6" || version === "v7" || version === "v8" || version === "v9") return "v2";
  return version;
}

function scriptsForRequest(request: AiOwnerPlannerRequest, version: AiScriptVersion) {
  if (request.scripts) return request.scripts;
  if (request.scriptIds) return scriptsFromIds(request.scriptIds);
  return liveScriptsForVersion(version) ?? SKETCH_RTS_PRESET_AI_STACK;
}

function liveScriptsForVersion(version: AiScriptVersion): AiScript[] | undefined {
  if (version === "v2-prod" || isBootstrapVersion(version)) return undefined;
  return AI_SCRIPT_VERSIONS[version];
}

function scriptsFromIds(scriptIds: string[]): AiScript[] {
  return scriptIds.map((id) => {
    const script = AI_SCRIPT_LIBRARY[id as keyof typeof AI_SCRIPT_LIBRARY];
    if (!script) throw new Error(`Unknown AI script id ${id}`);
    return script;
  });
}
