import { decodeServerNetMessage, encodeNetMessage } from "../../shared/net/codec";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import type { NetTransport } from "./transport";

export type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", handler: (event: { data: string }) => void): void;
  addEventListener(type: "open", handler: () => void): void;
};

export class WebSocketTransport implements NetTransport {
  constructor(private readonly socket: WebSocketLike) {}

  static connect(url: string): WebSocketTransport {
    return new WebSocketTransport(new WebSocket(url));
  }

  send(message: ClientNetMessage): void {
    this.socket.send(encodeNetMessage(message));
  }

  onMessage(handler: (message: ServerNetMessage) => void): void {
    this.socket.addEventListener("message", (event) => {
      handler(decodeServerNetMessage(String(event.data)));
    });
  }

  onOpen(handler: () => void): void {
    this.socket.addEventListener("open", handler);
  }

  close(): void {
    this.socket.close();
  }
}
