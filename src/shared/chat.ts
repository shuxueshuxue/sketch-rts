import type { ChatMessage } from "./net/types";
import type { PlayerId } from "./types";

export type ChatPayload = {
  roomId: string;
  playerId: PlayerId;
  senderName: string;
  text: string;
};

export type ChatMessageInput = ChatPayload & {
  sequence: number;
  sentAt: number;
};

export function normalizeChatText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function prepareChatPayload(input: ChatPayload): ChatPayload {
  const text = normalizeChatText(input.text);
  if (!text) throw new Error("Chat message cannot be empty");
  return { ...input, text };
}

export function createChatMessage(input: ChatMessageInput): ChatMessage {
  const payload = prepareChatPayload(input);
  return {
    id: chatMessageId(input.roomId, input.sequence),
    roomId: payload.roomId,
    playerId: payload.playerId,
    senderName: payload.senderName,
    text: payload.text,
    sentAt: input.sentAt,
  };
}

export function chatMessageId(roomId: string, sequence: number): string {
  return `chat-${roomId}-${sequence}`;
}
