import { describe, expect, it } from "vitest";
import { decodeClientNetMessage, decodeServerNetMessage, encodeNetMessage } from "./codec";
import type { ClientNetMessage, ServerNetMessage } from "./types";

describe("net message codec", () => {
  it("round-trips typed client and server messages", () => {
    const client: ClientNetMessage = {
      type: "command",
      roomId: "room-1",
      playerId: "player",
      clientSeq: 7,
      command: { type: "move", unitIds: ["worker"], x: 100, y: 120 },
    };
    const server: ServerNetMessage = {
      type: "frame",
      frame: {
        roomId: "room-1",
        tick: 10,
        sequence: 3,
        commands: [{ playerId: "player", clientSeq: 7, command: { type: "move", unitIds: ["worker"], x: 100, y: 120 } }],
      },
    };

    expect(decodeClientNetMessage(encodeNetMessage(client))).toEqual(client);
    expect(decodeServerNetMessage(encodeNetMessage(server))).toEqual(server);
  });

  it("fails loudly for malformed payloads and unknown message types", () => {
    expect(() => decodeClientNetMessage("not-json")).toThrow(/Invalid net message JSON/);
    expect(() => decodeServerNetMessage(JSON.stringify({ type: "mystery" }))).toThrow(/Unknown server net message type mystery/);
    expect(() => decodeClientNetMessage(JSON.stringify({ type: "command", roomId: "room-1" }))).toThrow(/Malformed client command message/);
  });

  it("decodes server error messages", () => {
    const serverError = { type: "error", roomId: "room-1", message: "farm placement is too close to townHall" } as const;

    expect(decodeServerNetMessage(encodeNetMessage(serverError))).toEqual(serverError);
  });
});
