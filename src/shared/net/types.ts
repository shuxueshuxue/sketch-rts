import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../types";

export type ChatMessage = {
  id: string;
  roomId: string;
  playerId: PlayerId;
  senderName: string;
  text: string;
  sentAt: number;
};

export type CommandEnvelope = {
  playerId: PlayerId;
  command: GameCommand;
  clientSeq?: number;
};

export type CommandFrame = {
  roomId: string;
  tick: number;
  sequence: number;
  commands: CommandEnvelope[];
};

export type ChecksumFrame = {
  roomId: string;
  tick: number;
  hash: string;
};

export type CheckpointFrame = {
  roomId: string;
  tick: number;
  snapshot: GameSnapshot;
  nextId: number;
  reason?: CheckpointRequestReason;
  checkpointClass?: CheckpointRequestClass;
};

export type CheckpointRequestReason = "initial-sync" | "late-catchup" | "frame-apply-error" | "server-desync" | "message-error" | "manual";

export type CheckpointRequestClass = "initial" | "catchup" | "manual" | "recovery";

export type RoomSyncEventKind = "frame-apply-error" | "server-desync" | "message-error" | "checkpoint-restore" | "checkpoint-request" | "checksum-mismatch";

export type RoomSyncEvent = {
  id?: string;
  kind: RoomSyncEventKind;
  roomId: string;
  playerId: PlayerId;
  localTick: number;
  serverTick?: number;
  message?: string;
  frameTick?: number;
  frameSequence?: number;
  reason?: CheckpointRequestReason;
  checkpointClass?: CheckpointRequestClass;
  clientChecksum?: string;
  checksums?: Record<string, string>;
  recordedAt?: number;
};

export type RoomSyncSummary = {
  total: number;
  byKind: Record<RoomSyncEventKind, number>;
  checkpointRequests: Record<CheckpointRequestClass, number>;
};

export type RoomEpoch = number;

export type ClientNetMessage =
  | { type: "join"; roomId: string; playerId: PlayerId }
  | { type: "command"; roomId: string; playerId: PlayerId; command: GameCommand; clientSeq?: number; epoch: RoomEpoch }
  | { type: "chat"; roomId: string; playerId: PlayerId; senderName: string; text: string }
  | { type: "checksum"; roomId: string; playerId: PlayerId; tick: number; hash: string; epoch: RoomEpoch }
  | { type: "syncEvent"; roomId: string; event: RoomSyncEvent; epoch: RoomEpoch }
  | { type: "requestCheckpoint"; roomId: string; playerId: PlayerId; tick?: number; reason?: CheckpointRequestReason; clientTick?: number; clientChecksum?: string; epoch: RoomEpoch };

export type ServerNetMessage =
  | { type: "hello"; roomId: string; playerId: PlayerId; tick: number; epoch: RoomEpoch }
  | { type: "frame"; frame: CommandFrame; epoch: RoomEpoch }
  | { type: "checkpoint"; checkpoint: CheckpointFrame; epoch: RoomEpoch }
  | { type: "desync"; roomId: string; tick: number; checksums: Record<string, string>; epoch: RoomEpoch }
  | { type: "error"; roomId: string; message: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "room"; room: RoomState };
