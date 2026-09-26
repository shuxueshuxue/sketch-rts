import type { GameCommand, GameSnapshot, PlayerId } from "../../../shared/types";
import { planSkirmishPreservation } from "../skirmish-tactics";
import { distance } from "../spatial";
import { planFocusFireCommand } from "../spell-tactics";
import type { PresetAiPolicyOptions } from "../types";
import { isBacklineKind } from "../v6/backline";

// @@@v7-leash - While V7's general defends a base on a leash (see v7-defend), focus fire works inside it: only units within
// the leash join, and only on a target within it. The runner keeps a later script from re-ordering a unit the general moved
// in the same think, not one it left fighting at the last: footmen the general had called back walked out again after a
// retreating archer, and seven of eight died 580 to 1000 paces from their defense point (mapleCircuit, 6:20).
export function planV7FocusFire(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  const command = planFocusFireCommand(snapshot, owner, options);
  const general = options.memory?.v6?.general;
  if (!command || command.type !== "attack" || general?.mode !== "defend" || general.leash === undefined || !general.target) return command;
  const point = general.target;
  const leash = general.leash;
  const target = snapshot.units.find((unit) => unit.id === command.targetId);
  if (!target || distance(target, point) > leash) return undefined;
  const unitIds = command.unitIds.filter((id) => {
    const unit = snapshot.units.find((candidate) => candidate.id === id);
    return unit !== undefined && distance(unit, point) <= leash;
  });
  return unitIds.length > 0 ? { ...command, unitIds } : undefined;
}

// @@@v7-one-voice - While the general holds ground (defending a base, guarding the main, holding the rally), it alone says
// where V7's front stands; the shared skirmish script keeps its say over the casters only. That script pulls a wounded
// unit to the main and walks a locally outnumbered group home: at V7's natural it pulled one footman to the main every
// other second and six at once at 6:20, and each time the general sent them back, so eight footmen walked between the two
// halls under ten archers' fire (mapleCircuit). The general steps its own wounded back to the hall behind the line.
const HOLDING_MODES = new Set(["defend", "guard", "hold"]);

export function planV7Skirmish(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands = planSkirmishPreservation(snapshot, owner, options);
  const mode = options.memory?.v6?.general?.mode;
  if (!mode || !HOLDING_MODES.has(mode)) return commands;
  const casters = new Set(snapshot.units.filter((unit) => unit.owner === owner && isBacklineKind(unit)).map((unit) => unit.id));
  return commands.flatMap((command): GameCommand[] => {
    if (!("unitIds" in command)) return [command];
    const unitIds = command.unitIds.filter((id) => casters.has(id));
    return unitIds.length > 0 ? [{ ...command, unitIds }] : [];
  });
}
