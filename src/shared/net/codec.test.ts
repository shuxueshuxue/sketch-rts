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
      epoch: 2,
      command: { type: "move", unitIds: ["worker"], x: 100, y: 120 },
    };
    const server: ServerNetMessage = {
      type: "frame",
      epoch: 2,
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
    expect(() => decodeClientNetMessage(JSON.stringify({ type: "command", roomId: "room-1", playerId: "player", command: { type: "move" } }))).toThrow(/Malformed client command message/);
  });

  it("decodes server error messages", () => {
    const serverError = { type: "error", roomId: "room-1", message: "farm placement is too close to townHall" } as const;

    expect(decodeServerNetMessage(encodeNetMessage(serverError))).toEqual(serverError);
  });

  it("round-trips public chat messages outside command frames", () => {
    const client: ClientNetMessage = { type: "chat", roomId: "room-1", playerId: "player", senderName: "Ada", text: "push mid" };
    const server: ServerNetMessage = {
      type: "chat",
      message: { id: "chat-room-1-1", roomId: "room-1", playerId: "player", senderName: "Ada", text: "push mid", sentAt: 1200 },
    };

    expect(decodeClientNetMessage(encodeNetMessage(client))).toEqual(client);
    expect(decodeServerNetMessage(encodeNetMessage(server))).toEqual(server);
    expect(() => decodeClientNetMessage(JSON.stringify({ type: "chat", roomId: "room-1", playerId: "player", text: "" }))).toThrow(/Malformed client chat message/);
  });

  it("round-trips sync diagnostics and classified checkpoint requests", () => {
    const event = {
      type: "syncEvent",
      roomId: "room-1",
      epoch: 3,
      event: {
        kind: "checkpoint-request",
        roomId: "room-1",
        playerId: "player",
        localTick: 10,
        serverTick: 12,
        reason: "server-desync",
        checkpointClass: "recovery",
      },
    } satisfies ClientNetMessage;
    const request = {
      type: "requestCheckpoint",
      roomId: "room-1",
      playerId: "player",
      tick: 8,
      reason: "frame-apply-error",
      clientTick: 10,
      clientChecksum: "abcd1234",
      epoch: 3,
    } satisfies ClientNetMessage;

    expect(decodeClientNetMessage(encodeNetMessage(event))).toEqual(event);
    expect(decodeClientNetMessage(encodeNetMessage(request))).toEqual(request);
    expect(() =>
      decodeClientNetMessage(
        JSON.stringify({
          type: "syncEvent",
          roomId: "room-1",
          event: { kind: "frame-apply-error", roomId: "room-1", playerId: "player", localTick: 10, id: "client-id", recordedAt: 1 },
        }),
      ),
    ).toThrow(/Malformed client sync event message/);
    expect(() =>
      decodeClientNetMessage(
        JSON.stringify({
          type: "syncEvent",
          roomId: "room-1",
          event: { kind: "checkpoint-request", roomId: "room-1", playerId: "player", localTick: 10, checkpointClass: "routine" },
        }),
      ),
    ).toThrow(/Malformed client sync event message/);
    expect(() =>
      decodeClientNetMessage(
        JSON.stringify({
          type: "syncEvent",
          roomId: "room-1",
          event: { kind: "checkpoint-request", roomId: "room-1", playerId: "player", localTick: 10, reason: "server-desync", checkpointClass: "initial" },
        }),
      ),
    ).toThrow(/Malformed client sync event message/);
  });
});
