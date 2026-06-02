import type { CheckpointFrame, ClientNetMessage, CommandFrame, ServerNetMessage } from "./types";
import type { GameCommand, RoomState } from "../types";

export function encodeNetMessage(message: ClientNetMessage | ServerNetMessage): string {
  return JSON.stringify(message);
}

export function decodeClientNetMessage(raw: string): ClientNetMessage {
  const message = parseNetMessage(raw);
  if (!hasType(message)) throw new Error("Net message must be an object with a string type");
  if (message.type === "join") return decodeJoinMessage(message);
  if (message.type === "command") return decodeClientCommandMessage(message);
  if (message.type === "checksum") return decodeChecksumMessage(message);
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

function decodeChecksumMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId) || !isString(message.playerId) || !Number.isInteger(message.tick) || !isString(message.hash)) throw new Error("Malformed client checksum message");
  return { type: "checksum", roomId: message.roomId, playerId: message.playerId, tick: Number(message.tick), hash: message.hash };
}

function decodeRequestCheckpointMessage(message: Record<string, unknown>): ClientNetMessage {
  if (!isString(message.roomId)) throw new Error("Malformed checkpoint request message");
  return { type: "requestCheckpoint", roomId: message.roomId, ...(Number.isInteger(message.tick) ? { tick: Number(message.tick) } : {}) };
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
