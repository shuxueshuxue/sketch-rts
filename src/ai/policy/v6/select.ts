import type { GameSnapshot, PlayerId } from "../../../shared/types";
import type { AiPolicyContext } from "../types";
import { playerState } from "../world-model";
import { isV7Policy, isV8Policy, isV9Policy } from "../versions";
import { V8_STRATEGIES } from "../v8/doctrine";
import { V9_STRATEGIES } from "../v9/doctrine";
import { V6_PROFILES, V6_STRATEGIES, v7Phases, type V6Profile, type V6Strategy } from "./doctrine";
import { recordPlay, v6Memory } from "./memory";
import { gameRng } from "./rng";

// The personality and strategy are drawn once, at V6's first look at the game, by weight.
export function v6Doctrine(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): { profile: V6Profile; strategy: V6Strategy } {
  const memory = v6Memory(options);
  const known = memory.doctrine;
  const profile = known && V6_PROFILES.find((candidate) => candidate.id === known.profileId);
  const table = isV9Policy(options) ? V9_STRATEGIES : isV8Policy(options) ? V8_STRATEGIES : V6_STRATEGIES;
  const strategy = known && table.find((candidate) => candidate.id === known.strategyId);
  if (profile && strategy) return { profile, strategy: forVersion(strategy, options) };
  const race = playerState(snapshot, owner).race;
  const rng = gameRng(snapshot, owner, "v6-doctrine");
  const pickedProfile = rng.pick(V6_PROFILES.map((candidate) => [candidate, candidate.weight] as const));
  const pickedStrategy = rng.pick(table.filter((candidate) => candidate.race === race).map((candidate) => [candidate, candidate.weight] as const));
  memory.doctrine = { profileId: pickedProfile.id, strategyId: pickedStrategy.id, decidedTick: snapshot.tick };
  recordPlay(memory, `profile:${pickedProfile.id}`);
  recordPlay(memory, `strategy:${pickedStrategy.id}`);
  return { profile: pickedProfile, strategy: forVersion(pickedStrategy, options) };
}

// V7 plays V6's strategies behind its own opening (see v7Phases); V8 and V9 their own (see v8-doctrine, v9-doctrine) behind the same.
function forVersion(strategy: V6Strategy, options: AiPolicyContext): V6Strategy {
  return isV7Policy(options) ? { ...strategy, phases: v7Phases(strategy) } : strategy;
}
