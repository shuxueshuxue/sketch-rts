import { BUILDABLE_BUILDING_KINDS, TRAINABLE_UNIT_KINDS, UPGRADE_KINDS } from "./catalog";
import type { GameCommand, PlayerId } from "./types";
import type { CommandEnvelope } from "./net/types";

export function isGameCommand(value: unknown): value is GameCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.type === "move") return isStringArray(command.unitIds) && isNumber(command.x) && isNumber(command.y);
  if (command.type === "attackMove") return isStringArray(command.unitIds) && isNumber(command.x) && isNumber(command.y);
  if (command.type === "attack") return isStringArray(command.unitIds) && typeof command.targetId === "string";
  if (command.type === "mine") return isStringArray(command.unitIds) && typeof command.resourceId === "string";
  if (command.type === "repair") return isStringArray(command.unitIds) && typeof command.buildingId === "string";
  if (command.type === "build") return typeof command.unitId === "string" && isBuildableBuilding(command.buildingKind) && isNumber(command.x) && isNumber(command.y);
  if (command.type === "setRally") return isStringArray(command.buildingIds) && isNumber(command.x) && isNumber(command.y) && (command.target === undefined || isRallyTarget(command.target));
  if (command.type === "train") return typeof command.buildingId === "string" && isTrainableUnit(command.unitKind);
  if (command.type === "research") return typeof command.buildingId === "string" && isUpgradeKind(command.upgradeKind);
  if (command.type === "hire") return typeof command.campId === "string";
  if (command.type === "cast") {
    return (
      typeof command.unitId === "string" &&
      (command.ability === "heal" || command.ability === "summon" || command.ability === "curse") &&
      (command.targetId === undefined || typeof command.targetId === "string") &&
      (command.x === undefined || isNumber(command.x)) &&
      (command.y === undefined || isNumber(command.y))
    );
  }
  if (command.type === "pickupItem") return typeof command.unitId === "string" && typeof command.itemId === "string";
  if (command.type === "dropItem") return typeof command.unitId === "string" && typeof command.itemId === "string" && isNumber(command.x) && isNumber(command.y);
  if (command.type === "useItem") {
    return (
      typeof command.unitId === "string" &&
      typeof command.itemId === "string" &&
      (command.targetId === undefined || typeof command.targetId === "string") &&
      (command.x === undefined || isNumber(command.x)) &&
      (command.y === undefined || isNumber(command.y))
    );
  }
  return false;
}

export function isCommandEnvelope(value: unknown): value is CommandEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  return isPlayerId(envelope.playerId) && isGameCommand(envelope.command) && (envelope.clientSeq === undefined || Number.isInteger(envelope.clientSeq));
}

function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRallyTarget(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.type === "point") return true;
  if (target.type === "resource") return typeof target.resourceId === "string";
  if (target.type === "unit") return typeof target.unitId === "string";
  return false;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBuildableBuilding(value: unknown) {
  return typeof value === "string" && (BUILDABLE_BUILDING_KINDS as readonly string[]).includes(value);
}

function isTrainableUnit(value: unknown) {
  return typeof value === "string" && (TRAINABLE_UNIT_KINDS as readonly string[]).includes(value);
}

function isUpgradeKind(value: unknown) {
  return typeof value === "string" && (UPGRADE_KINDS as readonly string[]).includes(value);
}
