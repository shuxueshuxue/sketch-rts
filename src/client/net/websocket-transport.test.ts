import { describe, expect, it } from "vitest";
import { encodeNetMessage } from "../../shared/net/codec";
import { WebSocketTransport, type WebSocketLike } from "./websocket-transport";
import type { ServerNetMessage } from "../../shared/net/types";

describe("WebSocket transport adapter", () => {
  it("encodes outbound client messages and decodes inbound server messages", () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket);
    const received: ServerNetMessage[] = [];
    transport.onMessage((message) => received.push(message));

    transport.send({ type: "join", roomId: "room-1", playerId: "player" });
    socket.emitMessage(encodeNetMessage({ type: "hello", roomId: "room-1", playerId: "player", tick: 12 }));

    expect(socket.sent).toEqual([JSON.stringify({ type: "join", roomId: "room-1", playerId: "player" })]);
    expect(received).toEqual([{ type: "hello", roomId: "room-1", playerId: "player", tick: 12 }]);
  });

  it("notifies when the socket opens", () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket);
    let opened = false;

    transport.onOpen(() => {
      opened = true;
    });
    socket.emitOpen();

    expect(opened).toBe(true);
  });

  it("closes the underlying socket", () => {
    const socket = new FakeSocket();
    const transport = new WebSocketTransport(socket);

    transport.close();

    expect(socket.closed).toBe(true);
  });
});

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  closed = false;
  private messageHandlers: ((event: { data: string }) => void)[] = [];
  private openHandlers: (() => void)[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: "message" | "open", handler: ((event: { data: string }) => void) | (() => void)): void {
    if (type === "message") this.messageHandlers.push(handler);
    if (type === "open") this.openHandlers.push(handler as () => void);
  }

  emitMessage(data: string): void {
    for (const handler of this.messageHandlers) handler({ data });
  }

  emitOpen(): void {
    for (const handler of this.openHandlers) handler();
  }
}
