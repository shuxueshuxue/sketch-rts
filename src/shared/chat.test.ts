import { describe, expect, it } from "vitest";
import { createChatMessage, prepareChatPayload } from "./chat";

describe("shared chat message primitive", () => {
  it("normalizes outbound chat payloads before transport-specific delivery", () => {
    expect(prepareChatPayload({ roomId: "room-chat", playerId: "player", senderName: "Ada", text: " push mid " })).toEqual({
      roomId: "room-chat",
      playerId: "player",
      senderName: "Ada",
      text: "push mid",
    });
    expect(() => prepareChatPayload({ roomId: "room-chat", playerId: "player", senderName: "Ada", text: "   " })).toThrow("Chat message cannot be empty");
  });

  it("creates sequenced chat messages with the shared id and timestamp semantics", () => {
    expect(createChatMessage({ roomId: "room-chat", playerId: "player", senderName: "Ada", text: " push mid ", sequence: 2, sentAt: 1200 })).toEqual({
      id: "chat-room-chat-2",
      roomId: "room-chat",
      playerId: "player",
      senderName: "Ada",
      text: "push mid",
      sentAt: 1200,
    });
  });
});
