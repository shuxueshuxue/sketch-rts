import { isRangedUnit } from "./unit-weapon-class";
import { RULES_VERSION, savedRulesVersion } from "./rules-version";
import { canonicalizeSavedUnits, assertCanonicalSavedKinds } from "./unit-save-migration";
import { createGame, refreshUnitStats, restoreSnapshotIntoGame, snapshotGame, type Game } from "./sim";
import { upgradeSavedCombat } from "./combat-save-upgrade";
import { rollVeteranSkillChoices, veteranSkillFitsUnitClass, VETERAN_COMMON_SKILL_IDS, VETERAN_SPECIALIST_SKILLS, type VeteranSkillId } from "./veteran-skills";
import { unitClassOf } from "./unit-targeting";
import { CHECKSUM_VERSION, checksumGame } from "./sim/checksum";
import { weaponRules } from "./equipment";
import { UNIT_DEFS, UPGRADE_KINDS } from "./catalog";
import type { AiScriptVersion, GameSnapshot, PlayerId, PlayerStateMap, RoomState, UpgradeLevels } from "./types";

export const SAVEGAME_SCHEMA_VERSION = 1;

export type SaveGameRecord = {
  schemaVersion: typeof SAVEGAME_SCHEMA_VERSION;
  /** Absent only on pre-versioned historical saves. */
  rulesVersion?: number;
  id: string;
  label?: string;
  createdAt: string;
  room: RoomState;
  snapshot: GameSnapshot;
  runtime: {
    nextId: number;
    activePlayers: PlayerId[];
    teams: Record<PlayerId, string>;
    aiPlayers: PlayerId[];
    aiVersions?: Partial<Record<PlayerId, AiScriptVersion>>;
    // The game's checksum when saved, for comparing against later (restoring does not check it), and the
    // CHECKSUM_VERSION it was made with (absent: version 1). Older saves stay loadable: the schema is unchanged.
    checksum?: string;
    checksumVersion?: number;
  };
};

export type SaveGameInput = {
  id: string;
  label?: string;
};

export function parseSaveGameInput(value: unknown): SaveGameInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id.length === 0) return undefined;
  if (source.label !== undefined && typeof source.label !== "string") return undefined;
  return {
    id: source.id,
    ...(typeof source.label === "string" ? { label: source.label } : {}),
  };
}

export function assertSaveGameInput(value: unknown, label = "savegame input"): SaveGameInput {
  const input = parseSaveGameInput(value);
  if (!input) throw new Error(`Malformed ${label}`);
  return input;
}

export function createSaveGameRecord(game: Game, room: RoomState, input: SaveGameInput, now = new Date(), aiPlayers: PlayerId[] = game.aiPlayers, aiVersions: Partial<Record<PlayerId, AiScriptVersion>> = {}): SaveGameRecord {
  if (room.status !== "inMatch") throw new Error("Only live room matches can be saved");
  return {
    schemaVersion: SAVEGAME_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    id: input.id,
    ...(input.label ? { label: input.label } : {}),
    createdAt: now.toISOString(),
    room: clone(room),
    snapshot: clone(snapshotGame(game)),
    runtime: {
      nextId: game.nextId,
      activePlayers: [...game.activePlayers],
      teams: { ...game.teams },
      aiPlayers: [...aiPlayers],
      aiVersions: { ...aiVersions },
      checksum: checksumGame(game),
      checksumVersion: CHECKSUM_VERSION,
    },
  };
}

export function restoreGameFromSave(save: SaveGameRecord): Game {
  assertSaveGame(save);
  const races = Object.fromEntries(save.runtime.activePlayers.map((owner) => [owner, save.snapshot.players[owner]?.race ?? "grove"]));
  const options = {
    players: save.runtime.activePlayers,
    aiPlayers: save.runtime.aiPlayers,
    teams: save.runtime.teams,
    races,
    ...(save.runtime.aiVersions ? { aiVersions: save.runtime.aiVersions } : {}),
  };
  const game = createGame(save.snapshot.map.id, options);
  const olderCombatRules = (save.runtime.checksumVersion ?? 1) < 8;
  // Renamed-unit import belongs to rules 1. Later area-balance revisions must
  // not reinterpret canonical rules-2 snapshots or their paid queue prices.
  const migration = savedRulesVersion(save.rulesVersion) < 2 ? canonicalizeSavedUnits(save.snapshot) : undefined;
  const canonical = migration?.snapshot ?? save.snapshot;
  assertCanonicalSavedKinds(canonical);
  const snapshot = olderCombatRules ? upgradeSavedCombat(canonical) : canonical;
  restoreSnapshotIntoGame(game, { ...snapshot, teams: save.runtime.teams, players: normalizeSavedPlayers(snapshot.players, savedRulesVersion(save.rulesVersion)) }, save.runtime.nextId);
  game.activePlayers = [...save.runtime.activePlayers];
  // Canonical stats may differ; keep the exact living/dead HP, capped by the
  // new maximum. No percentage heal, cooldown reset, or veteran-choice reroll.
  if (migration) {
    const refresh = (unit: Game["units"][number]) => {
      if (migration.changedUnitIds.has(unit.id)) {
        const hp = unit.hp;
        if (unit.owner === "neutral" && !unit.variant) {
          const rules = weaponRules(game, unit);
          unit.maxHp = rules.hp;
          unit.speed = rules.speed;
          unit.radius = unit.bodyRadius = rules.radius;
          unit.attackDamage = rules.attackDamage;
          unit.attackRange = rules.attackRange;
          unit.attackCooldown = rules.attackCooldown;
        }
        refreshUnitStats(game, unit);
        unit.hp = Math.min(hp, unit.maxHp);
      }
      unit.cargo?.forEach(refresh);
    };
    game.units.forEach(refresh);
  }
  if (savedRulesVersion(save.rulesVersion) < 4) {
    const refreshShips = (unit: Game["units"][number]) => {
      if (UNIT_DEFS[unit.kind].naval) {
        const hp = unit.hp;
        if (unit.owner === "neutral") unit.maxHp = weaponRules(game, unit).hp;
        else refreshUnitStats(game, unit);
        unit.hp = Math.min(hp, unit.maxHp);
      }
      unit.cargo?.forEach(refreshShips);
    };
    game.units.forEach(refreshShips);
  }
  if (olderCombatRules) {
    for (const unit of game.units) {
      if (unit.owner === "neutral" || unit.level <= 0 || unit.hp <= 0 || (unit.variant && game.variants?.[unit.variant]?.heroic)) continue;
      const hp = unit.hp;
      refreshUnitStats(game, unit);
      unit.hp = Math.min(hp, unit.maxHp);
      if (unit.level >= 3 && unit.expiresTick === undefined && !unit.veteranSkillChoices) {
        unit.veteranSkillChoices = rollVeteranSkillChoices(unit.kind, unit.id, `${game.map.terrain?.ecology?.seed ?? game.map.id}:${game.tick}`, unitClassOf(unit, game), isRangedUnit(unit));
      }
    }
  }
  if ((save.runtime.checksumVersion ?? 1) < 9) upgradeUnitClassSkillChoices(game);
  // Earlier cruise references lack planned turn curvature and firing attitudes.
  // Keep the physical
  // pose, momentum and order, and build a fresh route on the next tick.
  if ((save.runtime.checksumVersion ?? 1) < 13) for (const unit of game.units) if (unit.sailing) {
    delete unit.sailing.route; delete unit.sailing.yawRate; delete unit.sailing.pursuit;
  }
  return game;
}

/** Preserve old choices except personal skills that can no longer affect the learner. */
function upgradeUnitClassSkillChoices(game: Game): void {
  for (const unit of game.units) {
    const unitClass = unitClassOf(unit, game);
    const eligible = (skill: VeteranSkillId) => veteranSkillFitsUnitClass(skill, unitClass);
    const lostSkill = unit.veteranSkill && !eligible(unit.veteranSkill);
    if (lostSkill) delete unit.veteranSkill;
    if (lostSkill && !unit.veteranSkillChoices) {
      unit.veteranSkillChoices = rollVeteranSkillChoices(unit.kind, unit.id, `${game.map.terrain?.ecology?.seed ?? game.map.id}:${game.tick}`, unitClass, isRangedUnit(unit));
    }
    const choices = unit.veteranSkillChoices;
    if (!choices?.some(skill => !eligible(skill))) continue;
    const retained = new Set(choices.filter(eligible));
    const replacements = [...(VETERAN_SPECIALIST_SKILLS[unit.kind] ?? []), ...VETERAN_COMMON_SKILL_IDS]
      .filter(skill => eligible(skill) && !retained.has(skill));
    unit.veteranSkillChoices = choices.map(skill => {
      if (eligible(skill)) return skill;
      const replacement = replacements.shift();
      if (!replacement) throw new Error(`No valid veteran replacement for ${unit.kind}`);
      return replacement;
    });
  }
}

export function assertSaveGame(save: SaveGameRecord) {
  savedRulesVersion(save.rulesVersion);
  if (save.schemaVersion !== SAVEGAME_SCHEMA_VERSION) throw new Error(`Unsupported savegame schema ${save.schemaVersion}`);
  if (save.room.status !== "inMatch") throw new Error("Savegame does not contain a live match");
  if (save.snapshot.map.id !== save.room.mapId) throw new Error("Savegame room/map mismatch");
  for (const owner of save.runtime.activePlayers) {
    if (!save.snapshot.players[owner]) throw new Error(`Savegame missing player state for ${owner}`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSavedPlayers(players: PlayerStateMap, rulesVersion: number): PlayerStateMap {
  const cloned = clone(players);
  for (const player of Object.values(cloned)) {
    if (rulesVersion < 4) player.upgrades.shipbuilding ??= 0;
    player.upgrades = normalizeUpgradeLevels(player.upgrades);
  }
  return cloned;
}

function normalizeUpgradeLevels(upgrades: unknown): UpgradeLevels {
  if (!upgrades || typeof upgrades !== "object" || Array.isArray(upgrades)) throw new Error("Save upgrade levels must use the current upgrade map shape");
  return Object.fromEntries(
    UPGRADE_KINDS.map((upgradeKind) => {
      const value = (upgrades as Partial<Record<string, unknown>>)[upgradeKind];
      if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`Save upgrade ${upgradeKind} must be a non-negative integer`);
      return [upgradeKind, Number(value)];
    }),
  ) as UpgradeLevels;
}
