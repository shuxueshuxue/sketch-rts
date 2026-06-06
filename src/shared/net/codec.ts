import type { ChatMessage, CheckpointFrame, CheckpointRequestClass, CheckpointRequestReason, ClientNetMessage, CommandFrame, RoomSyncEvent, RoomSyncEventKind, ServerNetMessage } from "./types";
import type { GameCommand, RoomState } from "../types";
import { checkpointRequestClass } from "./checkpoint-semantics";

export function encodeNetMessage(message: ClientNetMessage | ServerNetMessage): string {
  return JSON.stringify(message);
}

export function decodeClientNetMessage(raw: string): ClientNetMessage {
  const message = parseNetMessage(raw);
  if (!hasType(message)) throw new Error("Net message must be an object with a string type");
  if (message.type === "join") return decodeJoinMessage(message);
  if (message.type === "command") return decodeClientCommandMessage(message);
  if (message.type === "chat") return decodeClientChatMessage(message);
  if (message.type === "checksum") return decodeChecksumMessage(message);
  if (message.type === "syncEvent") return decodeSyncEventMessage(message);
  if (message.type === "requestCheckpoint") return decodeRequestCheckpointMessage(message);
  throw new Error(`Unknown client net message type ${message.type}`);
}

export function decodeServerNetMessage(raw: string): ServerNetMessage {
  const message = parseNetMessage(raw);
  if (!hasType(message)) throw new Error("Net message must be an object with a string type");
  if (message.type === "hello") return decodeHelloMessage(message);
  if (message.type === "frame") return decodeFrameMessage(message);
  if (message.type === "checkpoint") return decodeCheckpointMessage(message);
  if (message.type === "desync") return decodeDesyncMessage(message);
  if (message.type === "error") return decodeErrorMessage(message);
  if (message.type === "chat") return decodeServerChatMessage(message);
  if (message.type === "room") return decodeRoomMessage(message);
  throw new Error(`Unknown server net message type ${message.type}`);
}

function parseNetMessage(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid net message JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function decodeJoinMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId)) throw new Error("Malformed client join message");
  return { type: "join", roomId: message.roomId, playerId: message.playerId };
}

function decodeClientCommandMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId) || !isCommandLike(message.command)) throw new Error("Malformed client command message");
  return {
    type: "command",
    roomId: message.roomId,
    playerId: message.playerId,
    command: message.command,
    ...(Number.isInteger(message.clientSeq) ? { clientSeq: Number(message.clientSeq) } : {}),
  };
}

function decodeClientChatMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId) || !isString(message.senderName) || !isNonEmptyString(message.text)) throw new Error("Malformed client chat message");
  return { type: "chat", roomId: message.roomId, playerId: message.playerId, senderName: message.senderName, text: message.text };
}

function decodeChecksumMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId) || !Number.isInteger(message.tick) || !isString(message.hash)) throw new Error("Malformed client checksum message");
  return { type: "checksum", roomId: message.roomId, playerId: message.playerId, tick: Number(message.tick), hash: message.hash };
}

function decodeRequestCheckpointMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId)) throw new Error("Malformed checkpoint request message");
  return {
    type: "requestCheckpoint",
    roomId: message.roomId,
    playerId: message.playerId,
    ...(Number.isInteger(message.tick) ? { tick: Number(message.tick) } : {}),
    ...(isCheckpointReason(message.reason) ? { reason: message.reason } : {}),
    ...(Number.isInteger(message.clientTick) ? { clientTick: Number(message.clientTick) } : {}),
    ...(isString(message.clientChecksum) ? { clientChecksum: message.clientChecksum } : {}),
  };
}

function decodeSyncEventMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isRoomSyncEvent(message.event) || message.event.roomId !== message.roomId) throw new Error("Malformed client sync event message");
  return { type: "syncEvent", roomId: message.roomId, event: message.event };
}

function decodeHelloMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId) || !Number.isInteger(message.tick)) throw new Error("Malformed server hello message");
  return { type: "hello", roomId: message.roomId, playerId: message.playerId, tick: Number(message.tick) };
}

function decodeFrameMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isRecord(message.frame)) throw new Error("Malformed server frame message");
  return { type: "frame", frame: message.frame as CommandFrame };
}

function decodeCheckpointMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isRecord(message.checkpoint)) throw new Error("Malformed server checkpoint message");
  return { type: "checkpoint", checkpoint: message.checkpoint as CheckpointFrame };
}

function decodeDesyncMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isString(message.roomId) || !Number.isInteger(message.tick) || !isRecord(message.checksums)) throw new Error("Malformed server desync message");
  return { type: "desync", roomId: message.roomId, tick: Number(message.tick), checksums: message.checksums as Record<string, string> };
}

function decodeErrorMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isString(message.roomId) || !isString(message.message)) throw new Error("Malformed server error message");
  return { type: "error", roomId: message.roomId, message: message.message };
}

function decodeServerChatMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isChatMessage(message.message)) throw new Error("Malformed server chat message");
  return { type: "chat", message: message.message };
}

function decodeRoomMessage(message: Record<string, unknown>): ServerNetMessage {
  if (!isRecord(message.room)) throw new Error("Malformed server room message");
  return { type: "room", room: message.room as RoomState };
}

function hasType(value: unknown): value is Record<string, unknown> & { type: string } {
  return isRecord(value) && isString(value.type);
}

function isCommandLike(value: unknown): value is GameCommand {
  return isRecord(value) && isString(value.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isCheckpointReason(value: unknown): value is CheckpointRequestReason {
  return value === "initial-sync" || value === "late-catchup" || value === "frame-apply-error" || value === "server-desync" || value === "message-error" || value === "manual";
}

function isCheckpointRequestClass(value: unknown): value is CheckpointRequestClass {
  return value === "initial" || value === "catchup" || value === "manual" || value === "recovery";
}

function isRoomSyncEventKind(value: unknown): value is RoomSyncEventKind {
  return value === "frame-apply-error" || value === "server-desync" || value === "message-error" || value === "checkpoint-restore" || value === "checkpoint-request" || value === "checksum-mismatch";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isString);
}

function isRoomSyncEvent(value: unknown): value is RoomSyncEvent {
  if (!isRecord(value) || !isRoomSyncEventKind(value.kind) || !isString(value.roomId) || !isString(value.playerId) || !Number.isInteger(value.localTick)) return false;
  if (value.id !== undefined) return false;
  if (value.serverTick !== undefined && !Number.isInteger(value.serverTick)) return false;
  if (value.message !== undefined && !isString(value.message)) return false;
  if (value.frameTick !== undefined && !Number.isInteger(value.frameTick)) return false;
  if (value.frameSequence !== undefined && !Number.isInteger(value.frameSequence)) return false;
  if (value.reason !== undefined && !isCheckpointReason(value.reason)) return false;
  if (value.checkpointClass !== undefined && !isCheckpointRequestClass(value.checkpointClass)) return false;
  if (value.reason !== undefined && value.checkpointClass !== undefined && checkpointRequestClass(value.reason) !== value.checkpointClass) return false;
  if (value.clientChecksum !== undefined && !isString(value.clientChecksum)) return false;
  if (value.checksums !== undefined && !isStringRecord(value.checksums)) return false;
  if (value.recordedAt !== undefined) return false;
  return true;
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && isString(value.id) && isString(value.roomId) && isString(value.playerId) && isString(value.senderName) && isNonEmptyString(value.text) && Number.isFinite(value.sentAt);
}
