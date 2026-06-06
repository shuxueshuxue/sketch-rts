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
};

export type ClientNetMessage =
  | { type: "join"; roomId: string; playerId: PlayerId }
  | { type: "command"; roomId: string; playerId: PlayerId; command: GameCommand; clientSeq?: number }
  | { type: "chat"; roomId: string; playerId: PlayerId; senderName: string; text: string }
  | { type: "checksum"; roomId: string; playerId: PlayerId; tick: number; hash: string }
  | { type: "requestCheckpoint"; roomId: string; tick?: number };

export type ServerNetMessage =
  | { type: "hello"; roomId: string; playerId: PlayerId; tick: number }
  | { type: "frame"; frame: CommandFrame }
  | { type: "checkpoint"; checkpoint: CheckpointFrame }
  | { type: "desync"; roomId: string; tick: number; checksums: Record<PlayerId, string> }
  | { type: "error"; roomId: string; message: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "room"; room: RoomState };
